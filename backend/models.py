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
    tier: str = "stable"   # "stable" (approved/) | "experimental" (staging/)
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
    frontmatter: dict | None = None


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
    # "accept" | "skip" | "reject" — user decision type
    action_type: str = "accept"


class RunOcrRequest(BaseModel):
    status_property_name: str = "analyzed_status"


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


class UpdateStatusRequest(BaseModel):
    property_name: str
    value: int | str


class LearningFlushRequest(BaseModel):
    events: list[dict]


class DocumentStyleHints(BaseModel):
    particle_script: str        # 'katakana_dominant' | 'mixed' | 'hiragana_dominant' | 'insufficient'
    kata_particle_count: int = 0
    hira_particle_count: int = 0
    kata_ratio: float = 0.0
    total_particles: int = 0


class AnalyzeRequest(BaseModel):
    markdown_content: str
    ocr_json: dict | None = None
    frontmatter: dict | None = None
    filename: str = ""           # Phase 1-c: file context for domain hint
    document_text: str | None = None  # 全ページ結合テキスト（助詞スタイル判定をページ横断で行うために使用）


class OcrNormalizationSuggestion(BaseModel):
    suggested_candidate: str
    suggestion_reason: str
    suggestion_confidence: float
    suggestion_type: str = "ocr_normalization"


class ValidationResult(BaseModel):
    verdict: str            # "accept" | "review" | "reject"
    score: float
    reason: str
    image_audit_required: bool = False
    suggestion: Optional[OcrNormalizationSuggestion] = None


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
    validation: Optional[ValidationResult] = None
    # True when this span was detected by detect_hira_bigram_suspects (e.g. より→ヨリ).
    # Used by span_accepted logging to collect evidence for future rule-promotion decisions.
    is_bigram_suspect: bool = False
    # candidate → hintSource mapping for soft-hint candidates (e.g. {"ヨリ": "manual_override_seed"}).
    # Empty for spans with no soft hints.  Frontend logs hintSource when user selects one of these.
    soft_hint_candidates: dict[str, str] = {}
    # True when the rank-1 candidate is a proper noun (file_context_hint 由来の固有名詞).
    # Used by is_dangerous to flag spans where over-correction risk is high.
    rank1_is_proper_noun: bool = False
    # True when the rank-1 candidate originates from shape_pairs lookup.
    # Shape-pairs corrections are considered safe and excluded from the danger flag.
    rank1_from_shape: bool = False
    # True when the rank-1 candidate originates from the experimental (staging/) dictionary tier.
    # Observation-only field — not used in is_dangerous calculation.
    rank1_from_experimental_dict: bool = False

    @computed_field
    @property
    def suggestions(self) -> list[str]:
        return self.candidates

    @computed_field
    @property
    def is_dangerous(self) -> bool:
        return self.rank1_is_proper_noun and not self.rank1_from_shape

    @computed_field
    @property
    def recommended_verdict(self) -> str:
        if self.validation:
            return self.validation.verdict
        if self.confidence >= 0.75:
            return "accept"
        if self.confidence >= 0.45:
            return "review"
        return "reject"


class AnalyzeResponse(BaseModel):
    results: list[AnalyzedSpan]
    normalized_content: str | None = None
    doc_type: str = "unknown"                  # "classical" | "modern" | "unknown"
    doc_type_confidence: float = 0.0
    doc_type_source: str = "heuristic"         # "frontmatter" | "heuristic" | "insufficient_text"
    particle_normalization_count: int = 0       # に/を/は → ニ/ヲ/ハ 候補件数（current page）
    document_style_hints: DocumentStyleHints | None = None  # Phase 1-b


# ── temporary辞書 API モデル（Phase M-1） ─────────────────────────────────────

class TemporaryDictEntry(BaseModel):
    """GET /api/dictionary/temporary のレスポンス要素。CSV 1行に対応。"""
    term: str
    normalized: str
    variants: str = ""
    reading: str = ""
    category: str = ""
    domain: str = ""
    priority: float = 0.6
    protect: bool = False
    source: str = "user-manual"   # "user-manual" | "seed"
    approved: bool = False
    enabled: bool = True
    registered_at: str = ""
    last_seen_at: str = ""
    note: str = ""
    is_stale: bool = False        # last_seen_at が 180 日以上前かどうか（参照用）
    source_file: str = ""         # 所属 CSV ファイル名
    approval_count: int = 0       # 同一エントリへの再登録（承認）回数
    is_promotion_candidate: bool = False  # approval_count が閾値以上（temporary上の注目表示専用）


class RegisterTemporaryTermRequest(BaseModel):
    """POST /api/dictionary/temporary のリクエスト。"""
    term: str
    normalized: str
    variants: str = ""
    reading: str = ""
    category: str = ""
    domain: str = ""
    priority: float = 0.6
    note: str = ""
    # source は API 経由登録では常に "user-manual"（seed は直接 CSV 編集）


class ToggleTemporaryTermRequest(BaseModel):
    """PATCH /api/dictionary/temporary/{term} のリクエスト。"""
    enabled: bool


class TemporaryDictListResponse(BaseModel):
    """GET /api/dictionary/temporary のレスポンス。"""
    terms: list[TemporaryDictEntry]
    total: int
    enabled_count: int
    files: list[str] = []  # 全 temporary ファイル名（空ファイル含む）


# ── approved辞書 GUI 用モデル (Phase 5: 辞書GUI) ─────────────────────────────

class ApprovedDictEntry(BaseModel):
    """approved/ CSV の 1 エントリ（GUI 表示・編集用）。"""
    term: str
    normalized: str = ""
    variants: str = ""
    reading: str = ""
    category: str = ""
    domain: str = ""
    priority: float = 0.8
    protect: bool = False
    source: str = "manual"
    approved: bool = True
    source_file: str = ""


class AddApprovedEntryRequest(BaseModel):
    filename: str
    term: str
    normalized: str = ""
    variants: str = ""
    reading: str = ""
    category: str = ""
    domain: str = ""
    priority: float = 0.8
    protect: bool = False
    source: str = "manual"
    approved: bool = True


class UpdateApprovedEntryRequest(BaseModel):
    """部分更新用。None フィールドは変更しない。"""
    normalized: Optional[str] = None
    variants: Optional[str] = None
    reading: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    priority: Optional[float] = None
    protect: Optional[bool] = None
    source: Optional[str] = None
    approved: Optional[bool] = None


class ApprovedDictListResponse(BaseModel):
    entries: list[ApprovedDictEntry]
    total: int
    files: list[str]


# ── 辞書運用フロー用モデル（temporary GUI / 昇格 / ファイル管理） ──────────────

class UpdateTemporaryEntryRequest(BaseModel):
    """PUT /api/dictionary/temporary/{filename}/{term} のリクエスト。None フィールドは変更しない。"""
    normalized: Optional[str] = None
    variants: Optional[str] = None
    reading: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    priority: Optional[float] = None
    protect: Optional[bool] = None
    note: Optional[str] = None
    enabled: Optional[bool] = None


class PromoteEntryRequest(BaseModel):
    """POST /api/dictionary/promote のリクエスト。"""
    source_file: str           # temporary ファイル名（例: user_manual_temporary.csv）
    term: str
    target_file: str           # 昇格先 approval ファイル名
    on_conflict: str = "check" # "check" | "overwrite" | "skip"


class PromoteEntryResponse(BaseModel):
    """POST /api/dictionary/promote のレスポンス。"""
    status: str                            # "promoted" | "overwritten" | "skipped" | "conflict"
    entry: Optional[ApprovedDictEntry] = None
    conflict: Optional[dict] = None        # 競合時: {"existing": ApprovedDictEntry dict}


class CreateDictFileRequest(BaseModel):
    """POST /api/dictionary/files のリクエスト。"""
    dict_type: str   # "approval" | "temporary"
    filename: str    # .csv 拡張子を含む
