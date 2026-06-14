"""
frontmatter_extractor.py — Generic frontmatter → token extractor.

Iterates over all frontmatter fields and returns a token → source mapping
for use in FileContextHintBuilder (Phase 1 frontmatter bonus).

Design constraints:
  - No hyphen splitting (safe-side: "田中-次郎" or "1868-1912" must not split)
  - Split only on whitespace and 中黒 (・)
  - Noise filters: URL, pure numbers, dates, single-char, ID-like ASCII strings, oversized tokens
  - Skip metadata-only keys (tags, aliases, status, date, etc.)
"""

import re
from typing import Optional

# Splits on whitespace variants and 中黒 only — no hyphens
_SPLIT_RE = re.compile(r'[\s　・、,，]+')

# WikiLink: [[path/to/file]] or [[path|display]] → extract display or last path component
_WIKILINK_RE = re.compile(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]')

_URL_RE = re.compile(r'https?://')
_PURE_NUM_RE = re.compile(r'^\d+$')
# Date-like: 1868, 1868-1912, 1868/03, 2024-06-10, etc.
_DATE_RE = re.compile(r'^\d{4}([-/]\d{1,2}){0,2}$')
# All-ASCII (letters/digits/underscore/hyphen): likely an ID, slug, or code field value
_ASCII_ONLY_RE = re.compile(r'^[A-Za-z0-9_\-]+$')

_TOKEN_MIN_LEN = 2
_TOKEN_MAX_LEN = 20

# Keys whose values carry no document-content signal
_SKIP_KEYS: frozenset[str] = frozenset({
    'tags', 'aliases', 'cssclass', 'cssclasses', 'banner',
    'created', 'modified', 'updated', 'date', 'publish',
    'status', 'type', 'template', 'layout',
    'analyzed_status', 'ocr_status',
    'id', 'uuid', 'permalink', 'url', 'link',
})


def _is_noise(token: str) -> bool:
    if len(token) < _TOKEN_MIN_LEN or len(token) > _TOKEN_MAX_LEN:
        return True
    if _URL_RE.search(token):
        return True
    if _PURE_NUM_RE.match(token):
        return True
    if _DATE_RE.match(token):
        return True
    if _ASCII_ONLY_RE.match(token):
        return True
    return False


class FrontmatterExtractor:
    """
    Extract named tokens from a frontmatter dict for use as context hints.

    Returns:
        hint_sources: dict[str, list[str]]
            token → list of source strings, e.g. {"田中次郎": ["frontmatter:person"]}

    Splitting:
        Values are split on whitespace and 中黒 (・).
        Hyphens are NOT used as delimiters (safe-side: person names, date ranges).

    Noise exclusions:
        - URLs
        - Pure numeric strings
        - Date-like strings (YYYY, YYYY-MM, YYYY-MM-DD, YYYY/MM/DD)
        - All-ASCII tokens (IDs, slugs, codes)
        - Tokens shorter than 2 chars or longer than 20 chars
    """

    def extract(self, fm: Optional[dict]) -> dict[str, list[str]]:
        if not fm:
            return {}

        hint_sources: dict[str, list[str]] = {}

        for key, val in fm.items():
            if key in _SKIP_KEYS:
                continue
            source_tag = f"frontmatter:{key}"
            for token in self._tokens_from_value(val):
                if not _is_noise(token):
                    if token not in hint_sources:
                        hint_sources[token] = []
                    if source_tag not in hint_sources[token]:
                        hint_sources[token].append(source_tag)

        return hint_sources

    def _tokens_from_value(self, val) -> list[str]:
        if isinstance(val, str):
            return [t.strip() for t in _SPLIT_RE.split(self._strip_wikilinks(val)) if t.strip()]
        if isinstance(val, list):
            tokens: list[str] = []
            for v in val:
                if isinstance(v, str):
                    tokens.extend(t.strip() for t in _SPLIT_RE.split(self._strip_wikilinks(v)) if t.strip())
                elif isinstance(v, (int, float)):
                    tokens.append(str(v))
            return tokens
        if isinstance(val, (int, float)):
            return [str(val)]
        return []

    @staticmethod
    def _strip_wikilinks(text: str) -> str:
        """[[path/to/👤名前]] → 名前, [[path|display]] → display, [[page#anchor]] → page"""
        def _repl(m: re.Match) -> str:
            display = m.group(2)
            if display:
                return display.strip()
            stem = m.group(1).split('/')[-1]
            # Strip heading anchor: [[近世法制史#検地]] → 近世法制史
            if '#' in stem:
                stem = stem.split('#')[0]
            if '.' in stem:
                stem = stem.rsplit('.', 1)[0]
            # Strip leading non-CJK non-ASCII characters (emoji like 👤🏛️)
            stem = stem.lstrip(''.join(
                c for c in stem
                if ord(c) >= 0x2000
                and not (0x4E00 <= ord(c) <= 0x9FFF)   # CJK unified
                and not (0x3000 <= ord(c) <= 0x30FF)   # CJK symbols, kana
            ))
            return stem.strip()
        return _WIKILINK_RE.sub(_repl, text)
