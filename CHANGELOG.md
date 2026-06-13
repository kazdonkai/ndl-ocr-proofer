# Changelog

All notable changes to this project will be documented in this file.  
このプロジェクトの変更履歴を記録します。

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.2] — 2026-06-13

### Fixed / 修正

- **修正③ FM WikiLink heading anchor stripping** (`frontmatter_extractor.py`): `[[近世法制史#検地]]` のように Frontmatter 値に `#見出し` 形式の anchor を含む WikiLink が、`近世法制史#検地` のままトークン化されていた問題を修正。`_strip_wikilinks` で `#` 以降を除去し、`近世法制史` のみを返すようにした。`[[page#anchor|display]]` は既存の display text 優先ロジックで正しく処理される。

---

## [1.1.0] — 2026-06-09

### Summary / 概要

辞書管理をGUIから行えるようにした主要機能追加リリースです。  
temporary辞書・approval辞書のエントリをブラウザ上で直接編集・追加・削除でき、  
昇格フロー（temporary → approval）も手動でGUIから実行できます。  
また、app.tomlベースの設定管理とdangerous候補の再定義も含みます。

This release adds full GUI-based dictionary management.  
Users can now edit, add, and delete entries in both temporary and approval dictionaries  
directly in the browser, and manually promote entries from temporary to approval.  
Also includes app.toml-based configuration management and a refined dangerous candidate definition.

### Added / 追加

- **辞書管理GUI** (`DictionaryManager.jsx`): ヘッダーバーの「辞書管理」ボタンから開けるモーダル。temporary辞書・approval辞書の両方を一画面で管理できる。
- **approval辞書の直接作成・追加**: 昇格フローを経由せず、GUIから approval 辞書にエントリを直接追加できる。
- **temporary → approval 手動昇格フロー**: 辞書管理GUI上で昇格操作ができる。競合チェック（同一 term が approval に存在する場合）・上書き・スキップの3モードを選択可能。
- **昇格候補の表示** (`approval_count` / `is_promotion_candidate`): 同一エントリへの再登録回数を `approval_count` としてカウント。3回以上で辞書管理GUI上で昇格候補として強調表示される。昇格候補は approval ではなく temporary 上の注目表示であり、自動昇格は行われない。
- **辞書ファイルの新規作成・削除** (`POST /api/dictionary/files`, `DELETE /api/dictionary/files/{type}/{filename}`): GUIから temporary・approval 辞書ファイルを新規作成・削除できる。
- **protect フラグによるファイル削除保護**: `protect=true` エントリを含むファイルはファイルごとの削除から保護される（409 Conflict を返す）。
- **temporary辞書の編集・物理削除API** (`PUT /api/dictionary/temporary/{filename}/{term}`, `DELETE /api/dictionary/temporary/{filename}/{term}`): エントリのフィールド部分更新と物理削除に対応。
- **approval辞書 CRUD API** (`GET/POST/PUT/DELETE /api/dictionary/entries`): approval辞書のエントリを一覧・追加・更新・削除するAPI。辞書の即時リロードに対応。
- **手動バックアップAPI** (`POST /api/dictionary/backup`): GUIから approval辞書の全ファイルを手動バックアップできる。
- **`app.toml` 設定ファイル** / **`app.toml.example`**: 環境固有パスを含まない動作設定ファイル。OCR・辞書・ステータス設定をまとめて管理でき、リポジトリにコミット可能。
- **`PATCH /api/config`**: app.toml の設定を部分更新するAPI。型バリデーション・値制約チェック・原子的書き込みに対応。
- **`GET /api/config`, `GET /api/config/status`**: 現在の設定値と実行環境情報を返すAPI。
- **`approved_dict_manager.py`**: approval辞書CSV の CRUD モジュール。書き込み前自動バックアップ・原子的書き込みに対応。
- **`config_loader.py`**: app.toml ベースの設定管理モジュール。

### Changed / 変更

- **temporary辞書マネージャーをディレクトリ管理に変更** (`temporary_dict_manager.py`): 単一ファイル管理から `temporary/` ディレクトリ内の複数CSVファイル管理に変更。`approved_dict_manager.py` と同じパターンで統一。
- **dangerous candidate の再定義** (`DANGEROUS_CANDIDATE_VIS_MODE`): `is_dangerous` フラグを「rank1 が固有名詞（`rank1_is_proper_noun=true`）かつ字形ペア由来でない（`rank1_from_shape=false`）」という条件に変更。過修正リスクをより正確に表す定義に改善。
- **`approval_count` フィールドを temporary CSV に追加**: 再登録のたびにカウントアップされる。旧形式の CSV（`approval_count` 列なし）は後方互換として `0` として扱われる（`extrasaction="ignore"` で追加カラムも許容）。
- **temporary辞書の `read_all()` が複数ファイルを結合して返すように変更**: 全ファイルのエントリに `source_file` フィールドを付与して結合する。
- わり→ヨリ soft hint の追加: `detect_hira_bigram_suspects` による soft hint 候補に `わり→ヨリ` を追加。`hintSource` フィールドをログに記録するよう変更。

### Fixed / 修正

- **辞書管理モーダルのヘッダー z-index 問題**: `.dict-manager-overlay` の z-index がアプリヘッダーより低く、モーダルのヘッダー部分がアプリヘッダーに隠れていた問題を修正（z-index: 400 に引き上げ）。

### Notes / 注意事項

- **自動昇格は未実装**: `approval_count` が閾値（3回）を超えても自動的に approval へ昇格されません。昇格操作は辞書管理GUIから手動で行ってください。
- **既存の temporary CSV との互換性**: 旧形式（`approval_count` 列なし）の CSV は後方互換として読み込まれます。次回書き込み時に `approval_count` 列が自動的に追加されます。
- **approval辞書の変更は即時リロード**: GUI から approval辞書を変更した場合、バックエンドの `ai_analyzer` が即時リロードされます。変更が候補提示に反映されない場合は、バックエンドを再起動してください。

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

