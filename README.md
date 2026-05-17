# NDL古典籍OCR 校正支援アプリ  
# NDL Koten OCR Proofreading Assistant

古典籍デジタルアーカイブのOCRテキストを効率的に校正するための、研究者向けスタンドアロンWebアプリです。  
A standalone web application for researchers to efficiently proofread OCR text of digitized classical Japanese documents.

---

## 概要 / Overview

**日本語**  
NDL（国立国会図書館）古典籍デジタルコレクションを対象とした OCR テキスト校正支援ツールです。  
Obsidian Vault 内の Markdown ノートを直接読み書きし、研究語彙辞書との照合・疑義箇所の自動抽出・ページ単位 OCR 実行をブラウザ上から行えます。

**English**  
A proofreading assistant targeting OCR output from the National Diet Library (NDL) Digital Collections of classical Japanese documents.  
It reads and writes Markdown notes directly inside an Obsidian Vault, offering automatic detection of suspicious characters, vocabulary-dictionary matching, and per-page OCR execution from the browser.

---

## アーキテクチャ / Architecture

```
proofreading-app/
├── backend/          # FastAPI (Python) — Vault I/O, OCR runner, analysis
├── frontend/         # React + Vite — standalone proofreading UI
├── obsidian-plugin/  # Obsidian plugin (v1.5+ 予定 / planned for v1.5+)
└── data/
    └── dictionaries/ # 研究語彙辞書 CSV / Research vocabulary CSV
```

メインUIは **standalone frontend** です。Obsidian embedded 化は v1.5 以降に予定しています。  
The primary UI is the **standalone frontend**. Obsidian embedded mounting is deferred to v1.5+.

---

## 必要環境 / Requirements

| Component | Version |
|-----------|---------|
| Python | 3.11+ |
| Node.js | 18+ |
| [ndlkotenocr-lite](https://github.com/ndl-lab/ndlkotenocr_cli) | — |
| Obsidian Vault | 任意 / optional |

---

## クイックスタート / Quick Start

詳細は [SETUP_MANUAL.md](SETUP_MANUAL.md) を参照してください。  
See [SETUP_MANUAL.md](SETUP_MANUAL.md) for the full setup guide.

```bash
# 1. 設定ファイルの作成 / Create configuration
cp backend/.env.example backend/.env
# → backend/.env を自環境のパスに編集 / Edit paths for your environment

# 2. バックエンド起動 / Start backend
cd backend
pip install -r requirements.txt
python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

# 3. フロントエンド起動 / Start frontend (separate terminal)
cd frontend
npm install
npm run dev
# → ターミナルに表示される Local: URL をブラウザで開く
# → Open the Local: URL shown in the terminal
```

---

## 主な機能 / Key Features

- ページ単位の OCR 実行・callout 挿入 / Per-page OCR execution with callout insertion
- 研究語彙辞書による疑義箇所ハイライト / Suspicious-character highlighting via vocabulary dictionary
- Obsidian Markdown への差分保存（バックアップ付き）/ Diff-aware save to Obsidian Markdown with automatic backup
- ファイルリスト・再スキャン / File list with live rescan

---

## バージョン / Version

現在の最新: **v1.0** (stable-v6 相当 + Phase 7 全機能)  
Current release: **v1.0** (stable-v6 equivalent + all Phase 7 features)

変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。  
See [CHANGELOG.md](CHANGELOG.md) for the full change history.

---

## ライセンス / License

[MIT License](LICENSE)
