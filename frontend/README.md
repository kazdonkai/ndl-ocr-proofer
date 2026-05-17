# Frontend — NDL古典籍OCR 校正支援アプリ
# Frontend — NDL Koten OCR Proofreading Assistant

React + Vite によるスタンドアロン校正 UI です。  
Standalone proofreading UI built with React + Vite.

---

## 概要 / Overview

バックエンド（`backend/`）が提供する REST API を通じて、Obsidian Vault 内の Markdown ノートを取得・校正・保存します。  
Reads, proofreads, and saves Markdown notes inside an Obsidian Vault via the REST API provided by `backend/`.

---

## 起動 / Development

バックエンドを先に起動してから以下を実行してください。  
Start the backend first, then run the following.

```bash
npm install
npm run dev
```

ターミナルの `Local:` 行に表示された URL をブラウザで開いてください。  
Open the URL shown on the `Local:` line in your terminal.

バックエンドのプロキシ先はデフォルトで `http://127.0.0.1:8000` です（`vite.config.js` 参照）。  
Backend proxy target defaults to `http://127.0.0.1:8000` (see `vite.config.js`).

---

## ビルド / Build

```bash
npm run build
# → dist/ に成果物が出力されます / Output goes to dist/
```

---

## 構成 / Structure

```
src/
├── components/   # UI コンポーネント / UI components
├── services/     # API クライアント / API client
├── state/        # 状態管理 / State management
├── utils/        # ユーティリティ / Utilities
├── settings.js   # ユーザー設定（localStorage） / User settings (localStorage)
└── App.jsx
```
