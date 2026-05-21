"""
test_grammar_validator.py

Task 1 (VALIDATOR_SUGGESTION_INJECTION_PLAN) 検証:
  - SELF_FALLBACK_REPLACEMENT_RULE の各パターン（申立レ/ル/テ/レ共/レトモ）
  - accept パターン（申立候/申立仕候）
  - scan_text による全文スキャン
  - suggestion の内容（suggested_candidate / suggestion_type）
"""

import pytest
from grammar_validator import (
    GrammarValidator,
    VERDICT_ACCEPT,
    VERDICT_REVIEW,
    VERDICT_REJECT,
)


@pytest.fixture
def validator():
    return GrammarValidator()


# ── accept パターン ────────────────────────────────────────────────────────────

class TestAcceptPatterns:
    def test_moushitate_sou(self, validator):
        vr = validator.validate_span("申立候")
        assert vr is not None
        assert vr.verdict == VERDICT_ACCEPT
        assert vr.score >= 0.90
        assert vr.suggestion is None

    def test_moushitate_itashi_sou(self, validator):
        vr = validator.validate_span("申立仕候")
        assert vr is not None
        assert vr.verdict == VERDICT_ACCEPT
        assert vr.score >= 0.95
        assert vr.suggestion is None

    def test_moushitate_sou_in_sentence(self, validator):
        # 文中に埋め込まれていてもマッチする
        vr = validator.validate_span("右之通申立候処")
        assert vr is not None
        assert vr.verdict == VERDICT_ACCEPT


# ── reject パターン（単独形：候→レ 誤変換確定） ───────────────────────────────

class TestRejectPatterns:
    def test_moushitate_re(self, validator):
        """申立レ: reject, suggestion=申立候"""
        vr = validator.validate_span("申立レ")
        assert vr is not None
        assert vr.verdict == VERDICT_REJECT
        assert vr.score < 0.45
        assert vr.suggestion is not None
        assert vr.suggestion.suggested_candidate == "申立候"
        assert vr.image_audit_required is True

    def test_moushitate_ru(self, validator):
        """申立ル: reject, suggestion=申立候"""
        vr = validator.validate_span("申立ル")
        assert vr is not None
        assert vr.verdict == VERDICT_REJECT
        assert vr.suggestion is not None
        assert vr.suggestion.suggested_candidate == "申立候"

    def test_moushitate_te(self, validator):
        """申立テ: reject, suggestion=申立候"""
        vr = validator.validate_span("申立テ")
        assert vr is not None
        assert vr.verdict == VERDICT_REJECT
        assert vr.suggestion is not None
        assert vr.suggestion.suggested_candidate == "申立候"

    def test_suggestion_type_is_ocr_normalization(self, validator):
        """suggestion_type は ocr_normalization であること"""
        vr = validator.validate_span("申立レ")
        assert vr.suggestion.suggestion_type == "ocr_normalization"


# ── review パターン（複合形：候→レ 誤変換疑い、要画像確認） ────────────────────

class TestReviewPatterns:
    def test_moushitate_re_tomo(self, validator):
        """申立レ共: review（rejectでない）, suggestion=申立候共

        ハードルールの score はOCR閾値(0.45/0.75)と独立した「確信度スコア」。
        申立レ共 の score=0.38 は「候補疑いが強いが画像確認が必要」を示す定性値。
        """
        vr = validator.validate_span("申立レ共")
        assert vr is not None
        assert vr.verdict == VERDICT_REVIEW
        assert vr.score == pytest.approx(0.38)
        assert vr.suggestion is not None
        assert vr.suggestion.suggested_candidate == "申立候共"
        assert vr.image_audit_required is True

    def test_moushitate_re_tomo_kata(self, validator):
        """申立レトモ: review, suggestion=申立候トモ"""
        vr = validator.validate_span("申立レトモ")
        assert vr is not None
        assert vr.verdict == VERDICT_REVIEW
        assert vr.suggestion is not None
        assert vr.suggestion.suggested_candidate == "申立候トモ"

    def test_re_tomo_evaluated_before_re(self, validator):
        """申立レ共 は 申立レ より先に評価される（長い形優先）"""
        # 申立レ共 を評価したとき、申立レ のルールが誤適用されないこと
        vr = validator.validate_span("申立レ共")
        assert vr.suggestion.suggested_candidate == "申立候共"  # 申立候 ではない

    def test_re_tomo_kata_evaluated_before_re(self, validator):
        """申立レトモ は 申立レ より先に評価される"""
        vr = validator.validate_span("申立レトモ")
        assert vr.suggestion.suggested_candidate == "申立候トモ"  # 申立候 ではない


# ── scan_text ─────────────────────────────────────────────────────────────────

class TestScanText:
    def test_scan_finds_reject_spans(self, validator):
        text = "右之通申立レ候　申立ル間違無候"
        results = validator.scan_text(text)
        spans = {r["suspect_span"] for r in results}
        assert "申立レ" in spans
        assert "申立ル" in spans

    def test_scan_finds_accept_spans(self, validator):
        """accept 形も scan_text に含まれる（ValidationResult 付与目的）"""
        text = "申立候処"
        results = validator.scan_text(text)
        spans = {r["suspect_span"] for r in results}
        assert "申立候" in spans

    def test_scan_deduplicates(self, validator):
        """同一スパンは1回のみ報告"""
        text = "申立レ申立レ申立レ"
        results = validator.scan_text(text)
        spans = [r["suspect_span"] for r in results]
        assert spans.count("申立レ") == 1

    def test_scan_attaches_validation_result(self, validator):
        """_validation_result キーが各エントリに含まれる"""
        text = "申立レ"
        results = validator.scan_text(text)
        assert len(results) == 1
        assert "_validation_result" in results[0]
        vr = results[0]["_validation_result"]
        assert vr.verdict == VERDICT_REJECT

    def test_scan_empty_text(self, validator):
        assert validator.scan_text("") == []

    def test_scan_no_match(self, validator):
        assert validator.scan_text("入会山論之事") == []


# ── OCR 信頼度スコア判定（hard rule なしのケース） ─────────────────────────────

class TestOcrScoreVerdict:
    def test_high_confidence_accept(self, validator):
        vr = validator.validate_span("普通の語句", ocr_confidence=0.90)
        assert vr.verdict == VERDICT_ACCEPT

    def test_mid_confidence_review(self, validator):
        vr = validator.validate_span("普通の語句", ocr_confidence=0.55)
        assert vr.verdict == VERDICT_REVIEW

    def test_low_confidence_reject(self, validator):
        vr = validator.validate_span("普通の語句", ocr_confidence=0.30)
        assert vr.verdict == VERDICT_REJECT

    def test_no_rule_no_confidence_returns_none(self, validator):
        vr = validator.validate_span("普通の語句")
        assert vr is None
