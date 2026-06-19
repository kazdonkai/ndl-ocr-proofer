# Changelog

All notable changes to this project will be documented in this file.  
このプロジェクトの変更履歴を記録します。

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.1.4] — 2026-06-19

### Added / 追加

- **`vault_relative_path` フィールドを `DocumentResponse` に追加** (`backend/models.py`, `backend/vault_reader.py`): Vault ルートを基準にした相対パス（例: `subdir/note.md`）を API レスポンスに含める。同名ノートが複数ディレクトリに存在する Vault でも、obsidian:// URI が常に意図したノートを開くことを保証する。既存フィールドとの後方互換を保ち、フィールド未定義の旧クライアントは影響を受けない。

- **`obsidian://` URI 生成で `vault_relative_path` を優先使用** (`frontend/src/utils/obsidianUri.js`, `frontend/src/App.jsx`): 「Obsidianで開く」ボタン押下時、`DocumentResponse.vault_relative_path` が取得できた場合はそれを `file=` パラメータに使用する。取得できない場合は従来通りユーザー入力 `docId` にフォールバックする（後方互換）。

- **辞書エントリの term リネーム対応** (`backend/approved_dict_manager.py`, `backend/temporary_dict_manager.py`): `PATCH /api/dictionary/entries/{type}/{filename}/{term}` で `new_term` フィールドを渡すと term をリネームできるように変更。重複チェック付き。

- **obsidian-plugin/README.md トラブルシューティングセクション追加**: 「Obsidianで開く」ボタンを押しても何も起きない場合の症状・原因候補（起動未確認 / Vault 名ミス）・確認手順・修正手順を追記。

### Changed / 変更

- **縦書きモードの疑義スパンマーカーを傍線に変更** (`frontend/src/components/Proofreader.css`): 縦書き表示時に疑義スパンのハイライトを従来の背景色＋下線から、文字右側の傍線（`border-right: 2px solid`）に切り替える。横書きモードの表示は変更なし。Vertical writing: suspect span marker changed to sidelining.

- **`start.sh` バックエンド起動待機ロジックを改善** (`start.sh`): production・dev 両モードのバックエンド起動待機ループに、プロセス生存チェック（`kill -0`）を追加。大規模 Vault では起動時の初回インデックス（VaultReader）に最大 30 秒以上かかるため、待機上限を 10 秒から 60 秒に延長した。ポート未検知でもプロセスが生存している限り待機を継続し、プロセスが死亡した場合のみ即座にエラーを報告する。Improved backend startup wait in `start.sh`: added process liveness check and extended timeout to 60 s to prevent false timeout errors during large-Vault initial indexing.

- **辞書管理画面を常時インライン編集モードに変更** (`frontend/src/components/DictionaryManager.jsx`): 従来の「編集ボタンで1行ずつ展開」方式を廃止し、全エントリを最初からインライン編集可能な状態で表示する。変更は「一括保存」ボタンで確定。`editingEntry` state を `editRows`（全行管理）に置き換え。

---

## [1.1.3] — 2026-06-18

### Summary / 概要

production 起動整備・Obsidian Bridge Plugin 正式同梱・UI 整理を含む機能追加リリース。  
`./start.sh --prod` で FastAPI が単一プロセスでフロントエンドを配信する本番起動モードを実装した。  
Obsidian Bridge Plugin を `v1.1.3` として正式同梱し、SSE bridge 経由でノート切替を実現。  
辞書管理 UI・Settings パネルを整理し、アプリ名を「影印校エディタ」に統一した。

This release adds production startup mode (`./start.sh --prod`), formally ships the Obsidian Bridge Plugin  
at v1.1.3 with SSE bridge note-switching, reorganizes the dictionary management and settings UI,  
and renames the app to "影印校エディタ" for public release.

### Added / 追加

- **Obsidian Bridge Plugin 正式リリース** (`obsidian-plugin/`): Obsidian のファイルメニュー・エディタメニュー・コマンドパレットから「Open in OCR Proofer」を実行し、起動中の影印校エディタに SSE bridge 経由でノートを切り替える機能。`reuse-existing`（SSE bridge 再利用、推奨）/ `always-new`（常に新しいタブ）の 2 モード対応。plugin バージョンを本体に合わせ `1.1.3` とし、`main.js` を配付成果物として追跡する構成に変更。

- **SSE bridge API** (`backend/main.py`): plugin からノート切替を受け取り、接続中ブラウザタブへ配信する SSE bridge を実装。エンドポイント 3 本: `GET /api/bridge/events`（ブラウザタブ SSE 接続）・`POST /api/bridge/open`（plugin からの切替命令）・`POST /api/bridge/current-note`（タブが表示中ノートを報告）。インメモリ管理・ローカル専用。

- **SSE bridge フロントエンドクライアント** (`frontend/src/App.jsx`): `EventSource` を起動時に接続し、`open-note` イベントでドキュメントを自動切替。`bridgeClientId` と `currentNote` を backend に報告し、`reuse-same-note`（always-new モード）の重複防止に使用。

- **production 起動モード** (`start.sh`): `./start.sh --prod` でフロントエンドを `npm run build` によりビルドし、FastAPI（port 8000）が静的ファイルをまとめて配信する 1 プロセス構成で起動するモードを追加。`--reload` なし・Vite dev server 不要。

- **`logs/app.mode` によるモード記録**: `--prod` / `dev` の起動モードをファイルに記録し、`./start.sh --status` が prod/dev を区別して表示するように変更。

- **フロントエンド静的配信ゲート** (`backend/main.py`): `SERVE_FRONTEND=true` 環境変数が渡された場合のみ `/assets` mount と SPA catch-all ルートを有効化。`/api/*` / `/docs` / `/openapi.json` は SPA に飲み込まれない設計。

- **Settings オーバーレイモーダル** (`SettingsSidebar.jsx`, `App.css`): Settings パネルをサイドバーからオーバーレイモーダルに変換（DictionaryManager と同パターン、z-index 400）。ESC キーで閉じる対応。

- **辞書ファイルリネーム** (`PATCH /api/dictionary/files/{type}/{filename}`, `DictionaryManager.jsx`): temporary・approval 両辞書のファイルをバックアップ付きでリネームする API と RenameFileDialog UI を追加。`user_manual_temporary.csv` のリネームはデフォルトファイル保護により拒否。

- **「Obsidianで開く」ボタン** (`frontend/src/utils/obsidianUri.js`): ヘッダーに追加したボタンから現在表示中のノートを `obsidian://open?vault=…&file=…` URI でワンクリック起動。Vault 名は設定またはパスの末尾から自動導出。日本語・スペース含みパスは `encodeURIComponent` でエンコード。

### Changed / 変更

- **temporary dict UI を DictionaryManager に移動**: temporary 辞書の登録フォームと一覧を SettingsSidebar から DictionaryManager モーダルに移動。Settings パネルの肥大化を解消。

- **辞書エクスポート・インポートコントロールを Settings に移動**: 以前ヘッダー付近にあったエクスポート・インポートボタンを Settings オーバーレイ内に統合。

- **アプリ名を「影印校エディタ」に変更**: `App.jsx` h1・`index.html` title・`README.md`・`README.en.md` の表記を "Classical OCR Proofer" / "NDL OCR Proofer" から「影印校エディタ」に統一（パブリックリポジトリ公開準備）。

- **`base.csv` をコア承認辞書として採用**: `test.csv` を `base.csv` に改名し、研究プロジェクト非依存の基盤辞書として 8 件のエントリを追加。`docs/user_guide.md` / `docs/acceptance_scenarios.md` の例示を `base.csv` に合わせて更新。

### Fixed / 修正

- **`start.sh --stop` の複数 PID kill バグ**: `uvicorn --reload` が master + reloader の 2 プロセスを起動するため、同一ポートに複数 PID が存在する場合に `kill` が失敗していた問題を修正。`while read` ループで各 PID を個別に kill するよう変更。

### Documentation / ドキュメント

- **`docs/RELEASE.md` 追加**: リリース手順書（唯一の参照先）。Step 1〜6 のチェックリスト、よくある失敗パターンと対処、release:check 期待出力を網羅。

- **`docs/plugin-bridge-guide.md` 追加**: bridge plugin 変更時の最短手順書。変更カテゴリ別の発動条件・CI failure 対応表・Vault への反映手順を記載。

- **`.github/workflows/plugin-check.yml` 追加**: push / PR で自動実行される plugin 整合・成果物チェック CI。バージョン整合（`check:version`）と配付成果物の存在・非空確認（`check:dist`）を実行。

- **`CLAUDE.md` 追加**: Claude Code 作業ルール。bridge plugin 変更時の完了条件（3点セット: README更新・バージョン更新・配付4ファイル更新）と release:check 発動条件を定義。

- **README.md / README.en.md 更新**: macOS 専用動作注記、bridge plugin セクション追加、obsidian-plugin/ ディレクトリの説明更新。サンプル画像・引用追加。

- **`docs/acceptance_scenarios.md` 更新**: production モード受け入れ確認（9 項目）・シナリオ 9（temp 登録なし基本校正）・シナリオ 10（ファイルリネーム）・bridge plugin B シナリオ（B1〜B7）を追加。

- **`docs/user_guide.md` 更新**: URL 誤り修正（5173 → 5176）、起動セクションを dev / prod / 停止の 3 段構成に整理。リネームボタン可視条件・`user_manual_temporary.csv` リネーム制限・stale エントリ挙動・`base.csv` 利用パターンを追記。

---

## [1.1.2] — 2026-06-14

### Summary / 概要

候補エンジンの文脈認識を大幅に強化したリリースです。  
Frontmatter（ノートの書誌メタデータ）と本文（非OCR部分）の両方からコンテキストを抽出し、  
それを候補スコアリングに反映する Phase 2 パイプラインを実装しました。  
候補のカテゴリ（辞書由来 / 字形由来 / ファイル文脈由来）がUI上で色分け表示され、  
どのヒントが候補を引き上げたかを確認できるようになりました。

This release significantly strengthens the context-awareness of the candidate engine.  
It implements the Phase 2 pipeline that extracts context from both Frontmatter (bibliographic metadata)  
and document body (non-OCR Markdown content), feeding them into candidate scoring.  
Candidate categories (dict / shape / file-context) are now color-coded in the UI,  
making it visible which hint boosted a given candidate.

### Added / 追加

- **Phase 2 BodyExtractor** (`body_extractor.py`): Markdown 本文（非 OCR callout 部分）からトークンを抽出する新モジュール。`[!ocr]` callout を除外し、WikiLink・絵文字・ノイズを処理し、Frontmatter と同じフィルタリングを適用する。54 テスト追加。
- **FM context detection** (`ai_analyzer.py`): Frontmatter の当事者・裁判官などのトークンに一致するスパンを confirmation span として検出し、bonus 付与するロジックを追加。`detect_fm_context_terms()` メソッドとして実装。
- **FM/body hint 統合** (`file_context_hint.py`): FrontmatterExtractor（+26pt bonus）と BodyExtractor（+15pt bonus）の出力を候補スコアリングに統合。`BuildResult` dataclass により hint_sources（`rank1_from_frontmatter` / `rank1_from_body`）の追跡が可能になった。
- **span_category フィールド** (`models.py`, `ai_analyzer.py`): AnalyzedSpan に `span_category`（`"dict"` / `"noise"` / `"file"`）を追加。候補がどのソースに由来するかをフロントエンドに伝播。
- **span_category カラーコーディング** (`Proofreader.css`, `Proofreader.jsx`): `highlight-noise`（スレート系）/ `highlight-file`（ライム系）クラスによる色分け表示。
- **FM / body タグ表示** (`Proofreader.jsx`): `rank1_from_frontmatter` / `rank1_from_body` が true の場合、popover に「FM」「本文」バッジを表示。
- **ProposalsPanel 候補色分け** (`ProposalsPanel.jsx`): 候補リストパネルでも `span_category` に応じた色を適用。
- **`rank1_from_frontmatter` ログ** (`learningEventLogger.js`): スキップ・却下・採用ログに `rank1FromFrontmatter` フィールドを追加。

### Changed / 変更

- **bonus-only 候補を proper_noun_terms に限定** (`candidate_engine.py`): FM / body トークンは加算 bonus のみとし、bonus ≥ 20.0 のみで候補を生成する "bonus-only" パスを `proper_noun_terms` 由来の語に限定。FM / body トークンが無関係なスパンへ候補を滑り込ませる問題を抑制。
- **`raw_markdown` の通し配線** (`models.py`, `main.py`, `ai_analyzer.py`, `Proofreader.jsx`): AnalyzeRequest に `raw_markdown` フィールドを追加し、バックエンド解析で Frontmatter / body 抽出の入力として使用。フロントエンドから API への受け渡しも整備。

### Fixed / 修正

- **修正③ FM WikiLink heading anchor stripping** (`frontmatter_extractor.py`, `body_extractor.py`): `[[近世法制史#検地]]` のように `#見出し` 形式の anchor を含む WikiLink が `近世法制史#検地` のままトークン化されていた問題を修正。`_strip_wikilinks` で `#` 以降を除去し、`近世法制史` のみを返すようにした。`[[page#anchor|display]]` は既存の display text 優先ロジックで正しく処理される。

### Notes / 注意事項

- **FM/body bonus は additive のみ**: FM / body 由来の bonus は既存候補のスコアを加算するだけで、それ単独では bonus-only 候補を生成しません（proper_noun_terms に一致する場合を除く）。これは意図的な設計です。
- **span_category は rank1 のカテゴリ**: `span_category` は提示される候補リストの rank1（先頭候補）がどのソース由来かを示します。複数のソースが関与する場合でも単一カテゴリが設定されます。

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

