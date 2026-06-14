"""
test_fm_context_detection.py

AIAnalyzer.detect_fm_context_terms / _find_span_with_newlines の単体テスト。

テスト対象:
  1. _find_span_with_newlines: 改行またぎ span の再構成
  2. detect_fm_context_terms: FM 当事者名の疑義スパン検出
     - 連続一致（方県郡木田村）
     - 改行またぎ（厚見郡且嶋\n村）
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('VAULT_ROOT', os.path.dirname(__file__))

from ai_analyzer import AIAnalyzer


# ── Minimal stubs ─────────────────────────────────────────────────────────────

DICT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'dictionaries')


@pytest.fixture(scope='module')
def analyzer():
    return AIAnalyzer(dict_dir=DICT_DIR)


# ── _find_span_with_newlines ──────────────────────────────────────────────────

class TestFindSpanWithNewlines:

    def test_no_newline_in_text(self):
        # 改行なしのテキスト: 位置マップが正しく機能する
        result = AIAnalyzer._find_span_with_newlines(
            '方県郡木田村',
            '美濃国方県郡木田村ヨリ',
            '美濃国方県郡木田村ヨリ',
        )
        assert result == '方県郡木田村'

    def test_newline_before_term(self):
        result = AIAnalyzer._find_span_with_newlines(
            '方県郡木田村',
            '\n方県郡木田村ヨリ',
            '方県郡木田村ヨリ',
        )
        assert result == '方県郡木田村'

    def test_cross_newline_term(self):
        clean = '厚見郡且嶋\n村ヘ係ル'
        joined = '厚見郡且嶋村ヘ係ル'
        result = AIAnalyzer._find_span_with_newlines('厚見郡且嶋村', clean, joined)
        assert result == '厚見郡且嶋\n村'

    def test_cross_newline_embedded(self):
        clean = '美濃国厚見郡且嶋\n村ヘ係ル境界'
        joined = '美濃国厚見郡且嶋村ヘ係ル境界'
        result = AIAnalyzer._find_span_with_newlines('厚見郡且嶋村', clean, joined)
        assert result == '厚見郡且嶋\n村'

    def test_term_not_found_returns_empty(self):
        result = AIAnalyzer._find_span_with_newlines('存在しない語', '別のテキスト\n続き', '別のテキスト続き')
        assert result == ''

    def test_multiple_newlines_midterm(self):
        # term が複数の改行を跨ぐ場合（稀なケース）
        clean = 'A\nB\nC'
        joined = 'ABC'
        result = AIAnalyzer._find_span_with_newlines('ABC', clean, joined)
        assert result == 'A\nB\nC'


# ── detect_fm_context_terms ───────────────────────────────────────────────────

class TestDetectFmContextTerms:

    def test_contiguous_plaintiff(self, analyzer):
        clean = '美濃国方県郡木田村ヨリ同国厚見郡'
        hint_sources = {'方県郡木田村': ['frontmatter:plaintiff']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        assert any(s['suspect_span'] == '方県郡木田村' for s in spans)

    def test_contiguous_span_reason(self, analyzer):
        clean = '方県郡木田村ヨリ'
        hint_sources = {'方県郡木田村': ['frontmatter:plaintiff']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        span = next(s for s in spans if s['suspect_span'] == '方県郡木田村')
        assert span['confidence'] == 1.0
        assert 'フロントマター' in span['reason']

    def test_cross_newline_defendant(self, analyzer):
        # 改行またぎの場合、\n より前のプレフィックスが suspect_span になること
        clean = '美濃国厚見郡且嶋\n村ヘ係ル'
        hint_sources = {'厚見郡且嶋村': ['frontmatter:defendant']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        # suspect_span は \n を含まず、\n 前のプレフィックス '厚見郡且嶋' になる
        assert any(s['suspect_span'] == '厚見郡且嶋' for s in spans)
        # \n を含む形式は使用しない
        assert not any('\n' in s['suspect_span'] for s in spans)

    def test_cross_newline_direct_candidates_clean(self, analyzer):
        # 改行またぎスパンの candidates は改行なしの clean form であること
        clean = '同国厚見郡且嶋\n村ヘ'
        hint_sources = {'厚見郡且嶋村': ['frontmatter:defendant']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        span = next(s for s in spans if '且嶋' in s['suspect_span'])
        assert span.get('_direct_candidates') == ['厚見郡且嶋村']
        # suspect_span 自体は \n を含まないこと
        assert '\n' not in span['suspect_span']

    def test_cross_newline_validation_accept(self, analyzer):
        clean = '同国厚見郡且嶋\n村ヘ'
        hint_sources = {'厚見郡且嶋村': ['frontmatter:defendant']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        span = next(s for s in spans if '且嶋' in s['suspect_span'])
        vr = span.get('_validation_result')
        assert vr is not None
        assert vr.verdict == 'accept'

    def test_body_only_token_not_detected(self, analyzer):
        # body: source のみのトークンは FM 確認スパンとして検出しない
        clean = '方県郡木田村ヨリ'
        hint_sources = {'方県郡木田村': ['body:list_value']}  # frontmatter: なし
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        assert not any(s['suspect_span'] == '方県郡木田村' for s in spans)

    def test_short_token_filtered(self, analyzer):
        # 3文字以下は検出対象外
        clean = '木田村ヨリ'
        hint_sources = {'木田': ['frontmatter:plaintiff']}  # 2文字 → skip
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        assert not any(s['suspect_span'] == '木田' for s in spans)

    def test_judge_field_detected(self, analyzer):
        # judge フィールドも検出対象
        clean = '裁判長山田太郎ガ判決ヲ'
        hint_sources = {'山田太郎': ['frontmatter:judge']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        assert any(s['suspect_span'] == '山田太郎' for s in spans)

    def test_non_person_field_not_detected(self, analyzer):
        # subject/case_name 等は FM 確認スパン検出対象外
        clean = '境界争論終審裁判執行之儀'
        hint_sources = {'境界争論終審裁判執行之儀': ['frontmatter:case_name']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        assert not any('境界争論' in s['suspect_span'] for s in spans)

    def test_dedup_prevents_double_detection(self, analyzer):
        # 同一トークンは1回だけ検出される
        clean = '方県郡木田村ヨリ方県郡木田村'
        hint_sources = {'方県郡木田村': ['frontmatter:plaintiff']}
        spans = analyzer.detect_fm_context_terms(clean, hint_sources)
        plaintiff_spans = [s for s in spans if s['suspect_span'] == '方県郡木田村']
        assert len(plaintiff_spans) == 1
