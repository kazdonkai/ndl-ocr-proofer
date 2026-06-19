import asyncio
import json
import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote
import uuid
import uvicorn

logger = logging.getLogger(__name__)
from vault_reader import VaultReader
from ai_analyzer import AIAnalyzer
from models import (
    DocumentResponse, SaveDocumentRequest,
    AnalyzeRequest, AnalyzedSpan, AnalyzeResponse,
    RunOcrRequest, RunOcrPageRequest, UpdateStatusRequest,
    LearningFlushRequest, DocumentStyleHints,
    TemporaryDictEntry, RegisterTemporaryTermRequest,
    ToggleTemporaryTermRequest, TemporaryDictListResponse,
    ApprovedDictEntry, AddApprovedEntryRequest,
    UpdateApprovedEntryRequest, ApprovedDictListResponse,
    UpdateTemporaryEntryRequest, PromoteEntryRequest, PromoteEntryResponse,
    CreateDictFileRequest, RenameDictFileRequest,
)
from temporary_dict_manager import TemporaryDictManager
from approved_dict_manager import ApprovedDictManager

load_dotenv(Path(__file__).parent / ".env")

VAULT_ROOT = os.environ["VAULT_ROOT"]

# config_loader は load_dotenv 後にインポートすること（env var 依存のため）
from config_loader import get_config_loader  # noqa: E402

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

# ── temporary辞書マネージャー ──────────────────────────────────────────────────
_TEMP_DIR = str(Path(DICT_DIR) / "temporary")
_TEMP_ARCHIVE_DIR = str(Path(DICT_DIR) / "archive" / "old_versions")
temporary_dict_manager = TemporaryDictManager(_TEMP_DIR, _TEMP_ARCHIVE_DIR)

# temporary → approval 昇格候補とみなす承認回数の閾値（固定値）
PROMOTION_CANDIDATE_THRESHOLD = 3

# ── approved辞書マネージャー (Phase 5: 辞書GUI) ───────────────────────────────
_APPROVED_DIR = str(Path(DICT_DIR) / "approved")
_ARCHIVE_DIR = str(Path(DICT_DIR) / "archive" / "old_versions")
approved_dict_manager = ApprovedDictManager(_APPROVED_DIR, _ARCHIVE_DIR)

# ── config API TOML 書込ヘルパー (Phase 2B-1) ────────────────────────────────

# PATCH /api/config で書き込みを許可するキー: "section.key" → 期待する Python 型
_CONFIG_ALLOWED_KEYS: dict[str, type] = {
    "ocr.rename_images_before_ocr": bool,
    "ocr.write_status_after_ocr": bool,
    "dictionary.use_experimental": bool,
    "auto_downweight.mode": str,
    # Phase 3B: status セクション（書き込み昇格）
    "status.property_name": str,   # 空文字禁止、trim 後に判定
    "status.ocr_done_value": int,  # 1 以上
}


def _patch_toml_content(content: str, section: str, key: str, value: Any) -> str:
    """
    TOML テキストの指定セクション内の指定キーの値を書き換える。
    インラインコメントは保持する。キーが見つからない場合は ValueError を送出する。

    対応する値型:
      - bool → ``true`` / ``false``（TOML 仕様の小文字）
      - str  → ``"value"``（ダブルクォート）
      - その他 → str() で文字列化
    """
    if type(value) is bool:
        val_str = "true" if value else "false"
    elif isinstance(value, str):
        val_str = f'"{value}"'
    else:
        val_str = str(value)

    lines = content.splitlines(keepends=True)
    in_target = False
    replaced = False
    result: list[str] = []

    for line in lines:
        stripped = line.strip()

        # セクションヘッダー検出（配列テーブル [[...]] は対象外）
        sec_m = re.match(r'^\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$', stripped)
        if sec_m:
            in_target = (sec_m.group(1) == section)
            result.append(line)
            continue

        # 対象セクション内でキーを検索（まだ未置換の場合のみ）
        if in_target and not replaced:
            # key = <value>  # optional inline comment
            # group(1): "  key = ", group(2): 現在の値, group(3): " # ..." or ""
            kv_m = re.match(
                rf'^(\s*{re.escape(key)}\s*=\s*)(.*?)(\s*#.*)?$',
                line.rstrip('\n'),
            )
            if kv_m:
                comment = kv_m.group(3) or ""
                result.append(f"{kv_m.group(1)}{val_str}{comment}\n")
                replaced = True
                continue

        result.append(line)

    if not replaced:
        raise ValueError(
            f"キー '{key}' がセクション '[{section}]' 内に見つかりません"
        )

    return "".join(result)


def _write_toml_atomically(path: Path, content: str) -> None:
    """
    TOML ファイルをテンポラリ経由で原子的に書き込む。
    同一ディレクトリ内でテンポラリファイルを作成し os.replace() で置き換えることで、
    書き込み途中のクラッシュによる破損を防ぐ。
    """
    dir_path = path.parent
    fd, tmp_path = tempfile.mkstemp(dir=str(dir_path), suffix=".toml.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, str(path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

# ── SSE ブリッジ (plugin → browser tab 通知) ──────────────────────────────────
# インメモリ管理。シングルユーザー・ローカル環境専用。永続化なし。
# client_id → {"queue": asyncio.Queue, "note": str (現在表示中のノートパス)}

_bridge_clients: dict[str, dict] = {}


@app.get("/api/bridge/events")
async def bridge_events():
    """ブラウザタブが SSE 接続を維持するエンドポイント。
    接続ごとに UUID を発行し、first event (connected) で clientId を通知する。
    asyncio.wait_for は Python バージョンにより CancelledError を誤処理するため使わない。
    """
    client_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _bridge_clients[client_id] = {"queue": queue, "note": ""}
    logger.info("[bridge] SSE client connected  id=%s total=%d", client_id, len(_bridge_clients))

    async def event_generator():
        try:
            # retry: 300 — browser reconnects within 300 ms after disconnect.
            # This narrows the window where bridge/open sees no clients.
            yield f"retry: 300\n\n"
            yield f"event: connected\ndata: {json.dumps({'clientId': client_id})}\n\n"
            while True:
                msg = await queue.get()
                yield msg
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            _bridge_clients.pop(client_id, None)
            logger.info("[bridge] SSE client disconnected id=%s total=%d", client_id, len(_bridge_clients))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/bridge/open")
async def bridge_open(payload: dict = Body(...)):
    """Plugin から note 切替を受け取り、接続中タブへ SSE で転送する。
    mode:
      reuse-any       – 全接続タブへ配信（reuse-existing モード用）
      reuse-same-note – 同じ note を表示中のタブのみへ配信（always-new モード用）
    """
    vault = payload.get("vault", "")
    note  = payload.get("note", "")
    name  = payload.get("name", "")
    mode  = payload.get("mode", "reuse-any")

    logger.info("[bridge] POST /open note=%s mode=%s clients=%d", note, mode, len(_bridge_clients))

    if not _bridge_clients:
        # SSE may be momentarily reconnecting (e.g. after window.location.href for obsidian://).
        # Wait up to 500 ms for a client to reappear before giving up.
        await asyncio.sleep(0.5)
        if not _bridge_clients:
            return {"delivered": False}

    data    = json.dumps({"vault": vault, "note": note, "name": name}, ensure_ascii=False)
    message = f"event: open-note\ndata: {data}\n\n"

    if mode == "check-any":
        # Check only — do not deliver. Returns true if any tab is connected.
        return {"found": len(_bridge_clients) > 0}

    if mode == "check-same-note":
        # Check only — do not deliver. Plugin uses this to confirm before switching.
        targets = [c for c in _bridge_clients.values() if c["note"] == note]
        return {"found": len(targets) > 0}

    if mode == "reuse-same-note":
        targets = [c for c in _bridge_clients.values() if c["note"] == note]
        if not targets:
            return {"delivered": False}
        for client in targets:
            await client["queue"].put(message)
        return {"delivered": True}

    # reuse-any: 全接続タブへ配信
    for client in _bridge_clients.values():
        await client["queue"].put(message)
    return {"delivered": True}


@app.post("/api/obsidian/open")
async def obsidian_open(payload: dict = Body(...)):
    """obsidian:// URI を macOS の open コマンド経由で起動する。
    ブラウザに window.location.href = 'obsidian://...' を実行させると
    Chrome がページナビゲーションの前処理（EventSource.close()）を行い
    SSE 接続が永久に切れるため、backend 経由で開くことで回避する。
    """
    uri = payload.get("uri", "")
    if not isinstance(uri, str) or not uri.startswith("obsidian://"):
        raise HTTPException(status_code=400, detail="obsidian:// URI のみ受け付けます")
    await asyncio.create_subprocess_exec("open", uri)
    return {"status": "ok"}


@app.post("/api/bridge/current-note")
async def bridge_set_current_note(payload: dict = Body(...)):
    """ブラウザタブが現在表示中の note を backend に通知する。
    always-new モードの same-note 検索（reuse-same-note）に使用。
    """
    client_id = payload.get("clientId", "")
    note      = payload.get("note", "")
    client    = _bridge_clients.get(client_id)
    if client is not None:
        client["note"] = note
        logger.debug("[bridge] current-note updated client=%s note=%s", client_id, note)
    return {"ok": True}


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
                raw_markdown=request.raw_markdown,
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


# ── temporary辞書 API (Phase M-1) ─────────────────────────────────────────────

def _row_to_entry(row: dict, manager: TemporaryDictManager) -> TemporaryDictEntry:
    """CSV 行 dict を TemporaryDictEntry に変換する。"""
    approval_count = int(row.get("approval_count", "0") or "0")
    enabled = row.get("enabled", "false").strip().lower() in {"true", "1", "t", "yes"}
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
        enabled=enabled,
        registered_at=row.get("registered_at", ""),
        last_seen_at=row.get("last_seen_at", ""),
        note=row.get("note", ""),
        is_stale=manager.is_stale(row),
        source_file=row.get("source_file", ""),
        approval_count=approval_count,
        is_promotion_candidate=(enabled and approval_count >= PROMOTION_CANDIDATE_THRESHOLD),
    )


@app.get("/api/dictionary/temporary", response_model=TemporaryDictListResponse)
async def list_temporary_terms():
    """temporary辞書の全エントリを返す（enabled 問わず、全ファイル結合）。"""
    try:
        rows = temporary_dict_manager.read_all()
        entries = [_row_to_entry(r, temporary_dict_manager) for r in rows]
        enabled_count = sum(1 for e in entries if e.enabled)
        return TemporaryDictListResponse(
            terms=entries,
            total=len(entries),
            enabled_count=enabled_count,
            files=temporary_dict_manager.list_files(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dictionary/temporary", response_model=TemporaryDictEntry)
async def register_temporary_term(request: RegisterTemporaryTermRequest):
    """temporary辞書に語を登録する（明示的なユーザー選択がある場合のみ呼ぶこと）。"""
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
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return _row_to_entry(row, temporary_dict_manager)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/dictionary/temporary/{term:path}", response_model=TemporaryDictEntry)
async def toggle_temporary_term(term: str, request: ToggleTemporaryTermRequest):
    """temporary辞書語の enabled フラグを切り替える（論理無効化）。"""
    try:
        row = temporary_dict_manager.toggle_enabled(term, request.enabled)
        if row is None:
            raise HTTPException(status_code=404, detail=f"term not found: {term}")
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return _row_to_entry(row, temporary_dict_manager)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/dictionary/temporary/{filename}/{term:path}", response_model=TemporaryDictEntry)
async def update_temporary_entry(filename: str, term: str, request: UpdateTemporaryEntryRequest):
    """temporary辞書の既存エントリを部分更新する（バックアップ後）。"""
    try:
        updates = {k: v for k, v in request.model_dump().items() if v is not None}
        row = temporary_dict_manager.update_entry(filename, term, updates)
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return _row_to_entry(row, temporary_dict_manager)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/dictionary/temporary/{filename}/{term:path}")
async def delete_temporary_entry(filename: str, term: str):
    """temporary辞書からエントリを物理削除する（バックアップ後）。"""
    try:
        temporary_dict_manager.delete_entry(filename, term)
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return {"deleted": term, "filename": filename}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── approved辞書 CRUD API (Phase 5: 辞書GUI) ─────────────────────────────────

def _row_to_approved_entry(row: dict) -> ApprovedDictEntry:
    """CSV 行 dict を ApprovedDictEntry に変換する。"""
    try:
        priority = float(row.get("priority", "0.8") or "0.8")
    except ValueError:
        priority = 0.8
    _TRUE = {"true", "1", "t", "yes", "y"}
    return ApprovedDictEntry(
        term=row.get("term", ""),
        normalized=row.get("normalized", ""),
        variants=row.get("variants", ""),
        reading=row.get("reading", ""),
        category=row.get("category", ""),
        domain=row.get("domain", ""),
        priority=priority,
        protect=str(row.get("protect", "false")).strip().lower() in _TRUE,
        source=row.get("source", "manual"),
        approved=str(row.get("approved", "true")).strip().lower() in _TRUE,
        source_file=row.get("source_file", ""),
    )


@app.get("/api/dictionary/entries", response_model=ApprovedDictListResponse)
async def list_approved_entries(q: str = ""):
    """approved/ 辞書の全エントリを返す。q を指定すると term/normalized/category で前方一致フィルタ。"""
    try:
        rows = approved_dict_manager.read_all()
        if q:
            q_lower = q.lower()
            rows = [
                r for r in rows
                if q_lower in r.get("term", "").lower()
                or q_lower in r.get("normalized", "").lower()
                or q_lower in r.get("category", "").lower()
                or q_lower in r.get("domain", "").lower()
            ]
        entries = [_row_to_approved_entry(r) for r in rows]
        return ApprovedDictListResponse(
            entries=entries,
            total=len(entries),
            files=approved_dict_manager.list_files(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dictionary/entries", response_model=ApprovedDictEntry)
async def add_approved_entry(request: AddApprovedEntryRequest):
    """approved/ 辞書にエントリを追加し、辞書を即時リロードする。"""
    try:
        row = approved_dict_manager.append_entry(
            request.filename,
            {
                "term": request.term,
                "normalized": request.normalized or request.term,
                "variants": request.variants,
                "reading": request.reading,
                "category": request.category,
                "domain": request.domain,
                "priority": request.priority,
                "protect": request.protect,
                "source": request.source,
                "approved": request.approved,
            },
        )
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return _row_to_approved_entry(row)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/dictionary/entries/{filename}/{term:path}", response_model=ApprovedDictEntry)
async def update_approved_entry(filename: str, term: str, request: UpdateApprovedEntryRequest):
    """approved/ 辞書の既存エントリを部分更新し、辞書を即時リロードする。"""
    try:
        updates = {k: v for k, v in request.model_dump().items() if v is not None}
        row = approved_dict_manager.update_entry(filename, term, updates)
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return _row_to_approved_entry(row)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/dictionary/entries/{filename}/{term:path}")
async def delete_approved_entry(filename: str, term: str):
    """approved/ 辞書からエントリを削除（バックアップ後）し、辞書を即時リロードする。"""
    try:
        approved_dict_manager.delete_entry(filename, term)
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return {"deleted": term, "filename": filename}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dictionary/promote", response_model=PromoteEntryResponse)
async def promote_temporary_entry(request: PromoteEntryRequest):
    """temporary エントリを approval 辞書へ昇格する。

    on_conflict:
      "check"     → 競合チェックのみ。競合あれば status="conflict" を返す（変更なし）
      "overwrite" → 競合時は approval エントリを上書き。temporary から物理削除
      "skip"      → approval はそのまま。temporary から物理削除
    昇格成功・スキップ時は常に temporary から物理削除する。
    """
    try:
        # temporary エントリを取得
        temp_rows = temporary_dict_manager.read_file(request.source_file)
        temp_row = next(
            (r for r in temp_rows if r.get("term", "").strip() == request.term.strip()),
            None,
        )
        if temp_row is None:
            raise HTTPException(status_code=404, detail=f"term '{request.term}' が temporary に見つかりません")

        # approval ファイルで競合チェック
        try:
            approval_rows = approved_dict_manager.read_file(request.target_file)
        except FileNotFoundError:
            approval_rows = []

        existing = next(
            (r for r in approval_rows if r.get("term", "").strip() == request.term.strip()),
            None,
        )

        if existing and request.on_conflict == "check":
            existing["source_file"] = request.target_file
            return PromoteEntryResponse(
                status="conflict",
                conflict={"existing": _row_to_approved_entry(existing).model_dump()},
            )

        if existing and request.on_conflict == "skip":
            # approval はそのまま、temporary から削除
            temporary_dict_manager.delete_entry(request.source_file, request.term)
            _use_exp = get_config_loader().get_dictionary_settings().use_experimental
            ai_analyzer.reload_dictionary(use_experimental=_use_exp)
            return PromoteEntryResponse(status="skipped")

        # approval へ書き込む（上書きまたは新規追加）
        approved_dict_manager.backup(request.target_file) if existing else None

        promote_data = {
            "term": temp_row.get("term", "").strip(),
            "normalized": temp_row.get("normalized", "").strip(),
            "variants": temp_row.get("variants", "").strip(),
            "reading": temp_row.get("reading", "").strip(),
            "category": temp_row.get("category", "").strip(),
            "domain": temp_row.get("domain", "").strip(),
            "priority": temp_row.get("priority", "0.8"),
            "protect": temp_row.get("protect", "false"),
            "source": "promoted",
            "approved": "true",
        }

        if existing:
            row = approved_dict_manager.update_entry(request.target_file, request.term, promote_data)
            status = "overwritten"
        else:
            row = approved_dict_manager.append_entry(request.target_file, promote_data)
            status = "promoted"

        # temporary から物理削除
        temporary_dict_manager.delete_entry(request.source_file, request.term)

        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return PromoteEntryResponse(status=status, entry=_row_to_approved_entry(row))

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_VALID_FILENAME_RE = re.compile(r'^[^/\\\.][^/\\]*\.csv$')


def _validate_dict_filename(filename: str) -> None:
    """ファイル名のバリデーション（パストラバーサル防止）。"""
    if not _VALID_FILENAME_RE.match(filename):
        raise ValueError(f"不正なファイル名です: '{filename}'（英数字・漢字・ハイフン・アンダースコアのみ使用可、.csv 必須）")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise ValueError(f"不正なファイル名です: '{filename}'")


@app.post("/api/dictionary/files")
async def create_dict_file(request: CreateDictFileRequest):
    """新規辞書ファイルを作成する（ヘッダー行のみ）。"""
    try:
        _validate_dict_filename(request.filename)
        if request.dict_type == "approval":
            path = approved_dict_manager._csv_path(request.filename)
            if path.exists():
                raise HTTPException(status_code=409, detail=f"ファイルが既に存在します: {request.filename}")
            approved_dict_manager.ensure_file(request.filename)
        elif request.dict_type == "temporary":
            path = temporary_dict_manager._csv_path(request.filename)
            if path.exists():
                raise HTTPException(status_code=409, detail=f"ファイルが既に存在します: {request.filename}")
            temporary_dict_manager.ensure_file(request.filename)
        else:
            raise HTTPException(status_code=422, detail=f"不正な dict_type: '{request.dict_type}'（approval / temporary）")
        return {
            "created": request.filename,
            "dict_type": request.dict_type,
            "approval_files": approved_dict_manager.list_files(),
            "temporary_files": temporary_dict_manager.list_files(),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/dictionary/files/{dict_type}/{filename}")
async def rename_dict_file(dict_type: str, filename: str, request: RenameDictFileRequest):
    """辞書ファイルをリネームする（バックアップ後）。

    拒否条件:
      - old/new いずれかのファイル名が不正（パストラバーサル・拡張子違反）
      - old == new（同名リネーム） → 422
      - new が既に存在する → 409
      - user_manual_temporary.csv の rename（temporary のみ） → 422
    """
    try:
        _validate_dict_filename(filename)
        _validate_dict_filename(request.new_filename)
        if dict_type == "approval":
            approved_dict_manager.rename_file(filename, request.new_filename)
        elif dict_type == "temporary":
            temporary_dict_manager.rename_file(filename, request.new_filename)
        else:
            raise HTTPException(status_code=422, detail=f"不正な dict_type: '{dict_type}'")
        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return {
            "renamed_from": filename,
            "renamed_to": request.new_filename,
            "dict_type": dict_type,
            "approval_files": approved_dict_manager.list_files(),
            "temporary_files": temporary_dict_manager.list_files(),
        }
    except HTTPException:
        raise
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/dictionary/files/{dict_type}/{filename}")
async def delete_dict_file(dict_type: str, filename: str):
    """辞書ファイルを削除する（バックアップ後）。

    削除禁止:
      - user_manual_temporary.csv（基幹 temporary ファイル）
      - protect=true エントリを含むファイル
    """
    try:
        _validate_dict_filename(filename)
        if dict_type == "approval":
            if approved_dict_manager.has_protected_entries(filename):
                raise HTTPException(
                    status_code=409,
                    detail=f"protect=true のエントリが含まれるため削除できません: {filename}",
                )
            backup_path = approved_dict_manager.delete_file(filename)
        elif dict_type == "temporary":
            if temporary_dict_manager.has_protected_entries(filename):
                raise HTTPException(
                    status_code=409,
                    detail=f"protect=true のエントリが含まれるため削除できません: {filename}",
                )
            backup_path = temporary_dict_manager.delete_file(filename)
        else:
            raise HTTPException(status_code=422, detail=f"不正な dict_type: '{dict_type}'")

        _use_exp = get_config_loader().get_dictionary_settings().use_experimental
        ai_analyzer.reload_dictionary(use_experimental=_use_exp)
        return {
            "deleted": filename,
            "dict_type": dict_type,
            "backup_path": backup_path,
            "approval_files": approved_dict_manager.list_files(),
            "temporary_files": temporary_dict_manager.list_files(),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dictionary/backup")
async def backup_dictionary():
    """approved/ 辞書全ファイルを手動バックアップする。"""
    try:
        paths = approved_dict_manager.backup_all()
        return {"backed_up": len(paths), "paths": paths}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── config API (Phase 2A — read-only / Phase 2B-1 — write) ──────────────────

@app.get("/api/config")
async def get_app_config():
    """
    app.toml の全設定を返す（read-only）。
    app.toml 不在時は .agent/settings.yaml の値を返す（後方互換フォールバック）。
    パス情報（VAULT_ROOT 等）は含まない。
    """
    return get_config_loader().as_config_dict()


@app.get("/api/config/status")
async def get_config_status():
    """
    実行環境情報を返す（診断・表示用途）。
    config_file_path / vault_root 等のパス情報を含む。変更不可（read-only）。
    """
    info = get_config_loader().get_env_info()
    return {
        "config_file_path": info.config_file_path,
        "config_file_exists": info.config_file_exists,
        "vault_root": info.vault_root,
        "app_data_dir": info.app_data_dir,
        "dict_dir": info.dict_dir,
        "eval_dir": info.eval_dir,
        "ocr_temp_root": info.ocr_temp_root,
        "backend_version": info.backend_version,
    }


@app.patch("/api/config")
async def patch_app_config(updates: dict[str, Any] = Body(...)):
    """
    app.toml の設定を部分更新する（Phase 2B-1）。

    書き込み許可キー（ALLOWED_KEYS）:
      - ``ocr.rename_images_before_ocr``   (bool)
      - ``ocr.write_status_after_ocr``     (bool)
      - ``dictionary.use_experimental``    (bool)
      - ``auto_downweight.mode``           (str)
      - ``status.property_name``           (str, 空文字禁止、trim 後に判定)   [Phase 3B]
      - ``status.ocr_done_value``          (int, 1 以上)                       [Phase 3B]

    仕様:
      - ALLOWED_KEYS 以外のキーは 400 で拒否する（黙って無視しない）
      - 型不一致（例: bool キーに str 値）は 422 で拒否する
      - 値制約違反（空文字・1未満）は 422 で拒否する
      - 書き込みは原子的（同一ディレクトリのテンポラリ + os.replace()）
      - ``dictionary.use_experimental`` 更新時のみ AIAnalyzer 辞書を即時リロードする
      - それ以外のキー変更では不要な副作用を起こさない
      - 値が変わらない no-op 更新も成功として返す（副作用なし）

    旧エンドポイント (PATCH /api/settings/ocr / PATCH /api/settings/dictionary) は
    deprecated として残存（Phase 3D 時点で GET 旧 API は削除済み）。

    レスポンス:
      ``{"updated": [...keys], "config": {...全設定}}``

    エラーレスポンス:
      - 400: ``{"error": "...", "rejected_keys": [...]}``  ← 不正キー
      - 422: ``{"error": "...", "type_errors": [...]}``    ← 型不一致
      - 503: ``{"error": "...", "config_file_path": "..."}`` ← app.toml 不在
      - 500: ``{"error": "..."}``                          ← 書き込みエラー
    """
    if not updates:
        return {"updated": [], "config": get_config_loader().as_config_dict()}

    # ── 1. 不正キーの拒否（ALLOWED_KEYS 以外は明示的に拒否）────────────────
    rejected_keys = [k for k in updates if k not in _CONFIG_ALLOWED_KEYS]
    if rejected_keys:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "許可されていないキーが含まれています",
                "rejected_keys": rejected_keys,
                "allowed_keys": list(_CONFIG_ALLOWED_KEYS.keys()),
            },
        )

    # ── 2. 型バリデーション ─────────────────────────────────────────────────
    type_errors = []
    for k, v in updates.items():
        expected = _CONFIG_ALLOWED_KEYS[k]
        if expected is bool:
            # JSON の true/false は Python bool に正確に対応する。
            # int (0/1) は isinstance(True, int) が True になるため type() で厳密に判定する。
            if type(v) is not bool:
                type_errors.append(
                    {"key": k, "expected": "bool", "got": type(v).__name__}
                )
        elif expected is str:
            if not isinstance(v, str):
                type_errors.append(
                    {"key": k, "expected": "str", "got": type(v).__name__}
                )
        elif expected is int:
            # bool は int のサブクラスだが type() では区別できる。
            # JSON 数値 (e.g. 2) は Python int として受け取る。float / bool は拒否。
            if type(v) is not int:
                type_errors.append(
                    {"key": k, "expected": "int", "got": type(v).__name__}
                )
    if type_errors:
        raise HTTPException(
            status_code=422,
            detail={"error": "型不一致", "type_errors": type_errors},
        )

    # ── 2b. 値制約チェック（Phase 3B: status.* キーの追加制約）─────────────
    value_errors = []
    if "status.property_name" in updates:
        trimmed = updates["status.property_name"].strip()
        if not trimmed:
            value_errors.append({
                "key": "status.property_name",
                "error": "空文字は許可されていません（trim 後も空）",
            })
        else:
            # 前後空白を除去した値で上書き（TOML に余計な空白を書き込まない）
            updates["status.property_name"] = trimmed
    if "status.ocr_done_value" in updates:
        if updates["status.ocr_done_value"] < 1:
            value_errors.append({
                "key": "status.ocr_done_value",
                "error": "1 以上の整数を指定してください",
                "got": updates["status.ocr_done_value"],
            })
    if value_errors:
        raise HTTPException(
            status_code=422,
            detail={"error": "値の制約違反", "value_errors": value_errors},
        )

    # ── 3. app.toml の存在確認 ──────────────────────────────────────────────
    cfg = get_config_loader()
    toml_path = Path(cfg.get_env_info().config_file_path)
    if not toml_path.exists():
        raise HTTPException(
            status_code=503,
            detail={
                "error": (
                    "app.toml が存在しません。"
                    "設定ファイルを手動で作成後に再試行してください。"
                ),
                "config_file_path": str(toml_path),
            },
        )

    # ── 4. 原子的 TOML 書き込み ─────────────────────────────────────────────
    # 書き込み前に現在の内容を読み込み、全更新をメモリ上でパッチしてから一度だけ書く。
    # これにより、複数キーを更新する場合でも書き込みは 1 回（原子性を最大化）。
    try:
        content = toml_path.read_text(encoding="utf-8")
        for dotted_key, value in updates.items():
            section, key = dotted_key.split(".", 1)
            content = _patch_toml_content(content, section, key, value)
        _write_toml_atomically(toml_path, content)
    except ValueError as e:
        # キー未検出など、バリデーション後段で検出される論理エラー
        raise HTTPException(status_code=400, detail={"error": str(e)})
    except Exception as e:
        raise HTTPException(
            status_code=500, detail={"error": f"app.toml 書き込みエラー: {e}"}
        )

    # ── 5. config_loader 再読み込み（書き込み後に反映）──────────────────────
    cfg.reload()

    # ── 6. 副作用: dictionary.use_experimental のみ辞書即時リロード ─────────
    # それ以外のキー変更では副作用を起こさない（fidelity principle）。
    if "dictionary.use_experimental" in updates:
        use_exp: bool = bool(updates["dictionary.use_experimental"])
        try:
            ai_analyzer.reload_dictionary(use_experimental=use_exp)
        except Exception as exc:
            # 辞書リロード失敗はログのみ（app.toml 書き込みは成功済み）
            logger.warning("PATCH /api/config: 辞書リロード失敗: %s", exc)

    return {
        "updated": list(updates.keys()),
        "config": cfg.as_config_dict(),
    }


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

# ── production フロントエンド配信 ──────────────────────────────────────────────
# SERVE_FRONTEND=true のときのみ有効（start.sh --prod から渡される）
# 開発時（npm run dev）は Vite の proxy が担うため、この処理は不要
_SERVE_FRONTEND = os.getenv("SERVE_FRONTEND", "false").lower() == "true"

if _SERVE_FRONTEND:
    _dist = Path(__file__).parent.parent / "frontend" / "dist"

    if not (_dist / "index.html").exists():
        raise RuntimeError(
            f"[PROD] frontend ビルドが見つかりません: {_dist / 'index.html'}\n"
            "先に frontend/ で npm run build を実行してください。"
        )

    # /assets/ ディレクトリを静的配信
    if (_dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(_dist / "assets")), name="fe_assets")

    # dist ルート直下の静的ファイル（index.html 除く）を列挙
    _dist_root_files = {
        f for f in os.listdir(str(_dist))
        if (_dist / f).is_file() and f != "index.html"
    }

    # /api/*, /docs, /openapi.json, /redoc は上流ルートで処理されるが、
    # 万一ここに到達した場合も SPA に飲み込ませず 404 を返す
    _API_PREFIXES = ("api/", "docs", "openapi.json", "redoc")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str = ""):
        if any(full_path.startswith(p) for p in _API_PREFIXES):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path in _dist_root_files:
            return FileResponse(str(_dist / full_path))
        return FileResponse(str(_dist / "index.html"))

if __name__ == "__main__":
    _host = os.getenv("BACKEND_HOST", "127.0.0.1")
    _port = int(os.getenv("BACKEND_PORT", "8000"))
    uvicorn.run(app, host=_host, port=_port)
