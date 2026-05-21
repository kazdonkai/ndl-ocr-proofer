import json
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from urllib.parse import unquote
import uvicorn

from vault_reader import VaultReader
from ai_analyzer import AIAnalyzer
from models import (
    DocumentResponse, SaveDocumentRequest,
    AnalyzeRequest, AnalyzedSpan, AnalyzeResponse,
    RunOcrPageRequest, UpdateStatusRequest,
    LearningFlushRequest, DocumentStyleHints,
)

load_dotenv(Path(__file__).parent / ".env")

VAULT_ROOT = os.environ["VAULT_ROOT"]
_default_dict_dir = str(Path(VAULT_ROOT) / "proofreading-app/data/dictionaries")
DICT_DIR = os.getenv("DICT_DIR", _default_dict_dir)

app = FastAPI(title="NDL Proofreading App API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

reader = VaultReader(VAULT_ROOT)
_default_eval_dir = str(Path(VAULT_ROOT) / "proofreading-app/evaluation/logs")
EVAL_DIR = os.getenv("EVALUATION_DIR", _default_eval_dir)
ai_analyzer = AIAnalyzer(dict_dir=DICT_DIR, eval_dir=EVAL_DIR)

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
async def run_ocr(doc_id: str):
    """画像のリネームとOCR実行を行うエンドポイント"""
    try:
        from ocr_runner import process_and_run_ocr
        decoded_id = unquote(doc_id)
        doc_data = reader.get_document_data(decoded_id)
        md_path = doc_data["markdown_path"]
        
        success = process_and_run_ocr(md_path)
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

    general_events = [e for e in request.events if e.get("event") != "span_accepted"]
    span_accepted_events = [e for e in request.events if e.get("event") == "span_accepted"]

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

    return {"flushed": len(request.events)}


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
