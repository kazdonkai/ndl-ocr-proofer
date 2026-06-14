"""
test_candidate_engine_geo.py

Task 2 (GEO_ALIAS_NOISE_MITIGATION / Option B) 検証:
  - bonus-only ループで geo alias かつ len(span) < 3 の候補が除外される
  - len(span) >= 3 のスパンには影響しない
  - geo_noun_terms に含まれない語は短スパンでも除外されない
  - dict/shape 候補と共存する geo 語は suppression されない（bonus-only 条件を満たさないため）
"""

import pytest
from candidate_engine import CandidateEngine
from models import DictionaryTerm


# ── Minimal DictionaryLoader stub ─────────────────────────────────────────────

class _EmptyLoader:
    """terms が空の最小スタブ。"""
    terms = []


class _WithTermLoader:
    """申立候 を持つスタブ。"""
    terms = [
        DictionaryTerm(
            term="申立候",
            normalized="申立候",
            variants=[],
            reading="もうしたてそうろう",
            category="候文語形",
            domain="古文書",
            priority=3,
            protect=False,
            source="test",
            approved=True,
            tier="stable",
        )
    ]


@pytest.fixture
def engine_empty():
    return CandidateEngine(_EmptyLoader())


@pytest.fixture
def engine_with_term():
    return CandidateEngine(_WithTermLoader())


# ── Task 2: geo alias 短スパン抑制 ────────────────────────────────────────────

class TestGeoNoiseSuppression:
    def test_1char_span_geo_alias_suppressed(self, engine_empty):
        """1文字スパンへの geo alias bonus-only は除外される"""
        file_ctx = {"三河": 30.0, "尾張": 25.0}
        geo_terms = {"三河", "尾張"}
        candidates = engine_empty.generate(
            "三",
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
        )
        assert "三河" not in candidates
        assert "尾張" not in candidates

    def test_2char_span_geo_alias_suppressed(self, engine_empty):
        """2文字スパンへの geo alias bonus-only も除外される（len < 3）"""
        file_ctx = {"伊勢": 30.0, "伊賀": 28.0}
        geo_terms = {"伊勢", "伊賀"}
        candidates = engine_empty.generate(
            "伊勢",  # 2文字 → Ls=2 < 3
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
        )
        # 伊勢 はすでに suspect_span だが bonus-only 登録されるため、
        # geo フィルタでスキップされる（dict/shape 未登録の場合）
        # フォールバックで [伊勢] のみが返る
        assert "伊賀" not in candidates

    def test_3char_span_geo_alias_not_suppressed(self, engine_empty):
        """3文字スパンへの geo alias は抑制されない"""
        file_ctx = {"甲州": 30.0}
        geo_terms = {"甲州"}
        proper_nouns = {"甲州"}  # proper_noun_terms 由来 → bonus-only 生成許可
        candidates = engine_empty.generate(
            "甲州街",  # 3文字 → Ls=3、geo フィルタ対象外
            file_context_hint=file_ctx,
            proper_noun_terms=proper_nouns,
            geo_noun_terms=geo_terms,
        )
        # 文字数差チェック: |3 - 2| = 1 ≤ 1 → bonus-only 追加可能
        assert "甲州" in candidates

    def test_non_geo_term_not_suppressed_for_short_span(self, engine_empty):
        """geo_noun_terms に含まれない語（core.yaml 由来法制語）は短スパンでも除外されない"""
        file_ctx = {"入会": 30.0, "山論": 25.0}
        proper_nouns = {"入会", "山論"}  # proper_noun_terms 由来 → bonus-only 生成許可
        geo_terms = set()  # 空（core.yaml 由来は geo ではない）
        candidates = engine_empty.generate(
            "入会",
            file_context_hint=file_ctx,
            proper_noun_terms=proper_nouns,
            geo_noun_terms=geo_terms,
        )
        assert "入会" in candidates or "山論" in candidates  # どちらかは残る

    def test_geo_filter_requires_geo_noun_terms_set(self, engine_empty):
        """geo_noun_terms=None のとき geo フィルタは適用されない"""
        file_ctx = {"三河": 30.0}
        proper_nouns = {"三河"}  # proper_noun_terms 由来 → bonus-only 生成許可
        candidates = engine_empty.generate(
            "三",
            file_context_hint=file_ctx,
            proper_noun_terms=proper_nouns,
            geo_noun_terms=None,
        )
        # geo_noun_terms=None → geo フィルタなし → 三河が候補に入る
        # （文字数差チェック: |1-2|=1 ≤ 1、字種チェックも通過）
        assert "三河" in candidates

    def test_geo_alias_with_dict_hit_not_filtered(self, engine_with_term):
        """dict ヒット済みの語は bonus-only でないためフィルタ対象外

        geo フィルタは bonus-only ループ（term not in scores）にのみ適用される。
        dict 検索で scores に追加済みの語は bonus-only ループに入らないため、
        geo_noun_terms に含まれていてもスコアから除外されない。
        """
        # suspect_span="申立候" は dict の all_forms にマッチ → scores に追加 → bonus-only でない
        file_ctx = {"申立候": 30.0}
        geo_terms = {"申立候"}  # 意図的に geo_noun_terms に入れて確認
        candidates = engine_with_term.generate(
            "申立候",  # dict の all_forms にマッチする span
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
        )
        # dict ヒット → pre_file_ctx に含まれる → bonus-only ループはスキップ → geo フィルタ不適用
        assert "申立候" in candidates

    def test_mixed_geo_and_non_geo_short_span(self, engine_empty):
        """geo alias は除外されるが、非 geo の proper_noun_terms 語は残る"""
        file_ctx = {
            "三河": 30.0,   # geo + proper_noun → geo フィルタで除外
            "三石": 25.0,   # proper_noun だが非 geo → bonus-only 生成可
        }
        proper_nouns = {"三河", "三石"}  # 両方 proper_noun_terms
        geo_terms = {"三河"}            # 三河のみ geo
        candidates = engine_empty.generate(
            "三石",  # 2文字
            file_context_hint=file_ctx,
            proper_noun_terms=proper_nouns,
            geo_noun_terms=geo_terms,
        )
        assert "三河" not in candidates
        assert "三石" in candidates  # 非 geo の proper_noun → 残る


# ── Phase 2 ポリシー: FM/body トークンは bonus-only 候補を生成しない ──────────────

class TestFMBodyNotBonusOnly:
    """FM/body 由来トークンは proper_noun_terms に含まれない限り bonus-only 候補を生成しない。

    Phase 2 設計変更: _BONUS_FRONTMATTER_TOKEN=26.0 / _BONUS_BODY_TOKEN=15.0 は
    既存候補への加点には使われるが、新規候補の bonus-only 生成は引き起こさない。
    """

    def test_fm_metadata_token_not_bonus_only(self, engine_empty):
        """FM metadata 語（proper_noun_terms 外）は高スコアでも bonus-only にならない"""
        # 実ファイル観測: 裁判言渡書案(71pt) が田中義忠(4文字) に割り込む問題の再現
        file_ctx = {"裁判言渡書案": 71.0, "裁断言渡書": 41.0, "熊谷裁判所": 41.0}
        candidates = engine_empty.generate(
            "田中義忠",
            file_context_hint=file_ctx,
            proper_noun_terms=set(),  # FM/body 由来のみ → bonus-only 不可
        )
        assert "裁判言渡書案" not in candidates
        assert "裁断言渡書" not in candidates
        assert "熊谷裁判所" not in candidates

    def test_fm_metadata_token_not_bonus_only_when_proper_noun_terms_none(self, engine_empty):
        """proper_noun_terms=None でも FM metadata 語は bonus-only にならない"""
        file_ctx = {"裁判言渡書案": 71.0}
        candidates = engine_empty.generate(
            "田中義忠",
            file_context_hint=file_ctx,
            proper_noun_terms=None,
        )
        assert "裁判言渡書案" not in candidates

    def test_proper_noun_still_generates_bonus_only(self, engine_empty):
        """proper_noun_terms に含まれる語は引き続き bonus-only 候補を生成できる"""
        file_ctx = {"田中次郎": 26.0}
        proper_nouns = {"田中次郎"}
        candidates = engine_empty.generate(
            "田中次朗",  # 4文字、字形混同
            file_context_hint=file_ctx,
            proper_noun_terms=proper_nouns,
        )
        assert "田中次郎" in candidates

    def test_fm_token_boosts_existing_dict_candidate(self, engine_with_term):
        """FM 由来トークンが辞書ヒット済み候補のスコアを上積みできること（加点機能は維持）"""
        # 「申立候」は dict に登録済み → scores に追加される → FM bonus +26pt が加算される
        file_ctx = {"申立候": 26.0}
        candidates = engine_with_term.generate(
            "申立候",
            file_context_hint=file_ctx,
            proper_noun_terms=set(),  # proper_noun_terms 外でも既存候補への加点は有効
        )
        assert "申立候" in candidates  # dict ヒット + FM bonus → rank1 維持


# ── suppress_bonus_only との組み合わせ ──────────────────────────────────────────

class TestSuppressBonusOnlyWithGeo:
    def test_geo_filtered_before_suppress_bonus_only(self, engine_empty):
        """geo フィルタは bonus-only suppress より先に適用される"""
        file_ctx = {"三河": 30.0}
        geo_terms = {"三河"}
        # suppress_bonus_only=True でも geo は既にフィルタ済み → 同じ結果
        candidates_geo = engine_empty.generate(
            "三",
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
            suppress_bonus_only=False,
        )
        candidates_supp = engine_empty.generate(
            "三",
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
            suppress_bonus_only=True,
        )
        # どちらも三河は除外される
        assert "三河" not in candidates_geo
        assert "三河" not in candidates_supp
