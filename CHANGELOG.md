# Changelog

All notable changes to this project will be documented in this file.  
このプロジェクトの変更履歴を記録します。

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-05-17

### Summary / 概要
stable-v6 相当の機能に Phase 7 全機能・OI シリーズ対応を追加した最初の安定リリースです。  
First stable release combining stable-v6 functionality, all Phase 7 features, and OI series improvements.

### Added / 追加
- **OI-01** 設定外部化: `backend/.env` / `.env.example` による `VAULT_ROOT`・`OCR_ENGINE_PATH`・`OCR_TEMP_ROOT`・`BACKEND_HOST`・`BACKEND_PORT` の環境変数化 / Externalized all hardcoded paths and server settings to `.env`
- **OI-03** `ocr_json` フィールド互換性確認・ドキュメント化 / Verified and documented `ocr_json` field compatibility
- プロジェクトルート `README.md`（日英バイリンガル）/ Bilingual project `README.md`
- `SETUP_MANUAL.md` 日英バイリンガル改訂 / Bilingual revision of `SETUP_MANUAL.md`
- `frontend/README.md` 全面改訂（Vite ボイラープレートから実コンテンツへ）/ Rewrote `frontend/README.md` with actual content
- `obsidian-plugin/README.md` に日本語セクション追加 / Added Japanese sections to `obsidian-plugin/README.md`
- `MIT LICENSE` 追加 / Added MIT `LICENSE`
- プロジェクトルート `.gitignore` 追加 / Added project-root `.gitignore`
- `backend/.env.example` 追加 / Added `backend/.env.example`
- `_collect_ocr_blocks()` 静的メソッドによる OCR block 収集ロジック共通化 / Refactored OCR block collection into shared `_collect_ocr_blocks()` static method

### Fixed / 修正
- **EC-04-C** OCR callout 境界バグ: `[!ocr]` callout の直後に別 callout (`[!memo]` 等) が空行なしで続く場合、その内容が OCR テキストに混入していた問題を修正 / Fixed callout boundary bug where content from adjacent non-OCR callouts leaked into OCR text when no blank line separated them
  - 修正箇所: `text_processor.py` (`extract_ocr_text`, `extract_ocr_pages`), `vault_reader.py` (`_collect_ocr_blocks`, `upsert_ocr_callout_for_page`) / Fixed in: `text_processor.py`, `vault_reader.py`

### Changed / 変更
- `SETUP_MANUAL.md` の hardcoded パス例を汎用パスに置換 / Replaced hardcoded example paths with generic placeholders in `SETUP_MANUAL.md`
- `obsidian-plugin` を v1.5+ deferred として明示 / Explicitly marked `obsidian-plugin` as deferred to v1.5+

---

## [0.x] — 2025 (stable-v6 / Phase 1–7)

Phase 1–7 の開発履歴は git log を参照してください。  
For Phase 1–7 development history, see `git log`.

