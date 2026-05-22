import json
import os
import re
from typing import List, Dict, Any, Optional
from dictionary_loader import DictionaryLoader
from candidate_engine import CandidateEngine
from document_classifier import DocumentTypeDetector, DocumentType
from grammar_validator import GrammarValidator, ValidationResult
from particle_script import ParticleScriptAnalyzer
from file_context_hint import FileContextHintBuilder
from shape_detector import ShapeDetector


# ── 助詞正規化: に/を/は → ニ/ヲ/ハ ──────────────────────────────────────────
# 判定条件: 漢字またはカタカナに挟まれた1文字のひらがな助詞
# 除外パターン: 複合助詞・接続詞に先行するケース（誤検出抑制）
_KANJI_KATA = r'[一-龠々ァ-ヶ]'
_PARTICLE_EXCLUSION = re.compile(
    r'において|における|について|については|につき|にて|にも|には'
    r'|をもって|をめぐって|をめぐる|または|あるいは'
    r'|はじめ|はなく|はもと|はもちろん'
)

_PARTICLE_PATTERNS: Dict[str, re.Pattern] = {
    'に': re.compile(rf'(?<={_KANJI_KATA})(に)(?={_KANJI_KATA})'),
    'を': re.compile(rf'(?<={_KANJI_KATA})(を)(?={_KANJI_KATA})'),
    'は': re.compile(rf'(?<={_KANJI_KATA})(は)(?={_KANJI_KATA})'),
}
_PARTICLE_KATA_MAP = {'に': 'ニ', 'を': 'ヲ', 'は': 'ハ'}

class AIAnalyzer:
    """
    AI解析レイヤー: 疑義箇所の抽出と、候補文字の提示を担当するクラス
    研究語彙辞書(DictionaryLoader)を参照して精度を向上させます (Task D.4 / 2.1 / 2.2 統合)
    """

    def __init__(self, dict_dir: str, confidence_threshold: float = 0.6, eval_dir: str = ""):
        self.confidence_threshold = confidence_threshold
        self.eval_dir = eval_dir

        # 辞書の初期化と読み込み
        self.dictionary_loader = DictionaryLoader(dict_dir)
        self.dictionary_loader.load_all_approved()
        print(f"[AIAnalyzer] Loaded {len(self.dictionary_loader.terms)} dictionary terms.")

        # Phase 1-a: 字形混同検出器
        shape_pairs_path = os.path.join(dict_dir, "shape_pairs.yaml")
        self.shape_detector = ShapeDetector(shape_pairs_path)

        # 候補生成エンジン（辞書ローダー + ShapeDetector を DI）
        self.candidate_engine = CandidateEngine(self.dictionary_loader, shape_detector=self.shape_detector)

        # ドキュメント種別判定
        self.doc_type_detector = DocumentTypeDetector()

        # 文法・OCR疑義バリデーター
        self.grammar_validator = GrammarValidator()

        # Phase 1-b: 助詞書体スタイル解析
        self.particle_script_analyzer = ParticleScriptAnalyzer()

        # Phase 1-c: ファイルコンテキスト・ドメインヒント構築
        self.file_context_hint_builder = FileContextHintBuilder()
        self.dict_dir = dict_dir

        # TODO: 今後、LLMクライアント（OpenAI / Ollama）の初期化をここに追加する

    def reload_dictionary(self, use_experimental: bool = False) -> None:
        """辞書を再読み込みする。use_experimental=True のとき staging/ の experimental 辞書も追加する。"""
        self.dictionary_loader.reload(use_experimental=use_experimental)
        self.candidate_engine = CandidateEngine(self.dictionary_loader, shape_detector=self.shape_detector)
        print(f"[AIAnalyzer] Dictionary reloaded (experimental={use_experimental}): {len(self.dictionary_loader.terms)} terms.")

    def detect_low_confidence_from_json(self, ocr_json: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        ルールベース抽出:
        NDL OCRの出力JSONを走査し、信頼度(confidence)が閾値以下の文字を抽出する。
        辞書の保護対象(protect=true)に合致するかも判定してフラグを立てる。
        """
        suspicious_spans = []
        if not ocr_json:
            return suspicious_spans

        def extract_chars(node):
            if isinstance(node, dict):
                if "text" in node and "confidence" in node:
                    score = node["confidence"]
                    text = node["text"]
                    if score < self.confidence_threshold:
                        # 辞書からprotect=trueの対象かチェック
                        is_protected = any(
                            text in t.all_forms and t.protect 
                            for t in self.dictionary_loader.terms
                        )
                        
                        suspicious_spans.append({
                            "suspect_span": text,
                            "reason": f"OCR信頼度が低い ({score:.2f})",
                            "confidence": score,
                            "is_protected": is_protected
                        })
                for v in node.values():
                    extract_chars(v)
            elif isinstance(node, list):
                for item in node:
                    extract_chars(item)

        extract_chars(ocr_json)
        return suspicious_spans

    def detect_suspicious_by_rules(self, text: str) -> List[Dict[str, Any]]:
        """
        ルールベースによる疑義箇所抽出:
        - 記号の不自然な連続 (例: 「???」, 「...」)
        - OCRで誤認されやすい特定の文字
        - 本文中の不自然な英数字混入 (縦書き日本語の中の「1」や「l」など)
        """
        results = []
        import re
        
        # 1. 記号の連続 (3つ以上)
        pattern_repeat = re.compile(r'([！？。、…・]{3,})')
        for match in pattern_repeat.finditer(text):
            results.append({
                "suspect_span": match.group(),
                "reason": "記号の不自然な連続",
                "confidence": 0.5,
                "is_protected": False
            })
            
        # 2. 括弧の閉じ忘れ等の簡易チェック (簡易的なため誤検知注意)
        # 今回は一旦スキップし、より確実なものに絞る
        
        # 3. 日本語の中の不自然な1文字の英数字
        # 前後が日本語で、中間に1文字だけ英数字がある場合 (例: 「証b書」)
        pattern_isolated_alnum = re.compile(r'([一-龠ぁ-んァ-ヶ])([a-zA-Z0-9])([一-龠ぁ-んァ-ヶ])')
        for match in pattern_isolated_alnum.finditer(text):
            results.append({
                "suspect_span": match.group(2),
                "reason": "不自然な英数字の混入",
                "confidence": 0.4,
                "is_protected": False
            })

        return results

    def count_particle_normalization_candidates(self, text: str, doc_type: str) -> int:
        """
        classical と判定された場合のみ、に/を/は → ニ/ヲ/ハ の候補件数を返す。
        除外パターン（において/については 等）にヒットした位置はカウントしない。
        実行時に現在ページテキストを再スキャンする（レスポンスには count のみ返す）。
        """
        if doc_type != DocumentType.CLASSICAL:
            return 0

        # 除外対象の位置インデックスを先に収集
        excluded_positions: set[int] = set()
        for m in _PARTICLE_EXCLUSION.finditer(text):
            for i in range(m.start(), m.end()):
                excluded_positions.add(i)

        count = 0
        for hira, pattern in _PARTICLE_PATTERNS.items():
            for m in pattern.finditer(text):
                if m.start() not in excluded_positions:
                    count += 1
        return count

    def get_particle_normalization_samples(
        self, text: str, doc_type: str, max_per_particle: int = 3
    ) -> List[Dict[str, Any]]:
        """
        助詞正規化プレビューダイアログ用のサンプル情報を返す。
        各助詞ごとに件数と最大 max_per_particle 件のコンテキスト例を含む。
        """
        if doc_type != DocumentType.CLASSICAL:
            return []

        excluded_positions: set[int] = set()
        for m in _PARTICLE_EXCLUSION.finditer(text):
            for i in range(m.start(), m.end()):
                excluded_positions.add(i)

        result = []
        for hira, pattern in _PARTICLE_PATTERNS.items():
            kata = _PARTICLE_KATA_MAP[hira]
            hits = [m for m in pattern.finditer(text) if m.start() not in excluded_positions]
            if not hits:
                continue
            samples = []
            for m in hits[:max_per_particle]:
                start = max(0, m.start() - 4)
                end = min(len(text), m.end() + 4)
                ctx = text[start:m.start()] + f"【{hira}】" + text[m.end():end]
                samples.append(ctx)
            result.append({
                "hira": hira,
                "kata": kata,
                "count": len(hits),
                "samples": samples,
            })
        return result

    def detect_repetition_noise(self, text: str) -> List[Dict[str, Any]]:
        """
        繰り返しノイズの検出（OCR誤認によるゴミ行）:
        1. 〇/一 の繰り返し列: 数字・表をOCRが誤認したもの
           例: 一一〇〇〇、〇〇、〇〇、〇〇〇...
        2. 低文字多様性行: 同一漢字の繰り返し崩壊
           例: 急災災地震災地震災地震災害災...
        """
        from collections import Counter
        results = []
        covered_ranges: List[tuple] = []

        # --- 1. 低文字多様性行 (行単位スキャン) ---
        # ユニーク文字数 / 総非空白文字数 < 0.12 かつ 25文字以上の行
        pos = 0
        for line in text.split('\n'):
            line_start = pos
            pos += len(line) + 1
            stripped = line.strip()
            if not stripped:
                continue
            non_ws = [c for c in stripped if not c.isspace()]
            if len(non_ws) < 25:
                continue
            diversity = len(set(non_ws)) / len(non_ws)
            if diversity >= 0.12:
                continue
            leading_ws = len(line) - len(line.lstrip())
            trailing_ws = len(line) - len(line.rstrip())
            span_start = line_start + leading_ws
            span_end = line_start + len(line) - trailing_ws
            results.append({
                'suspect_span': stripped,
                'reason': '文字の繰り返しノイズ（OCR誤認）',
                'confidence': 0.85,
                'is_protected': False,
                '_direct_candidates': [''],
            })
            covered_ranges.append((span_start, span_end))

        # --- 2. 〇/一 数字ノイズ列 (低多様性行に含まれない場合のみ追加) ---
        maru_pat = re.compile(r'[一〇]{1,6}(?:、[一〇]{1,6}){3,}')
        for m in maru_pat.finditer(text):
            ms, me = m.start(), m.end()
            if any(cs <= ms and me <= ce for cs, ce in covered_ranges):
                continue
            results.append({
                'suspect_span': m.group(),
                'reason': '数字記号の繰り返しノイズ（OCR誤認）',
                'confidence': 0.85,
                'is_protected': False,
                '_direct_candidates': [''],
            })

        return results

    def detect_suspicious_by_context_llm(self, _text: str) -> List[Dict[str, Any]]:
        """
        LLMによる文脈ベース抽出（モック）。
        OCRスコアが高くても文脈破綻している「もっともらしい誤読」を拾う。
        """
        return []

    def generate_candidates(
        self,
        suspect_span: str,
        is_protected: bool = False,
        domain_hint: str = "",
        file_context_hint: Optional[Dict[str, float]] = None,
        proper_noun_terms: Optional[set] = None,
        suppress_bonus_only: bool = False,
        geo_noun_terms: Optional[set] = None,
    ) -> List[str]:
        """CandidateEngine へ委譲する薄いラッパー。"""
        return self.candidate_engine.generate(
            suspect_span,
            is_protected=is_protected,
            domain_hint=domain_hint,
            file_context_hint=file_context_hint,
            proper_noun_terms=proper_noun_terms,
            suppress_bonus_only=suppress_bonus_only,
            geo_noun_terms=geo_noun_terms,
        )

    def detect_dictionary_terms(self, text: str) -> List[Dict[str, Any]]:
        """
        本文中に研究語彙辞書の語彙（特に異表記 variants）が含まれている場合に抽出する。
        """
        results = []
        for term in self.dictionary_loader.terms:
            # term == normalized かつ variants が空の場合は「史料特有語彙」として
            # term 自体を検出対象にする（例: 論所、経界、炭焼）
            is_standalone = (term.term == term.normalized and not term.variants)
            for variant in term.all_forms:
                if variant in text and (variant != term.normalized or is_standalone):
                    if not any(r["suspect_span"] == variant for r in results):
                        reason = (
                            f"辞書に登録された語彙です"
                            if is_standalone and variant == term.term
                            else f"辞書に登録された異表記です (正規化形: {term.normalized})"
                        )
                        results.append({
                            "suspect_span": variant,
                            "reason": reason,
                            "confidence": 1.0,
                            "is_protected": term.protect
                        })
        return results

    def analyze_document(
        self,
        text: str,
        ocr_json: Optional[Dict[str, Any]] = None,
        domain_hint: str = "",
        frontmatter: Optional[Dict[str, Any]] = None,
        filename: str = "",
    ) -> tuple:
        """
        ドキュメント全文からOCR本文を抽出し、疑義箇所の抽出から候補生成までを一気通貫で行うメインAPI
        """
        from text_processor import OCRTextProcessor

        # [!ocr]ブロックがあればそこだけ抽出、なければ生テキストをそのまま正規化して使う
        clean_text = OCRTextProcessor.get_clean_text(text)
        if not clean_text:
            clean_text = OCRTextProcessor.normalize_text(text)

        # Phase 1-c: ファイルコンテキストから domain_hint_bonus を構築
        file_context_hint, proper_noun_terms, region_info, geo_noun_terms = (
            self.file_context_hint_builder.build(
                filename=filename,
                frontmatter=frontmatter,
                dict_dir=self.dict_dir,
                body_text=clean_text,
            )
        )

        # Phase 1-b: 助詞書体スタイル解析（早期計算してひらがな誤認検出に使用）
        style_hints = self.particle_script_analyzer.analyze(clean_text)

        spans = []

        # 1. 疑義箇所の抽出 (クリーンなテキストに対してのみ実行)
        # A. OCR信頼度ベース (OCR JSONがある場合のみ)
        if ocr_json:
            spans.extend(self.detect_low_confidence_from_json(ocr_json))

        # B. 辞書照合ベース
        spans.extend(self.detect_dictionary_terms(clean_text))

        # C. ルールベース (記号連続など)
        spans.extend(self.detect_suspicious_by_rules(clean_text))

        # D. LLM文脈ベース (モック)
        spans.extend(self.detect_suspicious_by_context_llm(clean_text))

        # H. 繰り返しノイズ検出（〇/一 列・低文字多様性行）
        spans.extend(self.detect_repetition_noise(clean_text))

        # E. 文法・OCR疑義スキャン（GrammarValidator による能動スキャン）
        #    辞書未登録の申立系語形など他の検出器が拾えないものを補完する
        spans.extend(self.grammar_validator.scan_text(clean_text))

        # F. カタカナ優勢文書でのひらがな単字誤認検出
        #    漢字/カタカナに隣接するひらがな文字（1文字）をカタカナへの誤認として報告する
        spans.extend(
            self.particle_script_analyzer.detect_isolated_hira_suspects(clean_text, style_hints)
        )

        # G. カタカナ優勢文書でのひらがな2文字誤認検出
        #    漢字/カタカナに隣接するひらがな bigram をカタカナへの誤認として報告する
        #    （より→ヨリ、とも→トモ等。自動適用なし、UI での選択のみ有効）
        spans.extend(
            self.particle_script_analyzer.detect_hira_bigram_suspects(clean_text, style_hints)
        )

        # 2. 各疑義箇所への候補生成 + テキスト内位置情報の付与
        # スパンの重複を除去（同一テキストが複数の検出器で報告された場合に1つにまとめる）
        unique_spans = []
        seen: set[str] = set()
        for s in spans:
            ts = s["suspect_span"]
            if ts not in seen:
                unique_spans.append(s)
                seen.add(ts)

        # bigram で覆われた文字位置セット（開始位置・内部位置を含む全位置）
        # 単字 _forced_candidate の出現がこの位置に重なる場合はレンダリング時にスキップする。
        # 文字種単位ではなく位置単位で抑制することで、
        # 同じ文字が別の位置では単体でも適切に検出される（わり位置→抑制、単体わ位置→表示）。
        _bigram_covered_positions: set[int] = set()
        for _sd in unique_spans:
            if _sd.get('_kata_bigram_candidate'):
                _ts = _sd['suspect_span']
                _p = 0
                while True:
                    _idx = clean_text.find(_ts, _p)
                    if _idx == -1:
                        break
                    for _i in range(_idx, _idx + len(_ts)):
                        _bigram_covered_positions.add(_i)
                    _p = _idx + len(_ts)

        # 位置ごとの最長スパン長を事前計算（短スパンが長スパンの先頭と重複する誤検出を防ぐ）
        _longest_at: dict[int, int] = {}
        for span_data in unique_spans:
            _ts = span_data["suspect_span"]
            _p = 0
            while True:
                _idx = clean_text.find(_ts, _p)
                if _idx == -1:
                    break
                if _idx not in _longest_at or _longest_at[_idx] < len(_ts):
                    _longest_at[_idx] = len(_ts)
                _p = _idx + len(_ts)

        results = []
        # 同一 suspect_span テキストの出現番号を追跡するカウンター（0-indexed）
        occurrence_counters: dict[str, int] = {}

        for span_data in unique_spans:
            text_span = span_data["suspect_span"]
            ocr_conf = span_data.get("confidence")

            # 繰り返しノイズ等で候補が直接指定されている場合は候補生成をスキップ
            direct_candidates = span_data.get("_direct_candidates")
            if direct_candidates is not None:
                candidates = list(direct_candidates)
            else:
                candidates = self.generate_candidates(
                    text_span,
                    is_protected=span_data.get("is_protected", False),
                    domain_hint=domain_hint,
                    file_context_hint=file_context_hint,
                    proper_noun_terms=proper_noun_terms,
                    geo_noun_terms=geo_noun_terms,
                )

            # カタカナ優勢文書でのひらがな→カタカナ強制候補を先頭に注入（単字）
            forced = span_data.get("_forced_candidate")
            if forced:
                candidates = [forced] + [c for c in candidates if c != forced][:4]

            # カタカナ優勢文書でのひらがな bigram 候補を注入（自動適用なし、ユーザー選択のみ）
            # grammar_validator suggestion 注入よりも前に処理し、最終候補リストの末尾に追加。
            # dict/shape 由来の有力候補がない場合（self-fallback のみ）は先頭に昇格する。
            kata_bigram = span_data.get("_kata_bigram_candidate")
            if kata_bigram and kata_bigram not in candidates:
                if candidates == [text_span]:
                    candidates = [kata_bigram, text_span]
                elif len(candidates) < 5:
                    candidates.append(kata_bigram)

            # soft hint: わり → ヨリ（manual_override_seed）
            # 適用条件: katakana_dominant + bigram suspect + suspectSpan == "わり" のみ
            # shape_pairs 昇格前の暫定候補。自動置換なし・UXコスト低減目的。
            soft_hint_candidates: dict = {}
            if (
                kata_bigram
                and text_span == "わり"
                and style_hints.particle_script == "katakana_dominant"
                and "ヨリ" not in candidates
                and len(candidates) < 5
            ):
                candidates.append("ヨリ")
                soft_hint_candidates["ヨリ"] = "manual_override_seed"

            # GrammarValidator による検証
            # _direct_candidates（ノイズスパン）は reject で即確定、それ以外は通常検証
            if direct_candidates is not None:
                vr = ValidationResult(verdict='reject', score=0.0, reason=span_data['reason'])
            else:
                pre_vr = span_data.get("_validation_result")
                if pre_vr is not None:
                    vr = pre_vr
                else:
                    vr = self.grammar_validator.validate_span(text_span, ocr_conf)

            validation_dict = vr.to_dict() if vr is not None else None

            # 高信頼 accept スパンの候補後処理:
            # grammar_validator が accept かつ score >= 0.90 のとき、
            # 辞書・字形テーブルに根拠のない bonus-only 候補（proper_noun 等）を除去する。
            # 強制候補注入スパン（ひらがな誤認等）は対象外。
            if (
                not forced
                and direct_candidates is None
                and vr is not None
                and vr.verdict == "accept"
                and vr.score >= 0.90
                and proper_noun_terms
            ):
                candidates = self.generate_candidates(
                    text_span,
                    is_protected=span_data.get("is_protected", False),
                    domain_hint=domain_hint,
                    file_context_hint=file_context_hint,
                    proper_noun_terms=proper_noun_terms,
                    suppress_bonus_only=True,
                    geo_noun_terms=geo_noun_terms,
                )

            # grammar_validator suggestion injection:
            # suppress_bonus_only 後に self-fallback しか残らない場合、
            # または dict/shape 候補がなく bonus-only のみの場合に、
            # grammar_validator の正規候補を先頭へ注入する。
            # dict/shape 由来の有力候補がある場合（suppress 後も候補が残る場合）は注入しない。
            if (
                not forced
                and direct_candidates is None
                and vr is not None
                and vr.suggestion is not None
            ):
                _sugg = vr.suggestion.suggested_candidate
                if _sugg and _sugg != text_span:
                    if candidates == [text_span]:
                        # Condition A: self-fallback（suppress 後、または dict/shape 候補なし）
                        candidates = [_sugg, text_span]
                    elif file_context_hint:
                        # Condition B: suppress test — dict/shape 候補の有無を確認
                        # suppress 後も self-fallback なら bonus-only 候補しか存在しない
                        # (proper_noun_terms ではなく file_context_hint で判定: region alias bonus-only も捕捉)
                        _suppressed = self.generate_candidates(
                            text_span,
                            is_protected=span_data.get("is_protected", False),
                            domain_hint=domain_hint,
                            file_context_hint=file_context_hint,
                            proper_noun_terms=proper_noun_terms,
                            suppress_bonus_only=True,
                            geo_noun_terms=geo_noun_terms,
                        )
                        if _suppressed == [text_span]:
                            candidates = [_sugg, text_span]

            # clean_text 内の全出現位置を列挙し、出現ごとにエントリを生成する
            search_pos = 0
            while True:
                pos = clean_text.find(text_span, search_pos)
                if pos == -1:
                    break
                # 同じ開始位置により長いスパンが存在する場合はこの短スパンをスキップ
                if _longest_at.get(pos, 0) > len(text_span):
                    search_pos = pos + 1
                    continue
                # 単字 _forced_candidate の出現が bigram で覆われた位置に重なる場合はスキップ
                # （bigram「わり」が pos=7 を覆う場合、単字「わ」の pos=7 と「り」の pos=8 を除外）
                if forced and len(text_span) == 1 and pos in _bigram_covered_positions:
                    search_pos = pos + 1
                    continue
                occ_idx = occurrence_counters.get(text_span, 0)
                occurrence_counters[text_span] = occ_idx + 1
                rank1 = candidates[0] if candidates else ""
                _shape_cands = self.shape_detector.lookup(text_span) if self.shape_detector else {}
                results.append({
                    "suspect_span": text_span,
                    "start": pos,
                    "end": pos + len(text_span),
                    "occurrence_index": occ_idx,
                    "reason": span_data["reason"],
                    "confidence": span_data.get("confidence", 1.0),
                    "is_protected": span_data.get("is_protected", False),
                    "candidates": candidates,
                    "validation": validation_dict,
                    "is_bigram_suspect": bool(span_data.get("_kata_bigram_candidate")),
                    "soft_hint_candidates": soft_hint_candidates,
                    "rank1_is_proper_noun": bool(rank1 and proper_noun_terms and rank1 in proper_noun_terms),
                    "rank1_from_shape": bool(rank1 and rank1 in _shape_cands),
                })
                search_pos = pos + len(text_span)
            # clean_text に出現しないスパン（OCR JSON 由来の文字が正規化後に消えた場合等）は除外

        # フロントエンドの逐次レンダリングが正しく機能するよう出現位置順にソート
        results.sort(key=lambda r: r["start"])

        # ドキュメント種別判定（clean_text と frontmatter を使用）
        doc_type_result = self.doc_type_detector.detect(clean_text, frontmatter)
        doc_type = doc_type_result["type"]
        doc_type_confidence = doc_type_result["confidence"]
        doc_type_source = doc_type_result["source"]

        # 助詞正規化候補件数（classical のときのみカウント、現在ページのテキストを対象）
        particle_count = self.count_particle_normalization_candidates(clean_text, doc_type)

        # proper_noun ボーナス関与スパンを correction_events.jsonl に記録
        if self.eval_dir and proper_noun_terms:
            self._log_proper_noun_events(
                filename, region_info, results, proper_noun_terms
            )

        return results, clean_text, doc_type, doc_type_confidence, doc_type_source, particle_count, style_hints

    def _log_proper_noun_events(
        self,
        filename: str,
        region_info: Dict[str, Any],
        results: List[Dict[str, Any]],
        proper_noun_terms: set,
    ) -> None:
        """
        proper_noun ボーナスが候補に関与したスパンを correction_events.jsonl に記録する。
        proper_noun 関与なしのスパンはスキップしてノイズを抑制する。
        """
        from pathlib import Path
        from datetime import datetime, timezone

        log_dir = Path(self.eval_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "correction_events.jsonl"

        timestamp = datetime.now(timezone.utc).isoformat()
        region = region_info.get("region", "")
        region_multiplier = region_info.get("region_multiplier", 1.0)

        entries = []
        for span in results:
            candidates = span.get("candidates", [])
            pn_involved = [c for c in candidates if c in proper_noun_terms]
            if not pn_involved:
                continue
            rank1 = candidates[0] if candidates else ""
            entries.append({
                "timestamp": timestamp,
                "filename": filename,
                "region": region,
                "region_multiplier": region_multiplier,
                "suspect_span": span["suspect_span"],
                "candidates": candidates,
                "proper_noun_candidates": pn_involved,
                "rank1_candidate": rank1,
                "rank1_is_proper_noun": rank1 in proper_noun_terms,
                "source": "proper_noun",
            })

        if not entries:
            return
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                for entry in entries:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            print(f"[AIAnalyzer] correction_events log failed: {e}")

# 動作確認用スクリプト
if __name__ == "__main__":
    import os
    base_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "dictionaries")
    analyzer = AIAnalyzer(base_dir)
    
    # NDL OCR風のモックデータ（信頼度0.6以下が抽出対象）
    mock_ocr = {
        "lines": [
            {"text": "入會", "confidence": 0.55}, # 辞書あり(variants), 優先されるべき
            {"text": "山諍", "confidence": 0.45}, # 辞書あり(variants), 優先されるべき
            {"text": "侍", "confidence": 0.30}    # 辞書なし(モックで似た字形を返す)
        ]
    }
    
    print("\n--- 解析結果 ---")
    results = analyzer.analyze_document("入會 山諍 侍", mock_ocr, domain_hint="入会研究")
    print(json.dumps(results, ensure_ascii=False, indent=2))
