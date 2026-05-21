# セットアップマニュアル / Setup Manual

NDL古典籍OCR 校正支援アプリ  
NDL Koten OCR Proofreading Assistant

---

## 1. 設定ファイルの作成 / Create Configuration File

バックエンドディレクトリ（`backend/`）に `.env` ファイルを作成します。  
Create a `.env` file inside the `backend/` directory.

```bash
cd proofreading-app/backend
cp .env.example .env
```

`.env` を各自の環境に合わせて編集してください。  
Edit `.env` to match your environment.

---

## 2. 設定項目の説明 / Configuration Variables

| 変数名 / Variable | 必須 / Required | 説明 / Description |
|---|---|---|
| `VAULT_ROOT` | **必須 / Required** | Obsidian Vault のルートディレクトリ / Obsidian Vault root directory |
| `OCR_ENGINE_PATH` | **必須 / Required** | ndlkotenocr-lite クローン先 / ndlkotenocr-lite clone directory |
| `OCR_TEMP_ROOT` | 任意 / Optional | OCR 一時作業ディレクトリ（省略時: `/tmp/ocr_temp`） / Temp dir for OCR (default: `/tmp/ocr_temp`) |
| `DICT_DIR` | 任意 / Optional | 研究語彙辞書 CSV ディレクトリ（省略時: `{VAULT_ROOT}/proofreading-app/data/dictionaries`） |
| `EVALUATION_DIR` | 任意 / Optional | 評価ログ出力先（省略時: `{VAULT_ROOT}/proofreading-app/evaluation/logs`） |
| `BACKEND_HOST` | 任意 / Optional | バックエンドホスト（省略時: `127.0.0.1`） / Backend host (default: `127.0.0.1`) |
| `BACKEND_PORT` | 任意 / Optional | バックエンドポート（省略時: `8000`） / Backend port (default: `8000`) |

### 最小構成の `.env` 例 / Minimal `.env` example

```env
VAULT_ROOT=/path/to/your/obsidian/vault
OCR_ENGINE_PATH=/path/to/ndlkotenocr-lite
```

---

## 3. VaultReader の動作仕様 / How VaultReader Works

`VAULT_ROOT` を起点として再帰的にファイルを検索します。  
Files are searched recursively under `VAULT_ROOT`.

- **ノート取得**: フロントエンドの検索窓にドキュメントID（例: `10000001_001`）を入力すると、ID・ファイル名・パスでインデックス検索します。  
  **Note retrieval**: Enter a document ID (e.g. `10000001_001`) in the search box; the app searches by ID, filename, and path.

- **保存**: 読み込み時に特定した Markdown ファイルへ直接上書き保存します。保存前にタイムスタンプ付きバックアップを `backup/` ディレクトリに自動作成します。  
  **Save**: Writes directly to the identified Markdown file. A timestamped backup is created automatically under `backup/` before each save.

- **評価ログ**: `correction_events.jsonl` として `EVALUATION_DIR` に追記保存されます。  
  **Evaluation log**: Correction events are appended to `correction_events.jsonl` in `EVALUATION_DIR`.

---

## 4. 起動手順 / Startup

### バックエンド / Backend (FastAPI)

```bash
cd proofreading-app/backend
python3 -m venv .venv                  # 初回のみ / First time only
.venv/bin/pip install -r requirements.txt
.venv/bin/python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

起動後、`http://127.0.0.1:8000/docs` で Swagger UI を確認できます。  
After startup, open `http://127.0.0.1:8000/docs` to view the Swagger UI.

### フロントエンド / Frontend (React + Vite)

```bash
cd proofreading-app/frontend
npm install
npm run dev
```

ターミナルの `Local:` 行に表示された URL をブラウザで開いてください。  
Open the URL shown on the `Local:` line in your terminal.

---

## 5. OCR エンジンのセットアップ / OCR Engine Setup

[ndlkotenocr-lite](https://github.com/ndl-lab/ndlkotenocr_cli) を別途クローン・セットアップし、`OCR_ENGINE_PATH` にそのディレクトリを指定してください。  
Clone and set up [ndlkotenocr-lite](https://github.com/ndl-lab/ndlkotenocr_cli) separately, then set `OCR_ENGINE_PATH` to its directory.

OCR エンジンが不要な場合（テキスト編集のみ）は `OCR_ENGINE_PATH` を設定しなくても起動できます（OCR 実行ボタンのみ無効化されます）。  
If you do not need the OCR engine (text editing only), you can omit `OCR_ENGINE_PATH` — only the OCR execution button will be disabled.
