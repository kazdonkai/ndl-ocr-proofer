from typing import List, Dict, Optional, Set, TYPE_CHECKING
import unicodedata
from dictionary_loader import DictionaryLoader
from file_context_hint import STANDALONE_BONUS_MAX  # bonus-only candidate cap

if TYPE_CHECKING:
    from shape_detector import ShapeDetector


def _dominant_script(text: str) -> str:
    """Return the dominant script class of text: 'ascii', 'kanji', 'kana', or 'mixed'.

    'ascii' は text が ASCII 文字のみで構成される場合（英数字・記号など）。
    この分類は bonus-only 候補の字種互換チェックで使用する。
    """
    if text and all(ord(c) < 128 for c in text):
        return 'ascii'
    kanji = kana = 0
    for ch in text:
        n = unicodedata.name(ch, '')
        if 'CJK UNIFIED' in n or 'CJK COMPATIBILITY' in n:
            kanji += 1
        elif 'KATAKANA' in n or 'HIRAGANA' in n:
            kana += 1
    total = kanji + kana
    if total == 0:
        return 'mixed'
    if kanji / total >= 0.8:
        return 'kanji'
    if kana / total >= 0.8:
        return 'kana'
    return 'mixed'


def _compat_char_type(span: str, candidate: str) -> bool:
    """
    bonus-only 候補の字種互換チェック。
    span が ASCII（英数字等）なら candidate も ASCII であること。
      → 「2」「l」等の英数字誤認スパンに漢字語が bonus-only で滑り込まないよう遮断。
    span が漢字主体なら candidate にも漢字が含まれること、
    span がかな主体なら candidate にもかなが含まれることを要求する。
    """
    ds = _dominant_script(span)
    dc = _dominant_script(candidate)
    if ds == 'ascii':
        return dc == 'ascii'  # ASCII スパンに漢字・かな bonus-only 候補は不適
    if ds == 'kanji':
        return dc in ('kanji', 'mixed')
    if ds == 'kana':
        return dc in ('kana', 'mixed')
    return True  # mixed span は制限しない


class CandidateEngine:
    """
    候補生成エンジン。
    将来の字形DB連携 / LLM再ランキング / 依存注入に備えてクラス化している。
    """

    def __init__(
        self,
        dictionary_loader: DictionaryLoader,
        shape_detector: Optional["ShapeDetector"] = None,
    ) -> None:
        self.dictionary_loader = dictionary_loader
        self.shape_detector = shape_detector

    def generate(
        self,
        suspect_span: str,
        is_protected: bool = False,
        domain_hint: str = "",
        file_context_hint: Optional[Dict[str, float]] = None,
        proper_noun_terms: Optional[Set[str]] = None,
        suppress_bonus_only: bool = False,
        geo_noun_terms: Optional[Set[str]] = None,
    ) -> List[str]:
        """
        疑義箇所に対して辞書・字形類似候補を組み合わせ、スコア順上位5件を返す。
        候補がない場合は suspect_span 自身をフォールバックとして返す。

        Scoring tiers:
          shape_score    (1): 字形類似 — 50.0
          context_score  (2): 辞書ヒット — 100.0 + priority * 10
          domain_bonus   (3): domain_hint (辞書フィールド) — +20.0
          file_ctx_bonus (4): file_context_hint (Phase 1-c) — +variable

        proper_noun_terms: file_context_hint のうち proper_nouns yaml 由来の語セット。
          bonus-only 候補（辞書・字形テーブル未登録）がこのセットに属する場合、
          STANDALONE_BONUS_MAX (25.0) でキャップし、shape_score(50) より下位にする。
        """
        scores: Dict[str, float] = {}

        # 1. 研究語彙辞書からの候補検索とスコアリング
        for term in self.dictionary_loader.terms:
            if suspect_span in term.all_forms:
                base = 100.0 + term.priority * 10
                if domain_hint and term.domain == domain_hint:
                    base += 20.0
                # experimental 辞書語は stable より下位に留める (×0.8)
                if term.tier == "experimental":
                    base *= 0.8
                scores[term.normalized] = base
                # 保護対象の場合は元の字を最優先で維持する
                if is_protected and term.protect:
                    scores[suspect_span] = base + 50.0

        # 2. 字形類似候補（Phase 1-a ShapeDetector）
        if self.shape_detector:
            for cand, score in self.shape_detector.lookup(suspect_span).items():
                if cand not in scores:
                    scores[cand] = score
        else:
            for cand in self._mock_shape_lookup(suspect_span):
                if cand not in scores:
                    scores[cand] = 50.0

        # 3. File-context domain bonus (Phase 1-c)
        # bonus-only 追跡: dict/shape でスコアが付いた候補を記録しておく
        pre_file_ctx: Set[str] = set(scores.keys())

        if file_context_hint:
            Ls = len(suspect_span)
            for cand in list(scores.keys()):
                bonus = file_context_hint.get(cand, 0.0)
                if bonus > 0.0:
                    # length_penalty: proper_noun bonus を半減 (|Ls - Lc| >= 2 のとき)
                    if proper_noun_terms and cand in proper_noun_terms and abs(Ls - len(cand)) >= 2:
                        bonus *= 0.5
                    scores[cand] = scores[cand] + bonus
            # bonus-only candidate (not yet in scores via dict or shape)
            for term, bonus in file_context_hint.items():
                if term not in scores and bonus >= 20.0:
                    # フィルタ①: 文字数差 ±1 超は bonus-only としては不適 (spec item 2)
                    if abs(Ls - len(term)) > 1:
                        continue
                    # フィルタ②: 字種パターン互換チェック (spec item 2)
                    if not _compat_char_type(suspect_span, term):
                        continue
                    # フィルタ③: 2文字以下スパンへの geo alias ノイズ抑制
                    # prefectures/regional 由来の地名 alias が短スパンに bonus-only で滑り込むのを防ぐ
                    # core.yaml 由来の法制語・一般語（入会・山論等）は geo_noun_terms に含まれないため対象外
                    if geo_noun_terms and term in geo_noun_terms and Ls < 3:
                        continue
                    # proper_noun 由来の bonus-only 候補は STANDALONE_BONUS_MAX でキャップ。
                    # 辞書・字形テーブルに根拠がない語が shape 候補(50pt)を超えないようにする。
                    if proper_noun_terms and term in proper_noun_terms:
                        scores[term] = min(bonus, STANDALONE_BONUS_MAX)
                    else:
                        scores[term] = bonus

        # bonus-only 候補セット = step 3 で初めてスコアが付いた候補
        bonus_only: Set[str] = set(scores.keys()) - pre_file_ctx

        # 4. LLM re-ranking stub (Phase 2: Ollama — scores を文脈で増減する)
        # scores = self._rerank_by_llm(suspect_span, scores, context="")

        # TODO(1-pass): 現状は suppress_bonus_only=True のとき ai_analyzer が
        # generate_candidates() を2回呼んでいる。将来的には、1回目の生成時に
        # bonus_only セットをタプルとして返す (candidates, bonus_only_set) に変更し、
        # 呼び出し側で suppress をフィルタとして適用することで再生成を不要にする。

        top_k = [c for c, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)][:5]

        # suppress_bonus_only=True のとき bonus-only 候補をリストから除外
        if suppress_bonus_only and bonus_only:
            top_k = [c for c in top_k if c not in bonus_only]

        return top_k if top_k else [suspect_span]

    # Phase 1-a 実装前の字形類似スタブテーブル。ShapeDetector が注入された場合は使用されない。
    _SHAPE_TABLE: Dict[str, List[str]] = {}

    def _mock_shape_lookup(self, suspect_span: str) -> List[str]:
        return self._SHAPE_TABLE.get(suspect_span, [])
