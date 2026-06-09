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

---

## 6. app.toml の配置 / Placing app.toml

### 概要

`app.toml` はアプリのアプリ操作設定を管理するファイルです（環境固有パス・サーバー設定は `.env` で管理）。  
**プロジェクトルート（`proofreading-app/`）に配置してください。**

> `.env` と異なり `app.toml` はリポジトリにコミットしても問題ありません（機密情報なし）。  
> ただし環境ごとに設定値が異なる場合は `.gitignore` に追加することを推奨します。

### 初期セットアップ手順

```bash
# プロジェクトルートで実行
cd proofreading-app

# テンプレートをコピーして app.toml を作成
cp app.toml.example app.toml

# 必要に応じて編集（ほとんどの場合はデフォルト値でOK）
# 編集箇所の目安:
#   status.property_name … Obsidian フロントマターのステータスキー名
#   status.ocr_done_value … OCR完了後に設定するステータス値
#   dictionary.use_experimental … 実験的辞書を使う場合は true
vi app.toml   # または好みのエディタで編集
```

### app.toml が存在しない場合の動作

`app.toml` が存在しない場合、アプリは `.agent/settings.yaml`（Vault 内）に自動フォールバックします。  
フォールバック時は uvicorn ログに以下のメッセージが出力されます（INFO レベル）：

```
INFO:     app.toml 不在: .agent/settings.yaml にフォールバックします
```

この場合でもアプリは動作しますが、**Settings 画面の CONFIG セクションが disabled になります**（書き込み不可）。  
設定の永続保存には `app.toml` の配置が必要です。

### app.toml のキー一覧

| セクション | キー | 型 | 説明 | YAML旧キー |
|---|---|---|---|---|
| `[ocr]` | `rename_images_before_ocr` | bool | OCR前に画像をリネームするか | `ocr.rename_images_before_ocr` |
| `[ocr]` | `write_status_after_ocr` | bool | OCR完了後にステータス書き込みするか | `ocr.write_status_after_ocr` |
| `[dictionary]` | `use_experimental` | bool | 実験的辞書（staging/）を読み込むか | `dictionary.use_experimental` |
| `[status]` | `property_name` | str | フロントマターのステータスプロパティ名 | `status.プロパティ名` |
| `[status]` | `ocr_done_value` | int (≥1) | OCR完了後のステータス値 | `status.OCR完了値` |
| `[auto_downweight]` | `mode` | str | 自動降格モード (`"off"` \| `"semi"`) | `auto_downweight.mode` |

> **注意**: `status.値の定義`（日本語ラベル）は `.agent/settings.yaml` に永続残留します。TOML には移しません。

---

## 7. トラブルシューティングと rollback / Troubleshooting & Rollback

### app.toml が読み込まれない場合

1. ファイルの配置場所を確認してください（`proofreading-app/app.toml`）
2. `GET http://127.0.0.1:8000/api/config/status` でパス・存在確認ができます：
   ```bash
   curl -s http://127.0.0.1:8000/api/config/status | python3 -m json.tool
   # → "config_file_exists": true なら正常読み込み済み
   ```
3. TOML 構文エラーの場合は uvicorn ログに `app.toml 読み込みエラー` が出力されます。

### rollback 手順（Phase 4C 以降の YAML fallback 削除に備えて）

> **現時点（Phase 4A/4B 観測期間中）は YAML fallback は削除されていません。**  
> 以下は Phase 4C 以降を見据えた手順メモです。

**シナリオ: app.toml を誤って削除・破損した場合**

```bash
# 1. app.toml.example から再作成
cp app.toml.example app.toml

# 2. 元の設定値を復元（バックアップがある場合）
#    backups/ ディレクトリにタイムスタンプ付きバックアップがある場合はそこから取得
ls -lrt backups/ | tail -5

# 3. サーバーを再起動して確認
#    GET /api/config/status で config_file_exists: true を確認
curl -s http://127.0.0.1:8000/api/config/status | python3 -m json.tool
```

**シナリオ: 設定変更後に動作がおかしい場合**

```bash
# 1. 現在の設定値を確認
curl -s http://127.0.0.1:8000/api/config | python3 -m json.tool

# 2. app.toml を手動で元の値に戻す（エディタで編集）
vi app.toml

# 3. サーバー側の設定を再読み込み（サーバー再起動不要）
curl -X PATCH http://127.0.0.1:8000/api/config \
  -H "Content-Type: application/json" \
  -d '{"ocr.rename_images_before_ocr": true}'
# → GET /api/config で反映確認
```

**Phase 4C 着手前のチェックリスト**（YAML fallback 削除前に確認すること）

- [ ] `app.toml` が全デプロイ環境に配置済み（`GET /api/config/status` で `config_file_exists: true`）
- [ ] `scripts/migrate_yaml_to_toml.py` で `.agent/settings.yaml` → `app.toml` の値移行確認済み
- [ ] uvicorn ログで `app.toml 不在: .agent/settings.yaml にフォールバック` が **2 週間以上ゼロ**
- [ ] `scripts/check_patch_callers.sh` を実行し、旧 PATCH API 参照ゼロを確認
