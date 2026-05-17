"""
Unit tests for OCRTextProcessor.
Run with: pytest backend/test_text_processor.py -v
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import pytest
from text_processor import OCRTextProcessor


# ---------------------------------------------------------------------------
# extract_ocr_pages
# ---------------------------------------------------------------------------

class TestExtractOcrPages:

    def test_empty_returns_empty(self):
        assert OCRTextProcessor.extract_ocr_pages("") == []

    def test_no_image_returns_empty(self):
        md = "> [!ocr]\n> some text\n"
        assert OCRTextProcessor.extract_ocr_pages(md) == []

    def test_single_page_basic(self):
        md = "- [ ] ![[image.jpg]]\n> [!ocr]\n> line 1\n> line 2\n"
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert len(pages) == 1
        assert pages[0]["page"] == 1
        assert pages[0]["image_name"] == "image.jpg"
        assert pages[0]["ocr_text"] == "line 1\nline 2"

    def test_single_page_no_ocr(self):
        md = "- [ ] ![[image.jpg]]\n\nSome other text\n"
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert len(pages) == 1
        assert pages[0]["ocr_text"] == ""

    def test_two_pages_blank_separated(self):
        md = (
            "- [ ] ![[a.jpg]]\n"
            "> [!ocr]\n> text A\n"
            "\n"
            "- [ ] ![[b.jpg]]\n"
            "> [!ocr]\n> text B\n"
        )
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert len(pages) == 2
        assert pages[0]["ocr_text"] == "text A"
        assert pages[1]["ocr_text"] == "text B"

    # --- EC-04-C regression ---

    def test_ec04c_adjacent_callout_does_not_leak(self):
        """Adjacent non-OCR callout must NOT appear in OCR text (EC-04-C)."""
        md = (
            "- [ ] ![[image1.jpg]]\n"
            "> [!ocr]\n"
            "> OCR page 1 line 1\n"
            "> OCR page 1 line 2\n"
            "> [!memo]\n"
            "> This should NOT appear in OCR text\n"
            "- [ ] ![[image2.jpg]]\n"
            "> [!ocr]\n"
            "> OCR page 2 line 1\n"
        )
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert len(pages) == 2
        assert "memo" not in pages[0]["ocr_text"].lower()
        assert "This should NOT appear" not in pages[0]["ocr_text"]
        assert pages[0]["ocr_text"] == "OCR page 1 line 1\nOCR page 1 line 2"
        assert pages[1]["ocr_text"] == "OCR page 2 line 1"

    def test_ec04c_warning_callout_does_not_leak(self):
        md = (
            "- [ ] ![[img.jpg]]\n"
            "> [!ocr]\n"
            "> OCR text\n"
            "> [!warning]\n"
            "> warning content\n"
        )
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert len(pages) == 1
        assert pages[0]["ocr_text"] == "OCR text"

    def test_blank_line_terminates_ocr_block(self):
        md = (
            "- [ ] ![[img.jpg]]\n"
            "> [!ocr]\n"
            "> line 1\n"
            "\n"
            "> this line is outside the callout\n"
        )
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert pages[0]["ocr_text"] == "line 1"

    def test_image_in_wikilink_with_path(self):
        """Image name extraction should strip the path prefix."""
        md = "![[files/some_doc_01.jpg]]\n> [!ocr]\n> 本文\n"
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert pages[0]["image_name"] == "some_doc_01.jpg"

    def test_ocr_header_case_insensitive(self):
        md = "![[img.jpg]]\n> [!OCR]\n> テキスト\n"
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert pages[0]["ocr_text"] == "テキスト"

    def test_multiple_pages_no_ocr_mixed(self):
        md = (
            "![[p1.jpg]]\n"
            "> [!ocr]\n> page 1 text\n"
            "![[p2.jpg]]\n"
            "![[p3.jpg]]\n"
            "> [!ocr]\n> page 3 text\n"
        )
        pages = OCRTextProcessor.extract_ocr_pages(md)
        assert len(pages) == 3
        assert pages[0]["ocr_text"] == "page 1 text"
        assert pages[1]["ocr_text"] == ""
        assert pages[2]["ocr_text"] == "page 3 text"


# ---------------------------------------------------------------------------
# extract_ocr_text
# ---------------------------------------------------------------------------

class TestExtractOcrText:

    def test_empty_returns_empty(self):
        assert OCRTextProcessor.extract_ocr_text("") == ""

    def test_basic_extraction(self):
        md = "> [!ocr]\n> hello\n> world\n"
        assert OCRTextProcessor.extract_ocr_text(md) == "hello\nworld"

    def test_ec04c_adjacent_callout_does_not_leak(self):
        md = "> [!ocr]\n> hello\n> [!warning]\n> should not appear\n"
        assert OCRTextProcessor.extract_ocr_text(md) == "hello"

    def test_multiple_ocr_blocks_concatenated(self):
        md = "> [!ocr]\n> page 1\n\n> [!ocr]\n> page 2\n"
        result = OCRTextProcessor.extract_ocr_text(md)
        assert "page 1" in result
        assert "page 2" in result

    def test_blank_line_terminates_block(self):
        md = "> [!ocr]\n> content\n\n> not ocr\n"
        assert OCRTextProcessor.extract_ocr_text(md) == "content"

    def test_case_insensitive_header(self):
        md = "> [!OCR]\n> OCR content\n"
        assert OCRTextProcessor.extract_ocr_text(md) == "OCR content"


# ---------------------------------------------------------------------------
# normalize_text / get_clean_text
# ---------------------------------------------------------------------------

class TestNormalize:

    def test_normalize_trims_trailing_whitespace(self):
        text = "line 1   \nline 2  "
        result = OCRTextProcessor.normalize_text(text)
        assert result == "line 1\nline 2"

    def test_get_clean_text_extracts_ocr(self):
        md = "# title\n\n![[img.jpg]]\n> [!ocr]\n> 校正テキスト\n"
        result = OCRTextProcessor.get_clean_text(md)
        assert result == "校正テキスト"
