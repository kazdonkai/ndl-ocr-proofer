"""
body_extractor.py — Body text token extractor for file context hints (Phase 2).

Extracts meaningful tokens from the non-OCR body of a Markdown document.
- Excludes [!ocr]/[!OCR]/[!Ocr] callout blocks ONLY (case-insensitive: ocr variant only)
- Non-OCR callouts ([!NOTE], [!TIP], [!WARNING], etc.) are kept as body text
- Skips lines starting with backtick inline code (`INPUT[...] etc.)
- Handles WikiLinks: [[link]] → "link", [[path/link|display]] → "display"
- Strips emoji (Unicode code-point ranges)
- Splits on fullwidth brackets ［ ］ to separate role labels from names
  (e.g. ［被控訴人］糠田村 → 被控訴人 / 糠田村)
- Applies same noise filters as FrontmatterExtractor
- Detects list-item label patterns; skips _SKIP_LABELS tokens

Source prefixes in returned hint_sources:
  "body:wikilink"    — token extracted from [[WikiLink]]
  "body:list_value"  — token extracted from a list-item value (non-label part)
  "body:text"        — token from regular paragraph / non-OCR callout content
"""

import re

# --- OCR callout detection (ocr only, case-insensitive) ---
_OCR_CALLOUT_RE = re.compile(r'>\s*\[!ocr\]', re.IGNORECASE)
_ANY_CALLOUT_RE = re.compile(r'>\s*\[!')

# --- Inline code line detection: `INPUT[...]` 等のデータビュー行を除外する ---
_INLINE_CODE_LINE_RE = re.compile(r'^\s*`[^`]')

# --- Frontmatter fence ---
_FM_FENCE_RE = re.compile(r'^---\s*$')

# --- WikiLink: [[link]] or [[link|display]] ---
_WIKILINK_RE = re.compile(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]')

# --- Splitting: whitespace + Japanese punctuation + fullwidth brackets (aligned with FrontmatterExtractor) ---
# U+FF3B/FF3D（［ ］）を追加: ［被控訴人］糠田村 → 糠田村 のように役割ラベルを分離する
_SPLIT_RE = re.compile(r'[\s　・、,，。！？「」『』【】〔〕…［］]+')

# --- Noise filters (same thresholds as FrontmatterExtractor) ---
_URL_RE = re.compile(r'https?://')
_PURE_NUM_RE = re.compile(r'^\d+$')
_DATE_RE = re.compile(r'^\d{4}([-/]\d{1,2}){0,2}$')
_ASCII_ONLY_RE = re.compile(r'^[A-Za-z0-9_\-]+$')
_TOKEN_MIN_LEN = 2
_TOKEN_MAX_LEN = 20

# --- List item detection ---
_LIST_ITEM_RE = re.compile(r'^[-*]\s+')
# Matches "**label**: value" or "label: value" (with optional ** around label)
_LABEL_COLON_RE = re.compile(r'^(?:\*\*)?(.+?)(?:\*\*)?\s*[:：]\s*(.*)')

# --- Skip labels: high-frequency structural labels in list items ---
_SKIP_LABELS: frozenset[str] = frozenset({
    '事件名', '原告', '被告', '裁判官', '裁判所', '年月日', '出典', '備考', '典拠',
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


def _strip_emoji(text: str) -> str:
    result = []
    for ch in text:
        cp = ord(ch)
        if (
            0x1F300 <= cp <= 0x1FAFF   # Misc Symbols, Emoticons, Supplemental Symbols and Pictographs
            or 0x2600 <= cp <= 0x27BF  # Misc Symbols, Dingbats
            or 0xFE00 <= cp <= 0xFE0F  # Variation Selectors (emoji presentation)
            or 0x1F004 <= cp <= 0x1F0CF  # Mahjong/playing cards
            or cp == 0x200D             # Zero Width Joiner (emoji sequences)
        ):
            continue
        result.append(ch)
    return ''.join(result)


def _extract_wikilink_text(m: re.Match) -> str:
    """[[link|display]] → display; [[path/file]] → file; [[page#anchor]] → page."""
    display = m.group(2)
    if display:
        return display.strip()
    link = m.group(1)
    stem = link.split('/')[-1]
    if '#' in stem:
        stem = stem.split('#')[0]
    if '.' in stem:
        stem = stem.rsplit('.', 1)[0]
    return stem.strip()


class BodyExtractor:
    """
    Extract tokens from the non-OCR body of a Markdown document.

    Returns:
        dict[str, list[str]] — token → list of source strings
        e.g. {"田中次郎": ["body:wikilink"], "入会慣行": ["body:text"]}
    """

    def extract(self, markdown: str) -> dict[str, list[str]]:
        if not markdown:
            return {}

        result: dict[str, list[str]] = {}
        lines = markdown.splitlines()

        # Skip frontmatter block (--- ... ---)
        start_idx = 0
        if lines and _FM_FENCE_RE.match(lines[0]):
            for j in range(1, len(lines)):
                if _FM_FENCE_RE.match(lines[j]):
                    start_idx = j + 1
                    break

        in_ocr = False  # currently inside [!ocr] callout content

        for i in range(start_idx, len(lines)):
            line = lines[i]
            stripped = line.strip()

            # Empty line exits any callout state
            if not stripped:
                in_ocr = False
                continue

            # Any callout header resets state
            if _ANY_CALLOUT_RE.search(line):
                if _OCR_CALLOUT_RE.search(line):
                    in_ocr = True
                else:
                    in_ocr = False
                    # Non-OCR callout header — skip the header line itself
                continue

            # Skip content lines inside OCR callout
            if in_ocr:
                continue

            # Skip inline code lines (e.g. `INPUT[...]` dataview fields)
            if _INLINE_CODE_LINE_RE.match(line):
                continue

            # Strip leading > for non-OCR callout content lines
            if stripped.startswith('>'):
                process_line = stripped[1:].strip()
            else:
                process_line = stripped

            if not process_line:
                continue

            # List item
            list_m = _LIST_ITEM_RE.match(process_line)
            if list_m:
                self._process_list_item(process_line[list_m.end():], result)
            else:
                self._process_text(process_line, 'body:text', result)

        return result

    def _process_list_item(self, content: str, result: dict) -> None:
        """Process list item content; handle label:value and WikiLinks."""
        wikilink_texts: list[str] = []

        def _wl_repl(m: re.Match) -> str:
            wikilink_texts.append(_extract_wikilink_text(m))
            return ' '

        remaining = _WIKILINK_RE.sub(_wl_repl, content)

        # WikiLink tokens are always added
        for wl_text in wikilink_texts:
            for tok in self._split_filter(wl_text):
                self._add(tok, 'body:wikilink', result)

        # Label detection
        lm = _LABEL_COLON_RE.match(remaining.strip())
        if lm:
            label = lm.group(1).strip()
            value_part = lm.group(2).strip()
            if label in _SKIP_LABELS:
                text_to_process = value_part
            else:
                # Reconstruct without colon so both parts tokenize cleanly
                text_to_process = label + ' ' + value_part
        else:
            text_to_process = remaining

        text_to_process = _strip_emoji(text_to_process)
        for tok in self._split_filter(text_to_process):
            self._add(tok, 'body:list_value', result)

    def _process_text(self, text: str, source: str, result: dict) -> None:
        """Process regular paragraph or non-OCR callout content line."""
        wikilink_texts: list[str] = []

        def _wl_repl(m: re.Match) -> str:
            wikilink_texts.append(_extract_wikilink_text(m))
            return ' '

        remaining = _WIKILINK_RE.sub(_wl_repl, text)
        remaining = _strip_emoji(remaining)

        for wl_text in wikilink_texts:
            for tok in self._split_filter(wl_text):
                self._add(tok, 'body:wikilink', result)

        for tok in self._split_filter(remaining):
            self._add(tok, source, result)

    def _split_filter(self, text: str) -> list[str]:
        return [t for t in _SPLIT_RE.split(text) if t and not _is_noise(t)]

    def _add(self, token: str, source: str, result: dict) -> None:
        if token not in result:
            result[token] = []
        if source not in result[token]:
            result[token].append(source)
