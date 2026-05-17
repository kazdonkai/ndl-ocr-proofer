from pydantic import BaseModel, computed_field
from typing import List, Optional, Any, Set


class DictionaryTerm(BaseModel):
    term: str
    normalized: str
    variants: List[str] = []
    reading: Optional[str] = ""
    category: Optional[str] = ""
    domain: Optional[str] = ""
    priority: float = 0.0
    protect: bool = False
    source: Optional[str] = ""
    approved: bool = False
    all_forms: Set[str] = set()

    def model_post_init(self, __context: Any) -> None:
        self.all_forms = {self.term, self.normalized} | set(self.variants)


class OcrPage(BaseModel):
    page: int
    image_name: str = ""
    image_path: str = ""
    ocr_text: str = ""


class DocumentResponse(BaseModel):
    doc_id: str
    resolved_name: str
    markdown_path: str
    markdown_content: str
    image_path: str | None = None
    image_paths: list[str] = []
    ocr_pages: list[OcrPage] = []
    ocr_json: dict | None = None
    logs: list[str] = []


class CorrectionEntry(BaseModel):
    suspect_span: str
    original_text: str
    selected_candidate: str
    candidate_rank: int
    is_manual_input: bool
    time_per_correction: float
    # stable ID assigned at analysis time (Part 3 frontend convention: p{page}_o{occ}_s{start})
    span_id: str = ""
    occurrence_index: int = 0


class RunOcrPageRequest(BaseModel):
    page: int  # 1-based page number


class SaveDocumentRequest(BaseModel):
    corrected_markdown: str
    corrected_ocr: str | None = None
    save_page: int | None = None  # ページ別保存（1-indexed, Noneなら全体）
    time_per_page: float = 0
    total_clicks: int = 0
    corrections: list[CorrectionEntry] = []
    operator_id: str = "user"
    model_name: str = "manual"


class AnalyzeRequest(BaseModel):
    markdown_content: str
    ocr_json: dict | None = None


class AnalyzedSpan(BaseModel):
    suspect_span: str
    # char offsets in the normalized OCR text returned as normalized_content.
    # start and end follow Python slice semantics: text[start:end] == suspect_span.
    # occurrence_index is 0-indexed among all occurrences of the same suspect_span.
    start: int = 0
    end: int = 0
    occurrence_index: int = 0
    reason: str = ""
    confidence: float = 1.0
    is_protected: bool = False
    candidates: list[str] = []

    @computed_field
    @property
    def suggestions(self) -> list[str]:
        return self.candidates


class AnalyzeResponse(BaseModel):
    results: list[AnalyzedSpan]
    normalized_content: str | None = None
