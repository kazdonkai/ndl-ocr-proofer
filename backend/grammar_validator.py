"""
grammar_validator.py
古文書OCRテキストの文法・OCR疑義バリデーター。

責務:
  1. validate_span(text, ocr_confidence) → ValidationResult
     テキストスパン1件を検証し、verdict/score/reason/suggestion を返す。

  2. scan_text(full_text) → List[Dict]
     全文から grammar 違反スパンを能動的に抽出する
     （辞書未登録の申立系など、他の検出器が見逃すものを補う）。

スコア閾値:
  accept : score >= 0.75
  review : 0.45 <= score < 0.75
  reject : score < 0.45
"""

import re
from dataclasses import dataclass
from typing import Optional, List, Dict, Any

VERDICT_ACCEPT = "accept"
VERDICT_REVIEW = "review"
VERDICT_REJECT = "reject"

SCORE_ACCEPT = 0.75
SCORE_REJECT = 0.45


@dataclass
class OcrNormalizationSuggestion:
    suggested_candidate: str
    suggestion_reason: str
    suggestion_confidence: float
    suggestion_type: str = "ocr_normalization"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "suggested_candidate": self.suggested_candidate,
            "suggestion_reason": self.suggestion_reason,
            "suggestion_confidence": self.suggestion_confidence,
            "suggestion_type": self.suggestion_type,
        }


@dataclass
class ValidationResult:
    verdict: str        # "accept" | "review" | "reject"
    score: float        # 0.0–1.0（判定に使ったスコア）
    reason: str
    image_audit_required: bool = False
    suggestion: Optional[OcrNormalizationSuggestion] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "verdict": self.verdict,
            "score": round(self.score, 4),
            "reason": self.reason,
            "image_audit_required": self.image_audit_required,
            "suggestion": self.suggestion.to_dict() if self.suggestion else None,
        }


# ── 申立系ハードルール定義 ──────────────────────────────────────────────────────
# パターンは「長い形 → 短い形」の順で評価すること（申立レ共 は 申立レ より先に評価する）。
_MOUSHITATE_HARD_RULES: List[Dict[str, Any]] = [
    # ── accept: 正規候文形 ─────────────────────────────────────────────────────
    {
        "pattern": re.compile(r"申立仕候"),
        "verdict": VERDICT_ACCEPT,
        "score": 0.95,
        "reason": "申立仕候：候文謙譲形として正規（高信頼）",
        "image_audit_required": False,
        "suggestion": None,
    },
    {
        "pattern": re.compile(r"申立候"),
        "verdict": VERDICT_ACCEPT,
        "score": 0.90,
        "reason": "申立候：候文連用形として正規（標準形）",
        "image_audit_required": False,
        "suggestion": None,
    },
    # ── review: 候→レ 誤変換疑い（複合形・文脈確認要） ─────────────────────────
    {
        "pattern": re.compile(r"申立レ共"),
        "verdict": VERDICT_REVIEW,
        "score": 0.38,
        "reason": "申立レ共：申立候共 の 候→レ OCR誤変換疑い（要画像確認）",
        "image_audit_required": True,
        "suggestion": OcrNormalizationSuggestion(
            suggested_candidate="申立候共",
            suggestion_reason="候の草書体がレ状に誤認されるパターン（字形類似）",
            suggestion_confidence=0.88,
        ),
    },
    {
        "pattern": re.compile(r"申立レトモ"),
        "verdict": VERDICT_REVIEW,
        "score": 0.38,
        "reason": "申立レトモ：申立候トモ の 候→レ OCR誤変換疑い（要画像確認）",
        "image_audit_required": True,
        "suggestion": OcrNormalizationSuggestion(
            suggested_candidate="申立候トモ",
            suggestion_reason="候の草書体がレ状に誤認されるパターン（字形類似）",
            suggestion_confidence=0.85,
        ),
    },
    # ── reject: 候→レ 誤変換確定（単独形） ───────────────────────────────────
    {
        "pattern": re.compile(r"申立レ"),
        "verdict": VERDICT_REJECT,
        "score": 0.15,
        "reason": "申立レ：古文書語形として不自然、かつ候→レ OCR誤変換確定",
        "image_audit_required": True,
        "suggestion": OcrNormalizationSuggestion(
            suggested_candidate="申立候",
            suggestion_reason="候の草書体がレ状に誤認されるパターン（字形類似）",
            suggestion_confidence=0.90,
        ),
    },
    # ── reject: OCRアーティファクト（終止形・接続形カタカナ化） ──────────────────
    {
        "pattern": re.compile(r"申立ル"),
        "verdict": VERDICT_REJECT,
        "score": 0.25,
        "reason": "申立ル：動詞終止形カタカナ化または候脱落。OCRアーティファクト疑い",
        "image_audit_required": True,
        "suggestion": OcrNormalizationSuggestion(
            suggested_candidate="申立候",
            suggestion_reason="候文では終止形カタカナ表記は通常存在しない。候脱落または候→ル誤変換の可能性",
            suggestion_confidence=0.75,
        ),
    },
    {
        "pattern": re.compile(r"申立テ"),
        "verdict": VERDICT_REJECT,
        "score": 0.25,
        "reason": "申立テ：カタカナ「テ」は候脱落または而（しこうして）の誤認。OCRアーティファクト疑い",
        "image_audit_required": True,
        "suggestion": OcrNormalizationSuggestion(
            suggested_candidate="申立候",
            suggestion_reason="テは而（而）の誤読または候脱落。文脈によっては申立而も候補",
            suggestion_confidence=0.70,
        ),
    },
]

# 全文スキャン用: 申立系を一括マッチするパターン（長い形を先に評価するため上記ルール順と一致させる）
_SCAN_PATTERN = re.compile(r"申立(?:仕候|候|レ共|レトモ|レ|ル|テ)")


class GrammarValidator:
    """
    候文語形バリデーター。

    申立系ハードルールと OCR信頼度スコア閾値の2層構造で判定を行う。
    """

    def validate_span(
        self,
        text: str,
        ocr_confidence: Optional[float] = None,
    ) -> Optional["ValidationResult"]:
        """
        テキストスパン1件を検証し ValidationResult を返す。

        優先順位:
          1. 申立系ハードルール（完全一致 / 部分一致）
          2. OCR信頼度スコア閾値判定
          3. どちらも適用不可なら None
        """
        for rule in _MOUSHITATE_HARD_RULES:
            if rule["pattern"].search(text):
                return ValidationResult(
                    verdict=rule["verdict"],
                    score=rule["score"],
                    reason=rule["reason"],
                    image_audit_required=rule["image_audit_required"],
                    suggestion=rule["suggestion"],
                )

        if ocr_confidence is not None:
            verdict, reason = self._score_to_verdict(ocr_confidence)
            return ValidationResult(
                verdict=verdict,
                score=ocr_confidence,
                reason=reason,
                image_audit_required=(ocr_confidence < SCORE_REJECT),
            )

        return None

    def scan_text(self, text: str) -> List[Dict[str, Any]]:
        """
        全文から文法違反・OCR疑義スパンを能動的に抽出する。

        返す辞書フォーマットは AIAnalyzer.analyze_document の spans リストに直接追加可能。
        各エントリに validation_result キーを付加する。
        """
        results: List[Dict[str, Any]] = []
        seen: set = set()

        for m in _SCAN_PATTERN.finditer(text):
            matched = m.group()
            if matched in seen:
                continue
            seen.add(matched)

            vr = self.validate_span(matched)
            if vr is None:
                continue

            # accept 形（申立候/申立仕候）は他の検出器でも拾われることがあるが、
            # ここでは ValidationResult 付与のために scan_text にも含める。
            results.append({
                "suspect_span": matched,
                "reason": vr.reason,
                "confidence": vr.score,
                "is_protected": False,
                "_validation_result": vr,   # AIAnalyzer 内部で参照するプライベートキー
            })

        return results

    @staticmethod
    def _score_to_verdict(score: float) -> tuple:
        if score >= SCORE_ACCEPT:
            return VERDICT_ACCEPT, f"OCR信頼度 {score:.2f}（閾値 {SCORE_ACCEPT} 以上: 適正）"
        if score >= SCORE_REJECT:
            return VERDICT_REVIEW, f"OCR信頼度 {score:.2f}（要確認 {SCORE_REJECT}–{SCORE_ACCEPT}）"
        return VERDICT_REJECT, f"OCR信頼度 {score:.2f}（閾値 {SCORE_REJECT} 未満: 要修正）"
