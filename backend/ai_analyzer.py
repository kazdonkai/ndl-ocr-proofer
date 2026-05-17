import json
from typing import List, Dict, Any, Optional
from dictionary_loader import DictionaryLoader
from candidate_engine import CandidateEngine

class AIAnalyzer:
    """
    AI解析レイヤー: 疑義箇所の抽出と、候補文字の提示を担当するクラス
    研究語彙辞書(DictionaryLoader)を参照して精度を向上させます (Task D.4 / 2.1 / 2.2 統合)
    """

    def __init__(self, dict_dir: str, confidence_threshold: float = 0.6):
        self.confidence_threshold = confidence_threshold

        # 辞書の初期化と読み込み
        self.dictionary_loader = DictionaryLoader(dict_dir)
        self.dictionary_loader.load_all_approved()
        print(f"[AIAnalyzer] Loaded {len(self.dictionary_loader.terms)} dictionary terms.")

        # 候補生成エンジン（辞書ローダーを DI）
        self.candidate_engine = CandidateEngine(self.dictionary_loader)

        # TODO: 今後、LLMクライアント（OpenAI / Ollama）の初期化をここに追加する

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

    def detect_suspicious_by_context_llm(self, _text: str) -> List[Dict[str, Any]]:
        """
        LLMによる文脈ベース抽出（モック）。
        OCRスコアが高くても文脈破綻している「もっともらしい誤読」を拾う。
        """
        return []

    def generate_candidates(self, suspect_span: str, is_protected: bool = False, domain_hint: str = "") -> List[str]:
        """CandidateEngine へ委譲する薄いラッパー。"""
        return self.candidate_engine.generate(suspect_span, is_protected=is_protected, domain_hint=domain_hint)

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

    def analyze_document(self, text: str, ocr_json: Optional[Dict[str, Any]] = None, domain_hint: str = "") -> tuple[List[Dict[str, Any]], str]:
        """
        ドキュメント全文からOCR本文を抽出し、疑義箇所の抽出から候補生成までを一気通貫で行うメインAPI
        """
        from text_processor import OCRTextProcessor

        # [!ocr]ブロックがあればそこだけ抽出、なければ生テキストをそのまま正規化して使う
        clean_text = OCRTextProcessor.get_clean_text(text)
        if not clean_text:
            clean_text = OCRTextProcessor.normalize_text(text)
        
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
        
        # 2. 各疑義箇所への候補生成 + テキスト内位置情報の付与
        # スパンの重複を除去（同一テキストが複数の検出器で報告された場合に1つにまとめる）
        unique_spans = []
        seen: set[str] = set()
        for s in spans:
            if s["suspect_span"] not in seen:
                unique_spans.append(s)
                seen.add(s["suspect_span"])

        results = []
        # 同一 suspect_span テキストの出現番号を追跡するカウンター（0-indexed）
        occurrence_counters: dict[str, int] = {}

        for span_data in unique_spans:
            text_span = span_data["suspect_span"]
            candidates = self.generate_candidates(
                text_span,
                is_protected=span_data.get("is_protected", False),
                domain_hint=domain_hint
            )
            # clean_text 内の全出現位置を列挙し、出現ごとにエントリを生成する
            search_pos = 0
            while True:
                pos = clean_text.find(text_span, search_pos)
                if pos == -1:
                    break
                occ_idx = occurrence_counters.get(text_span, 0)
                occurrence_counters[text_span] = occ_idx + 1
                results.append({
                    "suspect_span": text_span,
                    "start": pos,
                    "end": pos + len(text_span),
                    "occurrence_index": occ_idx,
                    "reason": span_data["reason"],
                    "confidence": span_data.get("confidence", 1.0),
                    "is_protected": span_data.get("is_protected", False),
                    "candidates": candidates
                })
                search_pos = pos + len(text_span)
            # clean_text に出現しないスパン（OCR JSON 由来の文字が正規化後に消えた場合等）は除外

        # フロントエンドの逐次レンダリングが正しく機能するよう出現位置順にソート
        results.sort(key=lambda r: r["start"])

        return results, clean_text

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
