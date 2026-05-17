from typing import List, Dict
from dictionary_loader import DictionaryLoader


class CandidateEngine:
    """
    候補生成エンジン。
    将来の字形DB連携 / LLM再ランキング / 依存注入に備えてクラス化している。
    """

    # 字形類似検索モックテーブル（将来は字形DB or 外部APIに差し替え）
    _SHAPE_TABLE: Dict[str, List[str]] = {
        "入會": ["入会", "八会"],
        "山諍": ["山論", "出論"],
        "侍": ["待", "持"],
    }

    def __init__(self, dictionary_loader: DictionaryLoader) -> None:
        self.dictionary_loader = dictionary_loader

    def generate(
        self,
        suspect_span: str,
        is_protected: bool = False,
        domain_hint: str = "",
    ) -> List[str]:
        """
        疑義箇所に対して辞書・字形類似候補を組み合わせ、スコア順上位5件を返す。
        候補がない場合は suspect_span 自身をフォールバックとして返す。
        """
        scores: Dict[str, float] = {}

        # 1. 研究語彙辞書からの候補検索とスコアリング
        for term in self.dictionary_loader.terms:
            if suspect_span in term.all_forms:
                base = 100.0 + term.priority * 10
                if domain_hint and term.domain == domain_hint:
                    base += 20.0
                scores[term.normalized] = base
                # 保護対象の場合は元の字を最優先で維持する
                if term.protect:
                    scores[suspect_span] = base + 50.0

        # 2. 字形類似候補（モック: 将来は字形DB / 外部APIに差し替え）
        for cand in self._mock_shape_lookup(suspect_span):
            if cand not in scores:
                scores[cand] = 50.0

        # 3. LLM再ランキング（将来実装: scores を文脈で増減する）
        # scores = self._rerank_by_llm(suspect_span, scores, context="")

        top_k = [c for c, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)][:5]
        return top_k if top_k else [suspect_span]

    def _mock_shape_lookup(self, suspect_span: str) -> List[str]:
        return self._SHAPE_TABLE.get(suspect_span, [])
