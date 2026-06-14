"""
test_frontmatter_extractor.py

Phase 1 frontmatter bonus — FrontmatterExtractor + BuildResult integration tests.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import pytest
from frontmatter_extractor import FrontmatterExtractor
from file_context_hint import FileContextHintBuilder, BuildResult, STANDALONE_BONUS_MAX


# ── FrontmatterExtractor unit tests ──────────────────────────────────────────


class TestFrontmatterExtractorNoise:
    """Noise filter: must NOT extract these tokens."""

    fe = FrontmatterExtractor()

    def test_url_excluded(self):
        assert self.fe.extract({'link': 'https://example.com/doc'}) == {}

    def test_pure_number_excluded(self):
        assert self.fe.extract({'year': '1887'}) == {}

    def test_date_excluded(self):
        assert self.fe.extract({'date': '1887-03-15'}) == {}

    def test_ascii_id_excluded(self):
        assert self.fe.extract({'id': 'doc-001-abc'}) == {}

    def test_single_char_excluded(self):
        assert self.fe.extract({'prefix': '甲'}) == {}

    def test_oversized_token_excluded(self):
        assert self.fe.extract({'note': 'あ' * 21}) == {}

    def test_tags_skip_key(self):
        assert self.fe.extract({'tags': ['古文書', '訴状']}) == {}

    def test_status_skip_key(self):
        assert self.fe.extract({'status': 'done'}) == {}

    def test_type_skip_key(self):
        assert self.fe.extract({'type': 'document'}) == {}

    def test_created_skip_key(self):
        assert self.fe.extract({'created': '2024-06-10'}) == {}


class TestFrontmatterExtractorExtraction:
    """Successful token extraction cases."""

    fe = FrontmatterExtractor()

    def test_person_field(self):
        result = self.fe.extract({'person': '田中次郎'})
        assert result == {'田中次郎': ['frontmatter:person']}

    def test_nakaguro_split(self):
        result = self.fe.extract({'person': '田中次郎・山田太郎'})
        assert '田中次郎' in result
        assert '山田太郎' in result
        assert result['田中次郎'] == ['frontmatter:person']

    def test_list_value(self):
        result = self.fe.extract({'persons': ['田中次郎', '山田太郎']})
        assert '田中次郎' in result
        assert '山田太郎' in result

    def test_subject_field(self):
        result = self.fe.extract({'subject': '土地境界争い'})
        assert '土地境界争い' in result
        assert result['土地境界争い'] == ['frontmatter:subject']

    def test_source_tag_format(self):
        result = self.fe.extract({'court': '甲府始審裁判所'})
        assert result['甲府始審裁判所'] == ['frontmatter:court']

    def test_none_frontmatter(self):
        assert self.fe.extract(None) == {}

    def test_empty_frontmatter(self):
        assert self.fe.extract({}) == {}

    def test_dedup_sources(self):
        # 同一 source が2度追加されないこと
        result = self.fe.extract({'collection': '甲府始審裁判所'})
        assert result['甲府始審裁判所'].count('frontmatter:collection') == 1


# ── BuildResult dataclass tests ──────────────────────────────────────────────


class TestBuildResult:
    """BuildResult is a dataclass (not a tuple) — must not be unpackable as 4-tuple."""

    builder = FileContextHintBuilder()

    def test_returns_build_result(self):
        r = self.builder.build(filename='test', frontmatter={'title': '訴状'})
        assert isinstance(r, BuildResult)

    def test_not_tuple_unpackable(self):
        r = self.builder.build(filename='test')
        with pytest.raises(TypeError):
            a, b, c, d = r  # noqa: F841  — must fail

    def test_fields_accessible(self):
        r = self.builder.build(filename='test', frontmatter={'person': '田中次郎'})
        assert isinstance(r.hints, dict)
        assert isinstance(r.proper_noun_terms, set)
        assert isinstance(r.region_info, dict)
        assert isinstance(r.geo_noun_terms, set)
        assert isinstance(r.hint_sources, dict)

    def test_hint_sources_populated(self):
        r = self.builder.build(filename='test', frontmatter={'person': '田中次郎', 'region': '山梨'})
        assert '田中次郎' in r.hint_sources
        assert r.hint_sources['田中次郎'] == ['frontmatter:person']

    def test_hint_sources_excludes_skip_keys(self):
        r = self.builder.build(filename='test', frontmatter={'tags': ['古文書'], 'person': '田中次郎'})
        # tags は skip key — hint_sources に含まれてはいけない
        for key_sources in r.hint_sources.values():
            assert 'frontmatter:tags' not in key_sources


# ── Frontmatter bonus scoring tests ──────────────────────────────────────────


class TestFrontmatterBonusScoring:
    """Bonus values and safety caps."""

    builder = FileContextHintBuilder()

    def test_frontmatter_token_bonus_applied(self):
        r = self.builder.build(filename='test', frontmatter={'person': '田中次郎'})
        assert r.hints.get('田中次郎', 0.0) >= 25.0

    def test_frontmatter_token_not_in_proper_noun_terms(self):
        r = self.builder.build(filename='test', frontmatter={'person': '田中次郎'})
        assert '田中次郎' not in r.proper_noun_terms

    def test_frontmatter_bonus_below_shape_score(self):
        # 辞書・字形なしの frontmatter-only 候補は shape_score(50) 未満のはず
        r = self.builder.build(filename='test', frontmatter={'court': '甲府始審裁判所'})
        bonus = r.hints.get('甲府始審裁判所', 0.0)
        shape_score = 50.0
        assert bonus < shape_score, f"bonus {bonus} should be < shape_score {shape_score}"

    def test_standalone_bonus_max_constant(self):
        assert STANDALONE_BONUS_MAX == 25.0

    def test_frontmatter_token_bonus_exceeds_standalone_max(self):
        # FM token (26.0) > STANDALONE_BONUS_MAX (25.0) — tie-break design
        from file_context_hint import _BONUS_FRONTMATTER_TOKEN
        assert _BONUS_FRONTMATTER_TOKEN > STANDALONE_BONUS_MAX


# ── rank1_from_frontmatter detection tests ───────────────────────────────────


class TestRank1FromFrontmatter:
    """rank1_from_frontmatter flag: fires iff rank1 is in hint_sources."""

    builder = FileContextHintBuilder()

    def test_frontmatter_token_is_in_hint_sources(self):
        r = self.builder.build(filename='test', frontmatter={'person': '田中次郎'})
        assert '田中次郎' in r.hint_sources

    def test_region_alias_is_in_hint_sources(self):
        r = self.builder.build(filename='test', frontmatter={'region': '山梨'})
        assert '山梨' in r.hint_sources

    def test_proper_noun_from_yaml_not_in_hint_sources(self):
        # core.yaml 由来の語は hint_sources に含まれない（frontmatter 由来でないため）
        r = self.builder.build(filename='test', frontmatter={})
        # hint_sources は frontmatter 由来トークンのみ。空 FM → 空のはず
        assert r.hint_sources == {}

    def test_rank1_from_frontmatter_logic(self):
        r = self.builder.build(filename='test', frontmatter={'person': '田中次郎'})
        rank1 = '田中次郎'
        # Phase 2: prefix-based detection — must have at least one "frontmatter:" source
        assert bool(rank1 and any(
            s.startswith("frontmatter:") for s in r.hint_sources.get(rank1, [])
        ))

    def test_non_frontmatter_rank1_not_flagged(self):
        r = self.builder.build(filename='test', frontmatter={})
        rank1 = '官有地'  # core YAML 由来
        # No frontmatter: prefix → rank1_from_frontmatter = False
        assert not bool(rank1 and any(
            s.startswith("frontmatter:") for s in r.hint_sources.get(rank1, [])
        ))

    def test_body_token_does_not_trigger_rank1_from_frontmatter(self):
        # body: source must NOT satisfy rank1_from_frontmatter check
        r = self.builder.build(raw_markdown="[[田中次郎]] の件\n")
        rank1 = '田中次郎'
        has_frontmatter = any(
            s.startswith("frontmatter:") for s in r.hint_sources.get(rank1, [])
        )
        assert not has_frontmatter

    def test_rank1_from_body_logic(self):
        r = self.builder.build(raw_markdown="[[田中次郎]] の件\n")
        rank1 = '田中次郎'
        assert bool(rank1 and any(
            s.startswith("body:") for s in r.hint_sources.get(rank1, [])
        ))


class TestFrontmatterWikiLinkStripping:
    """修正③: FM WikiLink 形式の人名・地名が正しく抽出されること。"""

    fe = FrontmatterExtractor()

    def test_wikilink_person_emoji(self):
        # [[ontology/person/👤方県郡木田村]] → 方県郡木田村
        result = self.fe.extract({'plaintiff': ['[[ontology/person/👤方県郡木田村]]']})
        assert '方県郡木田村' in result
        assert result['方県郡木田村'] == ['frontmatter:plaintiff']

    def test_wikilink_building_emoji(self):
        # [[ontology/repository/🏛️東京高等裁判所]] → 東京高等裁判所
        result = self.fe.extract({'repository': '[[ontology/repository/🏛️東京高等裁判所]]'})
        assert '東京高等裁判所' in result

    def test_wikilink_display_text(self):
        # [[path/to/file|表示名]] → 表示名
        result = self.fe.extract({'judge': '[[ontology/person/👤someone|斎藤長二郎]]'})
        assert '斎藤長二郎' in result

    def test_wikilink_no_emoji(self):
        # [[ontology/court/東京上等裁判所]] → 東京上等裁判所
        result = self.fe.extract({'judgment_court': '[[ontology/court/東京上等裁判所]]'})
        assert '東京上等裁判所' in result

    def test_wikilink_list_multiple(self):
        # 複数人名リストが全て抽出される
        result = self.fe.extract({'defendant': [
            '[[ontology/person/👤厚見郡且嶋村]]',
            '[[ontology/person/👤糠田村]]',
        ]})
        assert '厚見郡且嶋村' in result
        assert '糠田村' in result

    def test_non_wikilink_unchanged(self):
        # WikiLink でない通常文字列はそのまま
        result = self.fe.extract({'person': '田中次郎'})
        assert '田中次郎' in result

    # ── v1.1.2 修正③ 追加テスト ──────────────────────────────────────────────

    def test_simple_wikilink_no_path(self):
        # [[入会権]] → 入会権 (path なし単純 WikiLink)
        result = self.fe.extract({'keyword': '[[入会権]]'})
        assert '入会権' in result

    def test_wikilink_display_overrides_page(self):
        # [[村落史|村落]] → 村落 (display text が page name より優先)
        result = self.fe.extract({'keyword': '[[村落史|村落]]'})
        assert '村落' in result
        assert '村落史' not in result

    def test_wikilink_heading_anchor_stripped(self):
        # [[近世法制史#検地]] → 近世法制史 (anchor 部分を除去してページ名を返す)
        result = self.fe.extract({'keyword': '[[近世法制史#検地]]'})
        assert '近世法制史' in result
        assert not any('#' in token for token in result)

    def test_wikilink_heading_anchor_with_display(self):
        # [[近世法制史#検地|検地]] → 検地 (display text が anchor より優先)
        result = self.fe.extract({'keyword': '[[近世法制史#検地|検地]]'})
        assert '検地' in result
        assert '近世法制史' not in result

    def test_wikilink_multiple_in_one_string(self):
        # 1つの値に複数 WikiLink が含まれる場合、それぞれ正規化される
        result = self.fe.extract({'related': '関連: [[入会権]] / [[山論|山論事件]]'})
        assert '入会権' in result
        assert '山論事件' in result

    # ── v1.1.2 edge cases ─────────────────────────────────────────────────────

    def test_wikilink_folder_path_with_anchor(self):
        # [[folder/page#anchor]] → page (path 区切り + anchor が同時に存在する場合)
        result = self.fe.extract({'source': '[[ontology/law/近世法制史#検地]]'})
        assert '近世法制史' in result
        assert not any('#' in token for token in result)

    def test_none_field_value_safe(self):
        # None 値フィールドはエラーなく空結果を返す
        result = self.fe.extract({'person': None})
        assert result == {}
