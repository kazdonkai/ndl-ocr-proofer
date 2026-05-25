import json
import os
import re
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote
import uvicorn
try:
    import yaml as _yaml
except ImportError:
    _yaml = None

from vault_reader import VaultReader
from ai_analyzer import AIAnalyzer
from models import (
    DocumentResponse, SaveDocumentRequest,
    AnalyzeRequest, AnalyzedSpan, AnalyzeResponse,
    RunOcrRequest, RunOcrPageRequest, UpdateStatusRequest,
    LearningFlushRequest, DocumentStyleHints,
    OcrSettings, UpdateOcrSettingsRequest,
    DictionarySettings, UpdateDictionarySettingsRequest,
    TemporaryDictEntry, RegisterTemporaryTermRequest,
    ToggleTemporaryTermRequest, TemporaryDictListResponse,
)
from temporary_dict_manager import TemporaryDictManager

load_dotenv(Path(__file__).parent / ".env")

VAULT_ROOT = os.environ["VAULT_ROOT"]

# APP_DATA_DIR: アプリ本体のデータディレクトリ（辞書・評価ログのデフォルト解決元）
# 省略時: backend/ の親ディレクトリ（= proofreading-app ルート）を使用
# Vault 外配置時: .env に APP_DATA_DIR=/Users/you/dev/proofreading-app を追加するだけでよい
APP_DATA_DIR = os.getenv("APP_DATA_DIR", str(Path(__file__).parent.parent))

_default_dict_dir = str(Path(APP_DATA_DIR) / "data/dictionaries")
DICT_DIR = os.getenv("DICT_DIR", _default_dict_dir)

app = FastAPI(title="NDL Proofreading App API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

reader = VaultReader(VAULT_ROOT)
_default_eval_dir = str(Path(APP_DATA_DIR) / "evaluation/logs")
EVAL_DIR = os.getenv("EVALUATION_DIR", _default_eval_dir)
ai_analyzer = AIAnalyzer(dict_dir=DICT_DIR, eval_dir=EVAL_DIR)

# ── temporary辞書マネージャー (Phase M-1) ─────────────────────────────────────
_TEMP_CSV_PATH = str(Path(DICT_DIR) / "temporary" / "user_manual_temporary.csv")
temporary_dict_manager = TemporaryDictManager(_TEMP_CSV_PATH)

# ── .agent/settings.yaml helpers ─────────────────────────────────────────────

_SETTINGS_YAML = Path(VAULT_ROOT) / ".agent" / "settings.yaml"


def _read_ocr_settings_yaml() -> dict:
    if _yaml is None or not _SETTINGS_YAML.exists():
        return {}
    try:
        with open(_SETTINGS_YAML, "r", encoding="utf-8") as f:
            return _yaml.safe_load(f) or {}
    except Exception:
        return {}


def _write_ocr_yaml_bool(key: str, value: bool) -> None:
    """settings.yaml の ocr 以下の boolean キーをインラインで書き換える（コメント保持）。"""
    val_str = "true" if value else "false"
    if not _SETTINGS_YAML.exists():
        return
    content = _SETTINGS_YAML.read_text(encoding="utf-8")
    new_content = re.sub(
        rf"^(\s*{re.escape(key)}:\s*)(true|false)(.*)",
        rf"\g<1>{val_str}\3",
        content,
        flags=re.MULTILINE,
    )
    _SETTINGS_YAML.write_text(new_content, encoding="utf-8")

@app.get("/api/document/{doc_id:path}")
async def get_document(doc_id: str):
    """ドキュメント取得。doc_idはパス付き（例: 100/10000001_0016_申渡 減地一件）も可"""
    try:
        decoded_id = unquote(doc_id)
        data = reader.get_document_data(decoded_id)
        return DocumentResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/analyze")
async def analyze_document(request: AnalyzeRequest):
    try:
        raw_results, clean_text, doc_type, doc_type_confidence, doc_type_source, particle_count, raw_style_hints = (
            ai_analyzer.analyze_document(
                text=request.markdown_content,
                ocr_json=request.ocr_json,
                frontmatter=request.frontmatter,
                filename=request.filename,
                document_text=request.document_text,
            )
        )
        style_hints = DocumentStyleHints(**raw_style_hints.to_dict())
        return AnalyzeResponse(
            results=[AnalyzedSpan(**res) for res in raw_results],
            normalized_content=clean_text or request.markdown_content,
            doc_type=doc_type,
            doc_type_confidence=doc_type_confidence,
            doc_type_source=doc_type_source,
            particle_normalization_count=particle_count,
            document_style_hints=style_hints,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/document/{doc_id:path}/save")
async def save_document(doc_id: str, request: SaveDocumentRequest):
    try:
        decoded_id = unquote(doc_id)
        doc_data = reader.get_document_data(decoded_id)
        md_path = doc_data["markdown_path"]
        original_content = doc_data["markdown_content"]

        if request.corrected_ocr is not None:
            if request.save_page is not None:
                # ページ別保存: 特定ページのOCRのみ書き換え
                final_content = reader.embed_corrected_ocr_page(
                    original_content, request.save_page, request.corrected_ocr
                )
            else:
                # 全OCR保存: [!OCR]ブロック全体を書き換え
                final_content = reader.embed_corrected_ocr(original_content, request.corrected_ocr)
        else:
            # フルエディタの編集: body は incoming を使用しつつ、
            # ディスク上の frontmatter（status 等 update_frontmatter_field で更新済みの状態）を保持
            final_content = reader.with_disk_frontmatter(original_content, request.corrected_markdown)

        reader.save_markdown(md_path, final_content)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/document/{doc_id:path}/run_ocr")
async def run_ocr(doc_id: str, request: RunOcrRequest = None):
    """画像のリネームとOCR実行を行うエンドポイント"""
    try:
        from ocr_runner import process_and_run_ocr
        decoded_id = unquote(doc_id)
        doc_data = reader.get_document_data(decoded_id)
        md_path = doc_data["markdown_path"]
        req = request or RunOcrRequest()
        success = process_and_run_ocr(md_path, status_property_name=req.status_property_name)
        if not success:
            raise HTTPException(status_code=400, detail="OCR対象の画像が見つかりませんでした")
            
        # 再インデックス（新しい画像パスなどを反映させるため）
        reader._build_index()
        
        return {"status": "success"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/document/{doc_id:path}/run_ocr_page")
async def run_ocr_page(doc_id: str, request: RunOcrPageRequest):
    """指定ページ（1-based）の画像に対してOCRを実行し、calloutを insert/update する。"""
    try:
        from ocr_runner import ocr_single_page
        decoded_id = unquote(doc_id)
        doc_data = reader.get_document_data(decoded_id)
        md_path = doc_data["markdown_path"]

        # ページ範囲チェック（1-based）
        ocr_pages = doc_data["ocr_pages"]
        if request.page < 1 or request.page > len(ocr_pages):
            raise HTTPException(
                status_code=400,
                detail=f"Page {request.page} is out of range (1-{len(ocr_pages)})"
            )

        # 0-based array access で画像情報を取得
        page_data = ocr_pages[request.page - 1]
        image_name = page_data["image_name"]
        image_link = page_data.get("image_link", "")

        # フルパスで解決（シンボリックリンク対応）、失敗時は image_index にフォールバック
        img_path = None
        if image_link and '/' in image_link:
            import unicodedata
            candidate = Path(VAULT_ROOT) / unicodedata.normalize('NFC', image_link)
            if candidate.exists():
                img_path = candidate
        if img_path is None:
            img_path = reader.image_index.get(image_name)
        if img_path is None:
            raise HTTPException(status_code=404, detail=f"Image not found: {image_name}")

        ocr_text = ocr_single_page(img_path)

        # callout を insert/update してファイル保存（backup 付き）
        updated_content = reader.upsert_ocr_callout_for_page(md_path, request.page, ocr_text)
        reader.save_markdown(md_path, updated_content)

        return {
            "status": "success",
            "page": request.page,
            "image_name": image_name,
            "ocr_text": ocr_text,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/document/{doc_id:path}/status")
async def update_document_status(doc_id: str, request: UpdateStatusRequest):
    """frontmatter の任意フィールドを更新する（status 専用 UI から呼ぶ）"""
    try:
        decoded_id = unquote(doc_id)
        doc_data = reader.get_document_data(decoded_id)
        reader.update_frontmatter_field(
            doc_data["markdown_path"],
            request.property_name,
            request.value,
        )
        return {"status": "success", "property": request.property_name, "value": request.value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/learning/flush")
async def flush_learning_events(request: LearningFlushRequest):
    """
    Phase 0-b: localStorage の学習イベントを JSONL に永続化する。
    フロントエンドは flush 成功後に localStorage を消去する。

    イベントルーティング:
      span_accepted → span_accepted.jsonl  (bigram rule-promotion 判定用)
      その他        → learning_candidates.jsonl
    """
    if not request.events:
        return {"flushed": 0}
    log_dir = Path(EVAL_DIR)
    log_dir.mkdir(parents=True, exist_ok=True)

    # span_accepted            → span_accepted.jsonl  (bigram rule-promotion 判定用)
    # span_rejected/skipped    → user_actions.jsonl   (A〜I 指標集計対象)
    # manual_selection_corrected → user_actions.jsonl (aggregate_experimental の A〜I 指標外)
    # その他                   → learning_candidates.jsonl
    _USER_ACTION_EVENTS = {"span_accepted", "span_rejected", "span_skipped", "manual_selection_corrected"}
    general_events = [e for e in request.events if e.get("event") not in _USER_ACTION_EVENTS]
    span_accepted_events = [e for e in request.events if e.get("event") == "span_accepted"]
    user_action_events = [e for e in request.events if e.get("event") in {"span_rejected", "span_skipped", "manual_selection_corrected"}]

    if general_events:
        log_path = log_dir / "learning_candidates.jsonl"
        with open(log_path, "a", encoding="utf-8") as f:
            for event in general_events:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")

    if span_accepted_events:
        sa_path = log_dir / "span_accepted.jsonl"
        with open(sa_path, "a", encoding="utf-8") as f:
            for event in span_accepted_events:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")

    if user_action_events:
        ua_path = log_dir / "user_actions.jsonl"
        with open(ua_path, "a", encoding="utf-8") as f:
            for event in user_action_events:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")

    return {"flushed": len(request.events)}


@app.get("/api/settings/ocr")
async def get_ocr_settings():
    """.agent/settings.yaml の OCR 設定を返す。"""
    data = _read_ocr_settings_yaml()
    ocr = data.get("ocr", {})
    return OcrSettings(
        rename_images_before_ocr=bool(ocr.get("rename_images_before_ocr", True)),
        write_status_after_ocr=bool(ocr.get("write_status_after_ocr", True)),
    )


@app.patch("/api/settings/ocr")
async def update_ocr_settings(request: UpdateOcrSettingsRequest):
    """.agent/settings.yaml の OCR 設定を更新する。"""
    try:
        _write_ocr_yaml_bool("rename_images_before_ocr", request.rename_images_before_ocr)
        _write_ocr_yaml_bool("write_status_after_ocr", request.write_status_after_ocr)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return OcrSettings(
        rename_images_before_ocr=request.rename_images_before_ocr,
        write_status_after_ocr=request.write_status_after_ocr,
    )


@app.get("/api/settings/dictionary")
async def get_dictionary_settings():
    """.agent/settings.yaml の辞書設定を返す。"""
    data = _read_ocr_settings_yaml()
    d = data.get("dictionary", {})
    return DictionarySettings(
        use_experimental=bool(d.get("use_experimental", False)),
    )


@app.patch("/api/settings/dictionary")
async def update_dictionary_settings(request: UpdateDictionarySettingsRequest):
    """.agent/settings.yaml の辞書設定を更新し、AIAnalyzer の辞書を即時リロードする。"""
    try:
        _write_ocr_yaml_bool("use_experimental", request.use_experimental)
        ai_analyzer.reload_dictionary(use_experimental=request.use_experimental)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return DictionarySettings(use_experimental=request.use_experimental)


# ── temporary辞書 API (Phase M-1) ─────────────────────────────────────────────

def _row_to_entry(row: dict, manager: TemporaryDictManager) -> TemporaryDictEntry:
    """CSV 行 dict を TemporaryDictEntry に変換する。"""
    return TemporaryDictEntry(
        term=row.get("term", ""),
        normalized=row.get("normalized", ""),
        variants=row.get("variants", ""),
        reading=row.get("reading", ""),
        category=row.get("category", ""),
        domain=row.get("domain", ""),
        priority=float(row.get("priority", "0.6") or "0.6"),
        protect=row.get("protect", "false").strip().lower() in {"true", "1", "t", "yes"},
        source=row.get("source", "user-manual"),
        approved=row.get("approved", "false").strip().lower() in {"true", "1", "t", "yes"},
        enabled=row.get("enabled", "false").strip().lower() in {"true", "1", "t", "yes"},
        registered_at=row.get("registered_at", ""),
        last_seen_at=row.get("last_seen_at", ""),
        note=row.get("note", ""),
        is_stale=manager.is_stale(row),
    )


@app.get("/api/dictionary/temporary", response_model=TemporaryDictListResponse)
async def list_temporary_terms():
    """temporary辞書の全エントリを返す（enabled 問わず）。

    - enabled=true / false 両方を返す（cleanup UI 用）
    - is_stale: last_seen_at が 180 日以上前のエントリに True を付与
    - source フィールドで "user-manual" / "seed" を区別可能
    """
    try:
        rows = temporary_dict_manager.read_all()
        entries = [_row_to_entry(r, temporary_dict_manager) for r in rows]
        enabled_count = sum(1 for e in entries if e.enabled)
        return TemporaryDictListResponse(
            terms=entries,
            total=len(entries),
            enabled_count=enabled_count,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dictionary/temporary", response_model=TemporaryDictEntry)
async def register_temporary_term(request: RegisterTemporaryTermRequest):
    """temporary辞書に語を登録する（明示的なユーザー選択がある場合のみ呼ぶこと）。

    - 既存 term が存在する場合: enabled=true に戻して last_seen_at を更新
    - 新規の場合: source="user-manual" で新規エントリを追加
    - 登録後に辞書を即時リロード（analyze に反映させる）
    - fidelity principle: 自動一括投入は禁止（呼び出し元の責任）
    """
    try:
        row = temporary_dict_manager.register(
            term=request.term,
            normalized=request.normalized,
            variants=request.variants,
            reading=request.reading,
            category=request.category,
            domain=request.domain,
            priority=request.priority,
            note=request.note,
            source="user-manual",
        )
        # 辞書を即時リロードして analyze に反映（use_experimental 状態は現状維持）
        _yaml_data = _read_ocr_settings_yaml()
        _use_exp = bool(_yaml_data.get("dictionary", {}).get("use_experimental", False))
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return _row_to_entry(row, temporary_dict_manager)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/dictionary/temporary/{term:path}", response_model=TemporaryDictEntry)
async def toggle_temporary_term(term: str, request: ToggleTemporaryTermRequest):
    """temporary辞書語の enabled フラグを切り替える。

    - enabled=false: 論理無効化（物理削除は行わない）
    - 切替後に辞書を即時リロード
    """
    try:
        row = temporary_dict_manager.toggle_enabled(term, request.enabled)
        if row is None:
            raise HTTPException(status_code=404, detail=f"term not found: {term}")
        # 辞書を即時リロード
        _yaml_data = _read_ocr_settings_yaml()
        _use_exp = bool(_yaml_data.get("dictionary", {}).get("use_experimental", False))
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return _row_to_entry(row, temporary_dict_manager)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files")
async def list_files():
    files = reader.list_files()
    return {"files": files, "total": len(files)}

@app.post("/api/files/rescan")
async def rescan_files():
    try:
        result = reader.rescan()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 画像配信用の静的ファイル設定
app.mount("/images", StaticFiles(directory=VAULT_ROOT, follow_symlink=True), name="images")

if __name__ == "__main__":
    _host = os.getenv("BACKEND_HOST", "127.0.0.1")
    _port = int(os.getenv("BACKEND_PORT", "8000"))
    uvicorn.run(app, host=_host, port=_port)
