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
        candidates = engine_empty.generate(
            "甲州街",  # 3文字 → Ls=3、フィルタ対象外
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
        )
        # 文字数差チェック: |3 - 2| = 1 ≤ 1 → bonus-only 追加可能
        assert "甲州" in candidates

    def test_non_geo_term_not_suppressed_for_short_span(self, engine_empty):
        """geo_noun_terms に含まれない語は短スパンでも除外されない"""
        file_ctx = {"入会": 30.0, "山論": 25.0}
        geo_terms = set()  # 空（core.yaml由来の法制語を想定）
        candidates = engine_empty.generate(
            "入会",
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
        )
        assert "入会" in candidates or "山論" in candidates  # どちらかは残る

    def test_geo_filter_requires_geo_noun_terms_set(self, engine_empty):
        """geo_noun_terms=None のとき、フィルタは適用されない"""
        file_ctx = {"三河": 30.0}
        candidates = engine_empty.generate(
            "三",
            file_context_hint=file_ctx,
            geo_noun_terms=None,
        )
        # geo_noun_terms=None → フィルタなし → 三河が候補に入りうる
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
        """geo alias は除外されるが、非 geo bonus-only 語は残る"""
        file_ctx = {
            "三河": 30.0,   # geo → 除外
            "三石": 25.0,   # 非 geo → 残る
        }
        geo_terms = {"三河"}
        candidates = engine_empty.generate(
            "三石",  # 2文字
            file_context_hint=file_ctx,
            geo_noun_terms=geo_terms,
        )
        assert "三河" not in candidates
        assert "三石" in candidates  # suspect_span 自体は常に残る（フォールバック）


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
