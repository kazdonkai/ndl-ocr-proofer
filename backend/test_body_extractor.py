"""
test_body_extractor.py

Phase 2 body extractor — BodyExtractor unit tests.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import pytest
from body_extractor import BodyExtractor, _SKIP_LABELS


be = BodyExtractor()


# ── OCR callout exclusion ─────────────────────────────────────────────────────

class TestOCRCalloutExclusion:
    """OCR callout blocks must be fully excluded."""

    def test_ocr_lowercase_excluded(self):
        md = "> [!ocr]\n> 田中次郎\n"
        r = be.extract(md)
        assert '田中次郎' not in r

    def test_ocr_uppercase_excluded(self):
        md = "> [!OCR]\n> 山田太郎\n"
        r = be.extract(md)
        assert '山田太郎' not in r

    def test_ocr_mixed_case_excluded(self):
        md = "> [!Ocr]\n> 鈴木一郎\n"
        r = be.extract(md)
        assert '鈴木一郎' not in r

    def test_ocr_multiple_blocks_excluded(self):
        md = "> [!ocr]\n> 第一ページ\n\n> [!OCR]\n> 第二ページ\n"
        r = be.extract(md)
        assert '第一ページ' not in r
        assert '第二ページ' not in r

    def test_ocr_ends_on_empty_line(self):
        md = "> [!ocr]\n> OCR本文\n\n通常本文\n"
        r = be.extract(md)
        assert 'OCR本文' not in r
        assert '通常本文' in r

    def test_ocr_ends_on_next_callout(self):
        md = "> [!ocr]\n> OCR本文\n> [!NOTE]\n> ノート内容\n"
        r = be.extract(md)
        assert 'OCR本文' not in r
        assert 'ノート内容' in r


# ── Non-OCR callout inclusion ─────────────────────────────────────────────────

class TestNonOCRCalloutInclusion:
    """Non-OCR callouts must be included as body text."""

    def test_tip_callout_included(self):
        md = "> [!TIP]\n> 重要なヒント\n"
        r = be.extract(md)
        assert '重要なヒント' in r

    def test_note_callout_included(self):
        md = "> [!NOTE]\n> 注記内容\n"
        r = be.extract(md)
        assert '注記内容' in r

    def test_warning_callout_included(self):
        md = "> [!WARNING]\n> 警告内容\n"
        r = be.extract(md)
        assert '警告内容' in r

    def test_important_callout_included(self):
        md = "> [!IMPORTANT]\n> 重要事項\n"
        r = be.extract(md)
        assert '重要事項' in r

    def test_non_ocr_callout_header_line_excluded(self):
        # The header line itself (> [!NOTE]) is not extracted
        md = "> [!NOTE]\n> 注記内容\n"
        r = be.extract(md)
        # header content "NOTE" is ASCII → noise-filtered, not extracted
        for sources in r.values():
            assert all('NOTE' not in src for src in sources)


# ── WikiLink extraction ───────────────────────────────────────────────────────

class TestWikiLinkExtraction:
    """WikiLinks must have their text extracted with body:wikilink source."""

    def test_simple_wikilink(self):
        r = be.extract("[[田中次郎]] が申立てた\n")
        assert '田中次郎' in r
        assert 'body:wikilink' in r['田中次郎']

    def test_wikilink_with_display(self):
        r = be.extract("[[persons/田中次郎|田中次郎]] の件\n")
        assert '田中次郎' in r
        assert 'body:wikilink' in r['田中次郎']

    def test_wikilink_path_stripped(self):
        r = be.extract("[[cases/事件名]]\n")
        assert '事件名' in r

    def test_wikilink_extension_stripped(self):
        r = be.extract("[[田中次郎.md]]\n")
        assert '田中次郎' in r

    def test_wikilink_anchor_stripped(self):
        # [[近世法制史#検地]] → 近世法制史 (anchor part must be dropped)
        r = be.extract("[[近世法制史#検地]] を参照\n")
        assert '近世法制史' in r
        assert not any('#' in tok for tok in r)

    def test_wikilink_in_list_item(self):
        r = be.extract("- [[山田太郎]] の訴状\n")
        assert '山田太郎' in r
        assert 'body:wikilink' in r['山田太郎']


# ── Emoji stripping ───────────────────────────────────────────────────────────

class TestEmojiStripping:
    """Emoji characters must be stripped before token extraction."""

    def test_emoji_not_extracted_as_token(self):
        r = be.extract("📝 田中次郎 の申立て\n")
        # emoji 📝 should not appear as a token
        for tok in r:
            assert '📝' not in tok

    def test_text_adjacent_to_emoji_extracted(self):
        r = be.extract("📝 田中次郎 の申立て\n")
        assert '田中次郎' in r

    def test_multiple_emoji_stripped(self):
        r = be.extract("🎉🎊 山田太郎 🎈\n")
        assert '山田太郎' in r
        for tok in r:
            assert all(ord(c) < 0x1F300 or ord(c) > 0x1FAFF for c in tok)


# ── List item label skipping ──────────────────────────────────────────────────

class TestListItemLabelSkipping:
    """_SKIP_LABELS in list items must not be extracted as tokens."""

    @pytest.mark.parametrize("label", list(_SKIP_LABELS))
    def test_skip_label_not_extracted(self, label):
        md = f"- {label}: 山田太郎\n"
        r = be.extract(md)
        assert label not in r

    def test_value_after_skip_label_extracted(self):
        r = be.extract("- 原告: 田中次郎\n")
        assert '田中次郎' in r

    def test_bold_skip_label_not_extracted(self):
        r = be.extract("- **事件名**: 甲府始審裁判所\n")
        assert '事件名' not in r

    def test_bold_skip_label_value_extracted(self):
        r = be.extract("- **被告**: 山田太郎\n")
        assert '山田太郎' in r

    def test_non_skip_label_extracted(self):
        r = be.extract("- 土地: 甲州\n")
        assert '土地' in r

    def test_wikilink_in_skip_label_value_extracted(self):
        r = be.extract("- 原告: [[田中次郎]]\n")
        assert '田中次郎' in r
        assert 'body:wikilink' in r['田中次郎']


# ── Frontmatter exclusion ─────────────────────────────────────────────────────

class TestFrontmatterExclusion:
    """Frontmatter block must be skipped."""

    def test_frontmatter_values_not_extracted(self):
        md = "---\ntitle: テスト文書\nperson: 田中次郎\n---\n本文内容\n"
        r = be.extract(md)
        # frontmatter values not in body result
        assert 'テスト文書' not in r
        assert '田中次郎' not in r

    def test_body_after_frontmatter_extracted(self):
        md = "---\ntitle: テスト\n---\n本文内容\n"
        r = be.extract(md)
        assert '本文内容' in r

    def test_no_frontmatter_whole_body_extracted(self):
        md = "本文のみ\n"
        r = be.extract(md)
        assert '本文のみ' in r


# ── Noise filtering ───────────────────────────────────────────────────────────

class TestNoiseFiltering:
    """Same noise filters as FrontmatterExtractor."""

    def test_url_excluded(self):
        r = be.extract("詳細は https://example.com を参照\n")
        for tok in r:
            assert 'http' not in tok

    def test_pure_number_excluded(self):
        r = be.extract("1887年の出来事\n")
        assert '1887' not in r

    def test_date_like_excluded(self):
        r = be.extract("日付 1887-03-15 の記録\n")
        assert '1887-03-15' not in r

    def test_single_char_excluded(self):
        r = be.extract("甲 乙 丙\n")
        for tok in r:
            assert len(tok) >= 2

    def test_oversized_token_excluded(self):
        long_tok = 'あ' * 21
        r = be.extract(f"{long_tok}\n")
        assert long_tok not in r

    def test_ascii_id_excluded(self):
        r = be.extract("ID: doc-001-abc\n")
        assert 'doc-001-abc' not in r


# ── Source tags ───────────────────────────────────────────────────────────────

class TestSourceTags:
    """Source prefix correctness."""

    def test_regular_text_source(self):
        # 中黒で区切られていれば分割される（MeCab なしでも確実にトークン化できる形式で確認）
        r = be.extract("入会慣行・山論 に関する文書\n")
        assert '入会慣行' in r
        assert 'body:text' in r['入会慣行']

    def test_wikilink_source(self):
        r = be.extract("[[甲府始審裁判所]]\n")
        assert '甲府始審裁判所' in r
        assert 'body:wikilink' in r['甲府始審裁判所']

    def test_list_value_source(self):
        r = be.extract("- 土地: 甲州\n")
        assert '甲州' in r
        assert 'body:list_value' in r['甲州']

    def test_empty_markdown(self):
        assert be.extract("") == {}

    def test_none_equivalent(self):
        assert be.extract("") == {}


# ── BuildResult integration ───────────────────────────────────────────────────

class TestBuildResultBodyIntegration:
    """body tokens flow through FileContextHintBuilder into hint_sources."""

    from file_context_hint import FileContextHintBuilder, _BONUS_BODY_TOKEN

    builder = FileContextHintBuilder()

    def test_body_token_in_hints(self):
        from file_context_hint import FileContextHintBuilder
        b = FileContextHintBuilder()
        r = b.build(raw_markdown="[[田中次郎]] の件\n")
        assert '田中次郎' in r.hints

    def test_body_bonus_value(self):
        from file_context_hint import FileContextHintBuilder, _BONUS_BODY_TOKEN
        b = FileContextHintBuilder()
        r = b.build(raw_markdown="[[田中次郎]] の件\n")
        assert r.hints.get('田中次郎', 0.0) >= _BONUS_BODY_TOKEN

    def test_body_bonus_below_bonus_only_threshold(self):
        from file_context_hint import FileContextHintBuilder, _BONUS_BODY_TOKEN
        assert _BONUS_BODY_TOKEN < 20.0  # must not trigger bonus-only candidate generation

    def test_body_source_in_hint_sources(self):
        from file_context_hint import FileContextHintBuilder
        b = FileContextHintBuilder()
        r = b.build(raw_markdown="[[田中次郎]] の件\n")
        assert '田中次郎' in r.hint_sources
        assert any(s.startswith('body:') for s in r.hint_sources['田中次郎'])

    def test_ocr_callout_token_not_in_body_hints(self):
        from file_context_hint import FileContextHintBuilder
        b = FileContextHintBuilder()
        md = "> [!ocr]\n> OCR秘匿語\n\n通常本文\n"
        r = b.build(raw_markdown=md)
        assert 'OCR秘匿語' not in r.hint_sources or not any(
            s.startswith('body:') for s in r.hint_sources.get('OCR秘匿語', [])
        )

    def test_frontmatter_and_body_both_in_hint_sources(self):
        from file_context_hint import FileContextHintBuilder
        b = FileContextHintBuilder()
        fm = {'person': '田中次郎'}
        md = "---\nperson: 田中次郎\n---\n[[田中次郎]] の申立て\n"
        r = b.build(frontmatter=fm, raw_markdown=md)
        sources = r.hint_sources.get('田中次郎', [])
        has_fm = any(s.startswith('frontmatter:') for s in sources)
        has_body = any(s.startswith('body:') for s in sources)
        assert has_fm and has_body
