# Task Tracker — proofreading-app

最終更新: 2026-06-15（v1.1.3 開発開始 — production 起動整備 + 実験観測フェーズ V2 準備）

---

## v1.1.3 — 進行中（テーマ: production 起動整備 + 実運用・観測準備）

**方針**: `./start.sh --prod` 対応を起点に、実運用環境の安定化と実験観測フェーズ V2 実施を進める。  
Phase 4B（旧 PATCH API 削除）は v1.1.2 以前に完了済み。Phase 4C（YAML fallback 終了）はロック中。

| タスク | ステータス | コミット |
|--------|-----------|---------|
| `./start.sh --prod` 実装（frontend build + FastAPI 静的配信） | ✅ 完了 | a4064d3 |
| ドキュメント整備（README / user_guide / acceptance_scenarios） | ✅ 完了 | 51c2214 |
| CHANGELOG [1.1.3] Unreleased 追加 | ✅ 完了 | — |
| **実験観測フェーズ V2（本番史料 20〜30 件操作・集計）** | 🔍 観測待ち | — |
| V2 集計・FALSE_POSITIVE_REVIEW 更新・案A 実装可否判断 | ⏳ V2 完了後 | — |

---

## 完了済み

- [x] **PHASE1_APP_DATA_DIR** ✅ CLOSED 2026-05-25（ユーザー承認）
  - `backend/main.py` — `APP_DATA_DIR` 導入（`DICT_DIR` / `EVAL_DIR` のデフォルト解決元を Vault から分離）
  - `backend/.env` / `.env.example` — `APP_DATA_DIR` オプション追加
  - 後方互換維持（`DICT_DIR` / `EVALUATION_DIR` 直接指定は引き続き有効）
  - approved / staging / temporary 辞書の回帰確認 ✅
  - OCR_TEMP_ROOT は引き続き Vault 外（`.env` 専管）
  - `.agent/settings.yaml` 参照箇所・キー棚卸し完了
  - `app.toml` に移す項目 / 残す項目の一次整理完了
  - **次フェーズ**: Phase 2 app.toml 設計（設計草案 → `scratch/DESIGN_PHASE2_APP_TOML_CONFIG.md`）

- [x] settings.js 導入（localStorage 永続化・deepMerge）
- [x] SettingsSidebar への全設定項目追加
  - display (fontSize / lineHeight / viewMode)
  - vault (showNotificationOnRescan / Rescan ボタン)
  - panel (openOnStartup / autoCloseAfterSelect / initialWidth)
  - import (defaultBehavior: replace / merge)
  - document (statusPropertyName / completionStatusValue)
- [x] SETTINGS_SCHEMA.md 作成（設定一覧・Obsidian plugin 対応メモ）
- [x] 設定系凍結宣言
- [x] DICT_EXPERIMENTAL_UI — 実験的辞書トグル フロントエンド連携（Task 11）✅ CLOSED 2026-05-22
  - `frontend/src/services/documentService.js` — `getDictionarySettings()` / `updateDictionarySettings()` 追加
  - `frontend/src/App.jsx` — `dictionarySettings` state + `handleDictionarySettingChange` + SettingsSidebar へ props 追加
  - `frontend/src/components/SettingsSidebar.jsx` — 「辞書」セクション追加（実験的辞書を使用 チェックボックス）
  - **堅牢化（2026-05-22）**:
    - `App.jsx` — `isSavingDictionary` state 追加、API 失敗時サーバー値再取得で UI 再同期、二重送信ガード
    - `learningEventLogger.js` — `logDictionarySettingChanged({ key, old_value, new_value, reload_result })` 追加（Tier 2）
    - `SettingsSidebar.jsx` — `isSavingDictionary` prop 受け取り、保存中は checkbox disabled + 「保存中…」インジケータ表示
    - `App.css` — `.setting-saving-indicator` スタイル追加
- [x] TEMPORARY_DICT_PHASE_M1 — 一時辞書機能 Phase M-1 ✅ CLOSED 2026-05-24
  - **バックエンド（前セッション完了済み）**:
    - `backend/temporary_dict_manager.py` — TemporaryDictManager（CRUD・enabled フィルタ・stale 判定）
    - `backend/dictionary_loader.py` — `load_temporary_csv()` / `load_temporary_dir()` / `reload()` 統合
    - `backend/models.py` — `TemporaryDictEntry` / `RegisterTemporaryTermRequest` / `ToggleTemporaryTermRequest` / `TemporaryDictListResponse`
    - `backend/main.py` — `GET/POST /api/dictionary/temporary` / `PATCH /api/dictionary/temporary/{term}`
    - `data/dictionaries/temporary/user_manual_temporary.csv` — CSV ファイル（ヘッダーのみ初期化済み）
  - **フロントエンド（2026-05-24 実装）**:
    - `backend/ai_analyzer.py` — `__init__` に `load_temporary_dir()` 追加（起動時 temporary 語を即時ロード）
    - `frontend/src/services/documentService.js` — `getTemporaryTerms()` / `registerTemporaryTerm()` / `toggleTemporaryTerm()` 追加
    - `frontend/src/App.jsx` — `temporaryTerms` state / `handleRegisterTemporaryTerm` / `handleToggleTemporaryTerm` 追加・SettingsSidebar へ props 渡し
    - `frontend/src/components/SettingsSidebar.jsx` — 「一時辞書」セクション追加（＋登録フォーム・一覧・有効/無効トグル・stale タグ）
    - `frontend/src/App.css` — `.temp-dict-*` スタイル群追加
  - **設計方針**: tier="temporary" は stable 同等スコア（penalty なし）、experimental 観測（A〜I）に影響しない
  - **手動訂正後登録プロンプト（2026-05-25）**:
    - `frontend/src/components/Proofreader.jsx` — `onRegisterTemporaryTerm` prop 追加、`manualRegisterPrompt/Form/Status/Error` state 追加
    - `executeManualCorrection()` 改修: 実際に文字が変化した場合のみダイアログを Phase 2 へ切替（変化なし・削除は従来通り即クローズ）
    - `closeManualDialog()` — Phase 1/2 両方の state を一括クローズするヘルパー
    - `handleManualRegisterSubmit()` — `onRegisterTemporaryTerm` を呼び、成功 1.5s 後に自動クローズ
    - ダイアログ JSX Phase 2: 疑義表記→正規化形を pre-fill 済み入力フィールド + カテゴリ + 「登録する」/「スキップ」ボタン
    - `frontend/src/App.jsx` — `<Proofreader>` に `onRegisterTemporaryTerm={handleRegisterTemporaryTerm}` 追加
    - `frontend/src/components/Proofreader.css` — `.manual-register-*` スタイル群追加
- [x] FILE_BULK_KATA — 全ページ一括カタカナ化（Task 10）
  - `settings.js` — `document.bulkKatakanaThreshold: 0.85` 追加
  - `SettingsSidebar.jsx` — 「全ページカタカナ優勢判定閾値」スライダー（min 85%・凍結対象外）
  - `App.jsx` — `bulkKatakanaThreshold` prop を Proofreader に渡す
  - `Proofreader.jsx` — `fileLevelKataRatio` メモ（全ページカナ文字比率）・`handleFileBulkHiraAllPreview` / `executeFileBulkHiraAll` ハンドラー・undo/redo 対応（`isFileBulkHiraAllNorm`）・ツールバー ROW 1「カタカナ優勢 XX%」バッジ右隣ボタン・確認ダイアログ・補正一覧「全カタカナ一括 N文字」表示
  - `Proofreader.css` — `.btn-file-bulk-kata` / `.crp-item.crp-bulk-norm .crp-suspect { max-width: none }`

- [x] **V1.1.2_FM_WIKILINK_ANCHOR_FIX** ✅ CLOSED 2026-06-10（commit c2c6683）
  - **修正③ FM WikiLink heading anchor stripping**
  - `backend/frontmatter_extractor.py` — `_strip_wikilinks()` を修正。`[[page#anchor]]` 形式の anchor 部分（`#` 以降）を除去し `page` のみ返すよう変更。`[[page#anchor|display]]` は既存の display text 優先ロジックで正しく処理。
  - テスト: `backend/test_frontmatter_extractor.py` に heading anchor ケース追加

- [x] **V1.1.2_BODY_EXTRACTOR_PHASE2** ✅ CLOSED 2026-06-10（commit 7aa0e8b）
  - **Phase 2 BodyExtractor 実装**
  - `backend/body_extractor.py` — BodyExtractor Phase 2。Markdown 本文から校正済み語・固有名詞・主要語彙を抽出し、body コンテキストヒントを生成するモジュール新規作成
  - テスト: `backend/test_body_extractor.py` 新規追加

- [x] **V1.1.2_FM_BODY_HINT_INTEGRATION** ✅ CLOSED 2026-06-10（commit 33e91da）
  - **Phase 2 FM/body hint integration + FM context detection**
  - `backend/ai_analyzer.py` / `backend/file_context_hint.py` — FM（Frontmatter）・body（本文）から抽出したコンテキストを候補エンジンに統合
  - FM context detection: Frontmatter 値をヒントとして bonus 付与するロジックを追加
  - body context hint: BodyExtractor Phase 2 の出力を候補スコアリングに反映

- [x] **V1.1.2_BONUS_ONLY_POLICY** ✅ CLOSED 2026-06-11（commit 1451561）
  - **bonus-only candidates を proper_noun_terms に限定**
  - `backend/candidate_engine.py` — bonus-only ループを proper_noun_terms 由来の語のみに制限。region alias noise の過剰適用を抑制。

- [x] **V1.1.2_SPAN_CATEGORY_UI** ✅ CLOSED 2026-06-11（commit 54936ca）
  - **span_category カラーコーディング・FM/body タグ・raw_markdown 配線**
  - `frontend/src/components/Proofreader.jsx` — span_category に応じたカラーコーディング表示（fm / body / shape / hint 等）
  - FM タグ・body タグを popover 内に表示
  - `raw_markdown` フィールドの配線（バックエンド→フロントエンド）

---

## 進行中・次優先

### PHASE2A_CONFIG_LOADER_READONLY_API ✅ CLOSED 2026-05-26（ユーザー承認）

- **設計文書**: `scratch/DESIGN_PHASE2_APP_TOML_CONFIG.md`
- **ステータス**: CLOSED（実装完了・ユーザー承認 2026-05-26）

**完了した実装**:
1. `backend/app.toml` 導入 ✅（`[ocr]` / `[dictionary]` / `[status]` / `[auto_downweight]` セクション）
2. `backend/config_loader.py` 新設 ✅
   - `ConfigLoader` クラス（TOML 読込・YAML フォールバック・シングルトン）
   - `get_ocr_settings()` / `get_dictionary_settings()` / `get_status_settings()` / `get_auto_downweight_settings()` / `get_status_labels()` / `get_env_info()` / `as_config_dict()` / `reload()`
   - `get_config_loader()` — モジュールレベルシングルトン
3. `backend/main.py` 設定読込統合 ✅
   - `GET /api/settings/ocr` / `GET /api/settings/dictionary` → `get_config_loader()` 経由に変更
   - 旧 `_read_ocr_settings_yaml()` はそのまま（PATCH 系は `.agent/settings.yaml` 書き込みのため残留）
   - 旧 `GET /api/settings/ocr` / `GET /api/settings/dictionary` に deprecated コメント付与
4. `backend/ocr_runner.py` 設定読込統合 ✅（`get_config_loader()` 使用済み）
5. `GET /api/config` 実装 ✅（全設定・パス情報なし）
6. `GET /api/config/status` 実装 ✅（環境パス情報・診断用）
7. フロントエンド Settings — read-only CONFIG セクション表示 ✅（2026-05-26）
   - `frontend/src/services/documentService.js` — `getAppConfig()` / `getConfigStatus()` 追加
   - `frontend/src/App.jsx` — `appConfig` / `configStatus` state 追加・SettingsSidebar へ props 渡し
   - `frontend/src/components/SettingsSidebar.jsx` — CONFIG read-only セクション追加（config_file_exists バッジ・KV一覧・パス表示）
   - `frontend/src/App.css` — `.config-status-*` / `.config-kv-*` / `.config-path-*` スタイル追加

---

### PHASE2B1_PATCH_API_CONFIG ✅ CLOSED 2026-05-26（ユーザー承認済み）

- **位置づけ**: Phase 2B を 2B-1 / 2B-2 に分割した最初のステップ
- **スコープ**: バックエンドの書き込み経路のみ（フロントエンド接続は 2B-2 以降）
- **ステータス**: 実装完了・回帰確認済み

**完了した実装**（`backend/main.py`）:
1. `import tempfile` / `from typing import Any` / `from fastapi import Body` 追加 + `logger = logging.getLogger(__name__)` ✅
2. `_CONFIG_ALLOWED_KEYS: dict[str, type]` — 4キーのみの許可リスト ✅
   - `ocr.rename_images_before_ocr` (bool)
   - `ocr.write_status_after_ocr` (bool)
   - `dictionary.use_experimental` (bool)
   - `auto_downweight.mode` (str)
3. `_patch_toml_content(content, section, key, value)` — セクション認識型の行内置換（インラインコメント保持）✅
4. `_write_toml_atomically(path, content)` — 同一ディレクトリのテンポラリ + `os.replace()`（原子性）✅
5. `PATCH /api/config` エンドポイント追加 ✅
   - ステップ 1: 不正キー → 400 `{ "error": "...", "rejected_keys": [...], "allowed_keys": [...] }`
   - ステップ 2: 型不一致 → 422 `{ "error": "...", "type_errors": [{key, expected, got}, ...] }`（`type()` で厳密判定、int 0/1 を bool と混同しない）
   - ステップ 3: `app.toml` 不在 → 503
   - ステップ 4: 全更新をメモリ上でパッチ後、`_write_toml_atomically()` で 1 回書き込み
   - ステップ 5: `config_loader.reload()`
   - ステップ 6: `dictionary.use_experimental` 変更時のみ `ai_analyzer.reload_dictionary()` 実行（他キーは副作用なし）
   - レスポンス: `{ "updated": [...], "config": {...全設定} }`
6. `PATCH /api/settings/dictionary` に deprecated コメント付与（削除なし）✅

**回帰確認結果**（実サーバー + 実 app.toml で確認済み）:
- [x] `app.toml` 書込後に再読込して値が保持されること（ラウンドトリップ確認）
- [x] 不正キー（ALLOWED_KEYS 外）が 400 で拒否されること（`status.property_name` 等）
- [x] 不正型（`"true"` → bool / `1` → bool）が 422 で拒否されること
- [x] `dictionary.use_experimental` 切替で辞書リロードが呼ばれること（副作用接続確認）
- [x] OCR エンドポイント・temporary辞書 API に副作用がないこと
- [x] 旧 `PATCH /api/settings/dictionary` が 200 で引き続き動作すること（後方互換）
- [x] `GET /api/config` / `GET /api/config/status` に変更なし

**今回実装しなかったもの（意図的除外）**:
- フロントエンド Settings からの書き込み接続（2B-2 以降）
- 旧 `PATCH /api/settings/dictionary` の削除・統合（Phase 3 以降）
- `status.*` の書き込み UI / API
- localStorage 廃止
- `.agent/settings.yaml` の完全切離し
- temporary辞書登録フロー / cleanup UI / promotion 系

---

---

### PHASE2B2_FRONTEND_PATCH_WIRING ✅ CLOSED 2026-05-26（ユーザー承認済み）

- **位置づけ**: Phase 2B-1（PATCH /api/config バックエンド）の次ステップ
- **スコープ**: frontend Settings の書き込み接続のみ（最小スコープ）
- **ステータス**: 実装完了・回帰確認待ち

**完了した実装**:
1. `frontend/src/services/documentService.js`
   - `updateAppConfig(updates)` を追加（`PATCH /api/config` のみ呼び出し）
2. `frontend/src/App.jsx`
   - `updateAppConfig` を import 追加
   - `isSavingConfig` / `configSaveError` state 追加
   - `handleConfigUpdate(updates)` 追加
     - 二重送信防止（`isSavingConfig` ガード）
     - 成功後 `GET /api/config` 再取得で `appConfig` 再同期
     - 失敗時はロールバックなし（保存前 state 維持 + `configSaveError` 表示）
   - SettingsSidebar に `onConfigUpdate` / `isSavingConfig` / `configSaveError` props 追加
3. `frontend/src/components/SettingsSidebar.jsx`
   - props に `onConfigUpdate` / `isSavingConfig` / `configSaveError` 追加
   - CONFIG セクション全面改修:
     - セクションラベル「CONFIG (app.toml)」＋保存中インジケータ
     - `ocr.rename_images_before_ocr` → チェックボックス（編集可能）
     - `ocr.write_status_after_ocr` → チェックボックス（編集可能）
     - `dictionary.use_experimental` → チェックボックス（編集可能・辞書リロード連携）
     - `status.property_name` / `status.ocr_done_value` → read-only（dim 表示）
     - `auto_downweight.mode` → select（"off" | "semi"）（編集可能）
     - YAML fallback 時は全コントロールを disable
     - エラー表示（`.config-save-error`）
4. `frontend/src/App.css`
   - `.config-kv-editable` / `.config-kv-check-label` / `.config-kv-select`
   - `.config-kv-readonly-key` / `.config-kv-readonly-val`
   - `.config-save-error` スタイル追加

**今回実装しなかったもの**（意図的除外）:
- status.property_name / status.ocr_done_value の編集
- localStorage 廃止
- 旧 PATCH /api/settings/dictionary の削除
- .agent/settings.yaml の完全切離し
- temporary辞書登録フロー / cleanup UI / promotion
- app.toml キー名の rename
- auto_downweight の実際のロジック変更

---

---

### PHASE2C_SETTINGS_API_UNIFICATION ✅ CLOSED 2026-05-26（ユーザー承認済み）

- **位置づけ**: Phase 2B-2（フロントエンド書き込み接続）の次ステップ
- **スコープ**: 旧 OCR / 辞書セクションの保存経路を PATCH /api/config に統一（UI 構造変更なし）
- **ステータス**: 実装完了・回帰確認済み・ユーザー承認済み

**完了した実装**:
1. `frontend/src/App.jsx`
   - import から `updateOcrSettings` / `updateDictionarySettings` を除去（deprecated のためコメント明記）
   - `handleOcrSettingChange` → `handleConfigUpdate({ 'ocr.<key>': value })` に変更（楽観的更新 + guard 失敗時 revert）
   - `handleDictionarySettingChange` → `updateAppConfig({ 'dictionary.<key>': value })` 直接呼び出し（ログ保持・`isSavingConfig` guard 追加）
   - `appConfig` useEffect：成功後に `setOcrSettings(c.ocr)` / `setDictionarySettings(c.dictionary)` で正本同期
   - `handleConfigUpdate`：成功後に `setOcrSettings` / `setDictionarySettings` を同期・`isSavingDictionary` guard 追加・bool 戻り値追加
2. `frontend/src/components/SettingsSidebar.jsx`
   - OCR セクション両チェックボックス：`disabled={isSavingConfig || isSavingDictionary || configStatus?.config_file_exists === false}` 追加
   - 辞書セクション：`disabled` に `isSavingConfig` と `configStatus?.config_file_exists === false` を追加
3. バックエンド変更なし（`PATCH /api/config` は Phase 2B-1 実装済みのまま利用）

**回帰確認結果**（実サーバー + 実 app.toml で確認済み）:
- [x] `GET /api/config` → `ocr.*` / `dictionary.*` / `status.*` / `auto_downweight.*` 正常返却
- [x] `PATCH /api/config` `ocr.rename_images_before_ocr: false` → 200、ラウンドトリップ確認 ✅
- [x] `PATCH /api/config` `dictionary.use_experimental: false/true` → 200、辞書リロード連携 ✅
- [x] 不正キー（`status.property_name`）→ 400 拒否 ✅
- [x] 型不一致（`"true"` → bool）→ 422 拒否 ✅
- [x] 旧 `GET /api/settings/ocr` → app.toml 値を引き続き返す ✅（後方互換）
- [x] 旧 `GET /api/settings/dictionary` → app.toml 値を引き続き返す ✅（後方互換）
- [x] temporary辞書 API (`GET /api/dictionary/temporary`) → 副作用なし ✅

**今回実装しないもの**（意図的除外）:
- `status.property_name` / `status.ocr_done_value` の編集可能化
- 旧 API の削除
- localStorage 廃止
- `.agent/settings.yaml` の完全切離し
- temporary辞書登録フロー / cleanup UI / promotion
- app.toml キー名変更
- auto_downweight のロジック変更

---

### PHASE3A_CONFIG_MIGRATION_CLEANUP_PLAN ✅ CLOSED 2026-05-26（ユーザー承認済み）

- **設計文書**: `scratch/DESIGN_PHASE3A_CLEANUP_PLAN.md`
- **スコープ**: 設計整理のみ。実装なし。
- **ステータス**: CLOSED（設計提出・ユーザー承認 2026-05-26）

---

### PHASE3B_STATUS_CONFIG_WRITABLE ✅ CLOSED 2026-05-26（ユーザー承認済み）

- **スコープ**: 旧 PATCH API 4 本の deprecated 注記統一 + status.* の PATCH /api/config 書き込み昇格
- **ステータス**: 実装完了・回帰確認済み・ユーザー承認待ち

**完了した実装**:
1. `backend/main.py`
   - `PATCH /api/settings/ocr` に deprecated コメント追加（旧 settings API 4 本すべてに注記揃え）
   - `_CONFIG_ALLOWED_KEYS` に `status.property_name` (str) / `status.ocr_done_value` (int) 追加
   - 型バリデーション: `int` ブランチを追加（`type(v) is int` で bool / float を排除）
   - 値制約チェック（ステップ 2b）を追加:
     - `status.property_name`: trim 後に空文字 → 422
     - `status.ocr_done_value`: 0 / 負数 → 422（got フィールド付き）
   - trim 済みの値で updates を上書きしてから TOML 書き込み
   - `PATCH /api/config` docstring に新キー 2 本と値制約 422 を追記
2. `frontend/src/components/SettingsSidebar.jsx`
   - `status.property_name`: read-only span → `<input type="text">` (onBlur 保存)
     - 空文字は保存せず元の値に戻す
     - 値に変化がない場合は API を呼ばない
   - `status.ocr_done_value`: read-only span → `<input type="number" min="1">` (onBlur 保存)
     - 1 未満 / NaN は保存せず元の値に戻す
   - 両 input とも `isSavingConfig || !config_file_exists` で disabled
   - `key={appConfig.status?.property_name}` / `key={appConfig.status?.ocr_done_value}` で保存後に defaultValue を再同期
3. `frontend/src/App.css`
   - `.config-kv-input` / `.config-kv-input:focus` / `.config-kv-input:disabled` / `.config-kv-input-num` スタイル追加

**回帰確認結果**（実サーバー + 実 app.toml で確認済み）:
- [x] `status.property_name` round-trip（"test_prop" → 保存 → GET で "test_prop"）✅
- [x] `status.ocr_done_value` round-trip（3 → 保存 → GET で 3）✅
- [x] `status.property_name` 空文字拒否 → HTTP 422 ✅
- [x] `status.property_name` 空白のみ拒否 → HTTP 422 ✅
- [x] `status.property_name` trim 動作確認（"  trimmed_prop  " → "trimmed_prop" 保存）✅
- [x] `status.ocr_done_value` 0 拒否 → HTTP 422 ✅
- [x] `status.ocr_done_value` 負数拒否 → HTTP 422 ✅
- [x] `status.ocr_done_value` 非 int（str）拒否 → HTTP 422 ✅
- [x] `status.ocr_done_value` bool 拒否 → HTTP 422 ✅
- [x] `status.ocr_done_value` float 拒否 → HTTP 422 ✅
- [x] 既存 OCR / dictionary / CONFIG キーの保存 → HTTP 200（回帰なし）✅
- [x] `GET /api/settings/ocr` / `GET /api/settings/dictionary` 後方互換 → HTTP 200 ✅
- [x] `PATCH /api/settings/ocr` / `PATCH /api/settings/dictionary` 後方互換 → HTTP 200 ✅
- [x] `GET /api/dictionary/temporary` 副作用なし → HTTP 200 ✅
- [x] 不正キー拒否 → HTTP 400 ✅
- [x] `SettingsSidebar.jsx` ESLint エラーなし ✅
- [x] `App.jsx` の ESLint エラーは Phase 3B 変更と無関係（Phase 2C 以前の既存問題）✅
- [x] `app.toml` を元の値（minji_status, 2）に復元済み ✅

**今回実装しなかったもの（意図的除外）**:
- App.jsx の appConfig 単一正本化
- ocrSettings / dictionarySettings state 削除
- isSavingDictionary 廃止
- GET /api/settings/ocr / dictionary の削除
- PATCH /api/settings/ocr / dictionary の削除
- YAML fallback 終了処理
- localStorage 整理
- temporary辞書 UI / cleanup UI / promotion 作業

**整理した論点**:
1. 旧 settings API 廃止計画（deprecated → removed の Gate 条件 4本）
2. YAML fallback 無期限維持方針の確定
3. `.agent/settings.yaml` 最終責務境界の固定（status.* 専管）
4. frontend state 整理の目標形（appConfig 一本化）と localStorage/app.toml 責務分離
5. 削除候補の優先順位と安全な削除順序（Step 1〜4）

**今回実装しないもの（明示的除外）**:
- 旧 API の削除
- status.* の編集可能化
- localStorage 廃止
- frontend state 統合実装
- temporary辞書登録フロー / cleanup UI / promotion との混合

---

### PHASE3C_APPCONFIG_SINGLE_SOURCE ✅ CLOSED 2026-05-26（ユーザー承認済み）

- **スコープ**: frontend の single source of truth 化と旧 GET 依存の除去
- **ステータス**: 実装完了・回帰確認済み・ユーザー承認待ち

**完了した実装**:
1. `frontend/src/App.jsx`
   - `ocrSettings` / `setOcrSettings` state 廃止
   - `dictionarySettings` / `setDictionarySettings` state 廃止
   - `isSavingDictionary` / `setIsSavingDictionary` state 廃止
   - 旧 `getOcrSettings()` / `getDictionarySettings()` useEffect の fallback 呼び出しを除去
   - import から `getOcrSettings` / `getDictionarySettings` を除去（コメントで意図明示）
   - `handleOcrSettingChange` を appConfig ベースの楽観更新 + `handleConfigUpdate` 経由に書き直し
   - `handleDictionarySettingChange` を appConfig ベースの楽観更新 + `handleConfigUpdate` 経由に書き直し（logging 保持）
   - `handleConfigUpdate`: `isSavingDictionary` ガード廃止 → `isSavingConfig` のみで OCR / dictionary / status / CONFIG すべての concurrent save を防止。appConfig の sync（`setOcrSettings` / `setDictionarySettings`）は不要になり除去
   - appConfig useEffect をシンプル化（`getAppConfig()` のみ、旧 API fallback なし）
   - SettingsSidebar props から `ocrSettings` / `dictionarySettings` / `isSavingDictionary` を除去
2. `frontend/src/components/SettingsSidebar.jsx`
   - props 定義から `ocrSettings` / `dictionarySettings` / `isSavingDictionary` を除去（Phase 3C コメント付与）
   - OCR セクション: `ocrSettings?.xxx` → `appConfig?.ocr?.xxx` に変更。`disabled` から `isSavingDictionary` 除去、`isSavingConfig` のみに統一
   - 辞書セクション: `dictionarySettings?.xxx` → `appConfig?.dictionary?.xxx` に変更。`isSavingDictionary` インジケータを `isSavingConfig` に変更
3. `frontend/src/services/documentService.js`
   - `getOcrSettings` / `getDictionarySettings` に `@deprecated 未使用だが 3D まで保持` コメント追記
   - 関数本体・旧 GET エンドポイント自体は変更なし（backend 旧 API の削除は Phase 3D）

**null / configStatus ガード設計**:
- `appConfig` null 時: `appConfig?.ocr?.xxx ?? デフォルト値` で安全にフォールバック
- `configStatus` null 時: `configStatus?.config_file_exists === false` → `undefined === false` → false → 無効化しない（ローディング中は操作可）
- 楽観更新 `setAppConfig(prev => prev ? { ...prev } : prev)` で null の場合は無操作

**回帰確認結果**（実サーバー + 実 app.toml で確認済み）:
- [x] OCR 設定 round-trip（rename_images_before_ocr: false → 保存 → GET で false）✅
- [x] 辞書設定 round-trip（use_experimental: false → 保存 → GET で false）✅
- [x] status.property_name round-trip（test_prop_3c → 保存 → GET で test_prop_3c → 元値に戻す）✅
- [x] status.ocr_done_value round-trip（3 → 保存 → GET で 3 → 元値に戻す）✅
- [x] 保存中 disabled 制御: isSavingConfig が OCR / dictionary / status / CONFIG 全セクションに効く ✅
- [x] 保存失敗時 revert: 不正キー → HTTP 400 → handleConfigUpdate returns false → 呼び出し元で prevConfig を revert ✅
- [x] appConfig null ガード（`prev => prev ? {...} : prev` パターン）✅
- [x] configStatus null ガード（`configStatus?.config_file_exists === false` optional chaining）✅
- [x] app.toml 不在時 disabled: `config_file_exists: true` で正常動作確認（不在時は configStatus 経由で disabled）✅
- [x] temporary辞書 API 副作用なし（GET /api/dictionary/temporary → 200）✅
- [x] 旧 GET API を frontend から呼ばなくなったことの grep 確認（App.jsx に実呼び出しゼロ）✅
- [x] 旧 GET API が backend に保持されていること（GET /api/settings/ocr / dictionary → 200）✅
- [x] ESLint 新規エラーなし（6 errors / 6 warnings はすべて Phase 3C 変更以前の既存問題）✅

**今回実装しなかったもの（意図的除外）**:
- GET /api/settings/ocr / dictionary の削除 → **Phase 3D で実施済み**
- PATCH /api/settings/ocr / dictionary の削除
- YAML fallback 終了
- backend 旧 API 削除 → GET のみ **Phase 3D で実施済み**
- localStorage 整理
- temporary辞書 UI / cleanup UI / promotion 作業

---

### PHASE3D_OLD_GET_API_REMOVAL ✅ CLOSED 2026-05-26（ユーザー承認）

- **スコープ**: 旧 GET API 2本の削除 + frontend 未使用関数の削除
- **ステータス**: CLOSED（実装完了・回帰確認済み・ユーザー承認 2026-05-26）

**完了した実装**:
1. `backend/main.py`
   - `GET /api/settings/ocr` エンドポイント削除（deprecated コメント含む）
   - `GET /api/settings/dictionary` エンドポイント削除（deprecated コメント含む）
   - `_read_ocr_settings_yaml()` 関数削除（削除後に参照ゼロとなったため）
   - `import yaml as _yaml` ブロック削除（`_read_ocr_settings_yaml` だけが使用していたため）
   - `PATCH /api/config` docstring に「Phase 3D 時点で GET 旧 API は削除済み」注記追加
2. `frontend/src/services/documentService.js`
   - `getOcrSettings()` 関数削除（`@deprecated` コメントブロック含む）
   - `getDictionarySettings()` 関数削除（`@deprecated` コメントブロック含む）
   - 各削除箇所に Phase 3D 削除完了コメントを残置
3. `frontend/src/App.jsx`
   - コメント「3D まで保持」→「3D で削除済み」に更新
   - useEffect コメントを Phase 3C/3D 混在表記に更新

**参照ゼロ確認**:
- `getOcrSettings` / `getDictionarySettings`: frontend / backend に実呼び出しゼロ ✅
- `GET /api/settings/ocr` / `GET /api/settings/dictionary`: backend に GET ルートなし ✅
  （`PATCH /api/settings/ocr` / `PATCH /api/settings/dictionary` は今回対象外・残存）

**回帰確認結果**（実サーバーで確認）:
- [x] GET /api/settings/ocr → 405（PATCH ルートのみ残存・GET 未登録）✅
- [x] GET /api/settings/dictionary → 405（同上）✅
- [x] PATCH /api/settings/ocr → 200（後方互換 PATCH は引き続き動作）✅
- [x] PATCH /api/settings/dictionary → 200（後方互換 PATCH は引き続き動作）✅
- [x] OCR 設定 round-trip（PATCH /api/config `ocr.rename_images_before_ocr: false` → GET → false）✅
- [x] 辞書設定 round-trip（PATCH /api/config `dictionary.use_experimental: false` → GET → false）✅
- [x] status round-trip（`status.property_name` / `status.ocr_done_value` → GET → 同値）✅
- [x] GET /api/config → 200（`ocr` / `dictionary` / `status` / `auto_downweight` 全フィールド正常返却）✅
- [x] GET /api/config/status → `config_file_exists: true` ✅
- [x] GET /api/dictionary/temporary → 200（temporary辞書系副作用なし）✅
- [x] backend テスト 40 件全通過（test_grammar_validator.py / test_text_processor.py）✅
- [x] ESLint: documentService.js エラーゼロ ✅
- [x] ESLint: App.jsx の 6 エラー/警告はすべて Phase 3D 変更以前の既存問題 ✅
- [x] main.py AST parse OK ✅
- [x] `_yaml` 変数参照ゼロ ✅

**今回実装しなかったもの（意図的除外）**:
- PATCH /api/settings/ocr / dictionary の削除
- YAML fallback 終了
- settings.yaml からの読み取り fallback 削除
- localStorage 整理
- temporary辞書 UI / cleanup UI / promotion 作業

---

### PHASE4A_PATCH_AND_FALLBACK_OBSERVABILITY_PLAN ✅ CLOSED 2026-05-26（ユーザー承認）

- **設計文書**: `scratch/DESIGN_PHASE4A_PATCH_AND_FALLBACK_OBSERVABILITY_PLAN.md`
- **スコープ**: 旧 PATCH API / YAML fallback / localStorage の観測・チェックプラン整理（コード変更なし）
- **ステータス**: CLOSED（設計提出・ユーザー承認 2026-05-26）

**確認・整理した内容**:
1. **PATCH_USAGE_OBSERVATION_ITEMS** — 旧 PATCH 2 本の実呼び出し元ゼロ確認（コード解析済み）・ログ観測手順・2 週間ゼロ判定基準・想定外呼び出し時の対処方針
2. **FALLBACK_EXIT_CHECKLIST_STATUS** — F-1（開発環境 OK /新規環境未確認）/ F-2（マイグレーションスクリプト未作成）/ F-3（fallback ログ未観測）/ F-4（旧 PATCH 削除未完了）の現状整理。F-2 の変換対象キー一覧（YAML 日本語キー → TOML 英語キー マッピング）を確定。
3. **PATCH_VS_FALLBACK_ORDERING_OPTIONS** — パターン A（Step X: PATCH 削除 → Step Y: fallback 終了）を推奨。パターン B は F-4 条件違反のため不採用。リスク・rollback・ログ検知の比較あり。
4. **LOCALSTORAGE_SCOPE_CLASSIFICATION** — backend 管理設定（ocr.*/ dictionary.*/ status.*/ auto_downweight.*）の localStorage 混入なし確認済み。残す項目 / 将来やめたい項目 / Phase 4 で触らない項目を分類。
5. **ROLLBACK_SCENARIO_LIST** — 3 シナリオ（PATCH 削除後 405 / fallback 削除後 app.toml 欠落 / status.値の定義 消失）と必要アーティファクト（`app.toml.example` / `migrate_yaml_to_toml.py` / `check_patch_callers.sh` / SETUP_MANUAL.md 追記）を整理。
6. **TASKS_MD_PHASE4_STRUCTURE_PROPOSAL** — Phase 4A/4B/4C の命名・責務・ロック条件を提案。

**今回変更しなかったもの（意図的除外）**:
- PATCH /api/settings/ocr / dictionary の削除
- config_loader の YAML fallback 削除
- settings.yaml のキー削除
- localStorage の変更
- temporary辞書 UI / cleanup UI / promotion 作業

---

### PHASE4B_OLD_PATCH_API_REMOVAL ✅ CLOSED 2026-06-09（ユーザー承認 + 実装完了）

- **前提条件**:
  - [x] PHASE4A 承認済み（2026-05-26）
  - [x] `PATCH /api/settings/ocr` / `PATCH /api/settings/dictionary` への実呼び出しゼロを **2 週間** 継続観測
    - 観測開始日: **2026-05-26**
    - 観測終了: **2026-06-09** ゼロ継続確認 ✅
  - [x] 準備アーティファクト完成（2026-05-26 作成）:
    - `app.toml.example` — 新規環境初期セットアップ用テンプレート ✅
    - `scripts/check_patch_callers.sh` — コード参照確認スクリプト（手動確認用） ✅
    - `SETUP_MANUAL.md` — セクション 6・7 追記（app.toml 配置 / rollback 手順） ✅
    - `scratch/DESIGN_MEMO_MIGRATE_YAML_TO_TOML.md` — マイグレーションスクリプト設計メモ ✅

**観測方法**:

```bash
# uvicorn access log から旧 PATCH API 呼び出しを確認
grep "PATCH /api/settings/ocr\|PATCH /api/settings/dictionary" \
  /Users/kazumikaizuka/Obsidian/Minji/proofreading-app/backend/server.log

# fallback WARNING ログを確認（app.toml 不在時のフォールバック）
grep "app.toml 不在" \
  /Users/kazumikaizuka/Obsidian/Minji/proofreading-app/backend/server.log
```

**現在の観測状況**（2026-05-26 開始）:
- PATCH /api/settings/ocr 呼び出し: 0 件（観測開始時点）
- PATCH /api/settings/dictionary 呼び出し: 0 件（観測開始時点）
- fallback WARNING: 0 件（観測開始時点）

**コード参照確認**（2026-05-26 実行済み）:
- `bash scripts/check_patch_callers.sh` 結果:
  - backend: PATCH エンドポイント定義 2 件 FOUND（削除予定通り残存）
  - frontend: updateOcrSettings / updateDictionarySettings 実呼び出し → **NOT FOUND ✅**
  - obsidian-plugin: 参照なし → **NOT FOUND ✅**

- **スコープ（予定）**:
  - `backend/main.py`: `PATCH /api/settings/ocr` 削除 + `_write_ocr_yaml_bool()` + `_SETTINGS_YAML` 変数 + リクエストモデル削除
  - `backend/main.py`: `PATCH /api/settings/dictionary` 削除
  - `frontend/src/services/documentService.js`: `updateOcrSettings()` / `updateDictionarySettings()` 削除
- **ステータス**: ✅ CLOSED（2026-06-09 実装完了）

**実装済み（2026-06-09）**:
  - `backend/main.py`: `PATCH /api/settings/ocr` / `PATCH /api/settings/dictionary` 削除済み
  - `backend/main.py`: `_write_ocr_yaml_bool()` / `_SETTINGS_YAML` 削除済み
  - `backend/models.py`: `OcrSettings` / `UpdateOcrSettingsRequest` / `DictionarySettings` / `UpdateDictionarySettingsRequest` 削除済み
  - `frontend/src/services/documentService.js`: `updateOcrSettings()` / `updateDictionarySettings()` 削除済み

**想定外イベント時の対応**:
- 旧 PATCH 呼び出しが 1 件でも出た場合:
  1. 呼び出し元を特定（uvicorn log の IP・UA・timestamp から追跡）
  2. 移行依頼または修正方針を整理してユーザーに報告
  3. 観測窓をその日から 2 週間リスタート
- fallback WARNING が出た場合:
  1. app.toml 未配置環境を特定
  2. `app.toml.example` / SETUP_MANUAL.md §6 を使って環境復旧
  3. F-1 / F-3 の状態を再評価してユーザーに報告

**2026-06-09 次回報告フォーマット**:
```
PATCH_OBSERVATION_WINDOW_RESULT          （ゼロ継続 / 検出あり）
FALLBACK_WARNING_OBSERVATION_RESULT      （ゼロ継続 / 検出あり）
PHASE4B_UNLOCK_DECISION                  （UNLOCK 可 / 不可・理由）
F1_TO_F4_REEVALUATION_STATUS             （各条件の現状）
UNEXPECTED_CALLER_DETECTION_STATUS       （なし / あり・詳細）
WAITING_FOR_APPROVAL
```

---

### PHASE4C_YAML_FALLBACK_EXIT 🔒 LOCKED（Phase 4B 承認 + F-1〜F-4 全充足後に着手可）

- **前提条件**:
  - PHASE4B 承認済み（F-4 充足）
  - F-1: `app.toml` を全デプロイ環境に配備済み（新規セットアップ確認含む）
  - F-2: `scripts/migrate_yaml_to_toml.py` 作成・動作確認済み
  - F-3: fallback WARNING ログ（`app.toml 不在` ログ）のゼロ確認を **2 週間** 継続
- **スコープ（予定）**:
  - `config_loader.py`: `_load_yaml_lazy()` / `_get()` else ブランチ / `get_status_settings()` YAML 分岐 / `_has_yaml_logged` / `yaml import` 削除
  - `settings.yaml`: `ocr.*` / `dictionary.*` / `auto_downweight.*` / `status.プロパティ名` / `status.OCR完了値` に移行済みマークまたは削除（`status.値の定義` は**永続残留**）
  - `scripts/migrate_yaml_to_toml.py` 新規作成
- **ステータス**: LOCKED

---

> **現フェーズ: 実験観測フェーズ V2（2026-05-23 独立）**
> - Task #11 設計判断フェーズは正式クローズ済み
> - V2 観測は Task #11 の継続ではなく、**独立した新フェーズ**として扱う
> - 目標: 本番史料 20〜30 件追加操作 → 集計 → 報告

> **凍結方針（2026-05-23 正式確定・V2 完了まで変更しない）**
> - `is_dangerous` 条件は現行のまま固定（`rank1_is_proper_noun AND NOT rank1_from_shape`）
> - `is_dangerous` 条件に experimental rank1 を追加しない
> - AUTO_DOWNWEIGHT / 自動降格ロジックの実装なし
> - experimental ON/OFF 差分 UI の実装なし
> - `_load_proper_nouns()` の type フィルタ実装（案A）なし ← V2 データ確認後に判断
> - `proper_nouns.core.yaml` から控訴 エントリ削除なし（案C）← 最終手段バックアップのみ
> - ルール変更・辞書削除などの「挙動変更」は V2 観測結果が出るまで一切行わない

---

### 実験観測フェーズ V2 🔍 観測待ち（2026-05-23 開始）

- **位置づけ**: Task #11 クローズ後の独立フェーズ。Task 番号は付与しない
- **前提**: Task #11 設計判断フェーズ ✅ CLOSED（下記参照）
- **目標**: 本番史料 20〜30 件の追加操作（山梨以外の地域を含む）

#### 操作対象
  - experimental ON のまま、本番史料に近いデータで操作
  - 山梨以外の地域（地名・法制語が混在する史料を優先）
  - legal_term 12語 全件の dangerous 発生状況を意識して操作

#### 集計手順
```bash
cd /Users/kazumikaizuka/Obsidian/Minji/proofreading-app
# 1. flush（設定サイドバー → ログをフラッシュ）
# 2. 集計
python3 evaluation/aggregate_experimental.py | tee snapshots/experimental-on-obs-V2/aggregate_result.txt
# 3. ログコピー
cp evaluation/logs/span_accepted.jsonl        snapshots/experimental-on-obs-V2/
cp evaluation/logs/user_actions.jsonl         snapshots/experimental-on-obs-V2/
cp evaluation/logs/learning_candidates.jsonl  snapshots/experimental-on-obs-V2/ 2>/dev/null || true
```

#### 次回報告形式（確定）
  - `EXPERIMENTAL_ON_DATA_COLLECTION_STATUS_V2`（本番史料 20〜30 件）
  - `AGGREGATE_EXPERIMENTAL_RUN_RESULT_V2`
  - `FALSE_POSITIVE_REVIEW_UPDATE`（legal_term 全 12 語の dangerous 発生有無）
  - `PROPER_NOUN_TERMS_SOURCE_NOTE`（`scratch/DESIGN_MEMO_PROPER_NOUN_TERMS_FILTER.md` 参照）
  - `WAITING_FOR_APPROVAL`

---

### 11. EXPERIMENTAL_LOG_AGGREGATION + PROPER_NOUN_TERMS_TYPE_FILTER 設計 ✅ CLOSED 2026-05-23

**クローズ理由**: 設計判断フェーズ完了・コード変更なし  
**成果**: 根本原因特定 / 案A〜C 設計 / tasks.md・DESIGN_MEMO・FALSE_POSITIVE_REVIEW・snapshots 整備  
**次フェーズ**: 実験観測フェーズ V2（上記、Task 番号なし）

- **実装済み（設計基盤のみ）**:
  - `evaluation/aggregate_experimental.py` — experimental 関連ログ集計スクリプト（CLI のみ）
  - `evaluation/docs/EXPERIMENTAL_LOG_SCHEMA.md` — ログ仕様メモ
  - `evaluation/docs/EXPERIMENTAL_COMPARISON_PROTOCOL.md` — ON/OFF 比較手順書
  - `data/dictionaries/staging/test_meiji_legal.csv` — テスト用実験的辞書（5エントリ）
  - `scratch/test_experimental_observe.md` — テスト用複製ノート（本番史料ではない）

#### V1 観測結果（2026-05-23）
  - A=5 / B=1 / C=2（合計 experimental 操作 8件）
  - D=1（dangerous accept）/ E=1（dangerous reject）/ F=2（dangerous skip）
  - G=62.5%（experimental accept rate）
  - H: OFF→ON 切替 1件記録（2026-05-23T10:00:00）
  - スナップショット: `snapshots/experimental-on-obs-20260523/`

#### 根本原因特定（2026-05-23）— `控訴 → proper_noun_terms 混入`
  - **原因**: `file_context_hint.py / _load_proper_nouns()` が type フィルタなしで core.yaml 全エントリを `proper_noun_terms` に追加
  - **混入経路**: `控訴 (type: legal_term)` → `proper_noun_terms.add()` → `rank1_is_proper_noun = True` → `is_dangerous = True`
  - **詳細**: `scratch/DESIGN_MEMO_PROPER_NOUN_TERMS_FILTER.md` 参照

#### 修正案 A〜C 設計確定（2026-05-23）— **現時点では実装しない**
  - **案A（将来採用候補 第一案）**: `_load_proper_nouns()` 側で `type: legal_term` を `proper_noun_terms` から除外
  - **案B（中長期 refactor・保留）**: `place_terms` と `legal_terms` を分離
  - **案C（最終手段バックアップのみ）**: core.yaml から `控訴` エントリ削除

---

### 1. DANGEROUS_CANDIDATE_VIS_MODE ✅ UPDATED 2026-05-22
- `backend/models.py` — `AnalyzedSpan.rank1_is_proper_noun: bool` / `rank1_from_shape: bool` フィールド追加
  - `is_dangerous` 条件変更: `verdict == "reject"` → `rank1_is_proper_noun and not rank1_from_shape`
  - 条件①: rank1候補が proper_noun_terms 由来のとき dangerous
  - 条件②: rank1候補が shape_pairs 由来（安全な字形補正）のときは dangerous から除外
- `backend/ai_analyzer.py` — results.append() に `rank1_is_proper_noun` / `rank1_from_shape` 計算・付与
  - `rank1_is_proper_noun = candidates[0] in proper_noun_terms`（proper_noun_terms が None の場合は False）
  - `rank1_from_shape = candidates[0] in shape_detector.lookup(text_span)`
- `frontend/src/components/Proofreader.jsx` — `highlight-dangerous` class 付与（補正済みは除外）✅ 既実装
- `frontend/src/components/Proofreader.css` — 赤系スタイル追加（通常/hover/active）✅ 既実装

### 2. stable / experimental 辞書ティア分離 ✅
- `backend/models.py` — `DictionaryTerm.tier: str = "stable"` フィールド追加
- `backend/dictionary_loader.py` — `load_csv(tier=)` 引数追加、`approved/` → stable、`staging/` → experimental で自動タグ付け
- `backend/candidate_engine.py` — experimental 語のスコアに `× 0.8` ペナルティ適用

### 3. USER_ACTION_LOGGING ✅ dangerous flag 接続済み 2026-05-22
- `backend/models.py` — `CorrectionEntry.action_type: str = "accept"` フィールド追加
- `frontend/src/services/learningEventLogger.js` — `logSpanSkipped()` 追加
- `frontend/src/components/Proofreader.jsx` — `dismissPopover()` ヘルパー追加、Escape/overlay/close ボタンに適用
- **dangerous flag 接続（最小ログ）**: accept/reject/ignore の3操作すべてに `isDangerous` フィールドが流れる
  - `logSpanAccepted` → `dismissedDangerFlag` (is_dangerous=true 状態で候補選択)
  - `logSpanRejected` → `isDangerous`
  - `logSpanSkipped` → `isDangerous`
  - バックエンド: `span_accepted.jsonl` / `user_actions.jsonl` に自動ルーティング済み
- AUTO_DOWNWEIGHT への自動処理は未実装（次フェーズ以降）

### 5. VALIDATOR_SUGGESTION_INJECTION ✅
- `backend/ai_analyzer.py` — Condition B: `elif proper_noun_terms` → `elif file_context_hint`
  （region alias bonus-only も捕捉できるよう修正）

### 6. GEO_ALIAS_NOISE_SUPPRESSION (Option B) ✅
- `backend/file_context_hint.py` — `build()` 戻り値に `geo_noun_terms: set[str]` を追加
  （prefectures + regional yaml 由来のみ、core.yaml は含まない）
- `backend/candidate_engine.py` — bonus-only ループ内に geo フィルタを追加
  （`geo_noun_terms and term in geo_noun_terms and Ls < 3` で短スパンへの地名 alias 滑り込みを抑制）
- `backend/ai_analyzer.py` — `generate_candidates()` / `analyze_document()` に `geo_noun_terms` 伝搬

### 7. KATAKANA_BIGRAM_NORMALIZATION ✅
- `backend/particle_script.py` — `detect_hira_bigram_suspects()` 追加
  （katakana_dominant 文書でひらがな2文字スパンを検出、`_kata_bigram_candidate` キーで候補提示）
- `backend/ai_analyzer.py` — ステップ G を追加、`_kata_bigram_candidate` 注入ロジックを追加
  （自動適用なし、dict/shape 候補なし時は先頭昇格、有る場合は末尾追加）

### 8. SPAN_ACCEPTED_LOGGING ✅
- `backend/models.py` — `AnalyzedSpan.is_bigram_suspect: bool = False` フィールド追加
- `backend/ai_analyzer.py` — results.append() に `is_bigram_suspect: bool(span_data.get("_kata_bigram_candidate"))` を追加
- `backend/main.py` — `/api/learning/flush` で `event == "span_accepted"` を `span_accepted.jsonl` にルーティング
- `frontend/src/services/learningEventLogger.js` — `logSpanAccepted()` 追加（Tier 1）
- `frontend/src/components/Proofreader.jsx` — `handleCandidateSelect()` 内で `logSpanAccepted()` 発火
  ログフィールド: docId / spanId / suspectSpan / chosenCandidate / candidateList / wasBigramSuspect / particleScript / dismissedDangerFlag

**収集後の評価方針**:
- `span_accepted.jsonl` に一定量たまったら、`suspectSpan == "わり"` etc に対する `chosenCandidate` の分布を集計
- `wasBigramSuspect && particleScript == "katakana_dominant"` フィルタで絞り込み
- 同一 suspect_span に対して特定 candidate が 80%+ → rule 化候補として昇格を検討

### 9. SPAN_ACCEPTED_AGGREGATION + WARI_SOFT_HINT ✅
- `evaluation/aggregate_span_accepted.py` — 新規スクリプト。以下の集計を出力:
  - [1] wasBigramSuspect 件数  [2] katakana_dominant 件数  [3] 手動入力件数
  - [4] suspectSpan × chosenCandidate 上位20件  [5] candidateList in/out 比率
  - [6] bigram suspect 絞り込み表  [7] katakana_dominant 分布  [8] わり詳細
  - `candidateRank` は既存ログに含まれない場合 candidateList から再計算
- `backend/models.py` — `AnalyzedSpan.soft_hint_candidates: dict[str, str] = {}` フィールド追加
- `backend/ai_analyzer.py` — soft hint 注入ロジック追加（わり→ヨリ、manual_override_seed）
  - 適用条件: kata_bigram AND suspectSpan=="わり" AND katakana_dominant
  - candidates に "ヨリ" を末尾追加（"ワリ" は維持、自動置換なし）
  - soft_hint_candidates: {"ヨリ": "manual_override_seed"} を span に付与
- `frontend/src/services/learningEventLogger.js` — `logSpanAccepted` に `hintSource` パラメータ追加
  - 値が null の場合はフィールド自体を省略（既存ログとの互換性を維持）
- `frontend/src/components/Proofreader.jsx` — `handleCandidateSelect` で `soft_hint_candidates` から hintSource を取得してログに渡す

**次のアクション**:
- 一定量集積後に `python3 evaluation/aggregate_span_accepted.py` で集計
- わり→ヨリ のログ件数が bigram suspect 内で 80%+ に達したら shape_pairs 昇格を再検討

### 4. AUTO_DOWNWEIGHT semi モード（準備フェーズ）
- **概要**: 同一スパンを繰り返し「却下」した場合にスコアを自動減衰させる semi-supervised モード
- **依存**: user_action ログ (#3) 完了後
- **ステータス**: 設計待ち（USER_ACTION_LOGGING 接続後に着手）

### 10. DICT_TIER_SAFETY ✅ CLOSED 2026-05-23
- **設計方針（案C 採用）**:
  - `is_dangerous` 条件は現行のまま固定（rank1_is_proper_noun AND NOT rank1_from_shape）
  - experimental rank1 単独では dangerous にしない（false positive 抑制優先）
  - `rank1_from_experimental_dict` は **観測用補助フィールド**として追加（is_dangerous に不混入）
  - まず accept/reject/skip ログで experimental 語の挙動を観測し、必要なら条件追加を次フェーズで検討
- **実装済み**:
  - `backend/models.py` — `AnalyzedSpan.rank1_from_experimental_dict: bool = False` 追加
  - `backend/ai_analyzer.py` — experimental tier forms セット計算・`rank1_from_experimental_dict` 付与
  - `frontend/src/services/learningEventLogger.js` — 3操作ログに `rank1FromExperimental` 追加（null 時省略）
  - `frontend/src/components/Proofreader.jsx` — popover reason 行に「実験的辞書」タグ表示（条件変更なし）
  - `frontend/src/components/Proofreader.css` — `.tag-experimental-dict` スタイル追加
- **次フェーズ**: EXPERIMENTAL_LOG_AGGREGATION (#11) にて観測継続

---

## 凍結・保留

- OCR 実行ボタン UI 改善: 保留

### PROPER_NOUN_TERMS_TYPE_FILTER — 設計確定・実装保留（2026-05-23）

- **背景**: `控訴 (type: legal_term)` が `proper_noun_terms` に混入 → `is_dangerous = True` の False Positive
- **将来採用候補: 案A**
  - `_load_proper_nouns()` に `include_types` 引数追加
  - core.yaml ロード時に `type: legal_term` を `proper_noun_terms` から除外
  - `proper_noun_terms` には `place / office / era` のみ残す
  - legal_term は `hints`（スコアリング）には引き続き残す
- **実装トリガー**: V2 観測（20〜30 件）で legal_term 由来 dangerous が 控訴 以外にも確認されたとき
- **設計メモ**: `scratch/DESIGN_MEMO_PROPER_NOUN_TERMS_FILTER.md`
- **追跡シート**: `evaluation/docs/FALSE_POSITIVE_REVIEW.md`

---

### PHASE5_DICT_GUI ✅ CLOSED 2026-06-09（実装完了）

- **スコープ**: 辞書エントリの一覧・追加・編集・削除・検索・バックアップ GUI
- **方針変更**: 2026-06-09 開発方針を「実用上の完成」優先に変更。Phase 4C 以降の先行実装は行わない。

**完了した実装（2026-06-09）**:
1. `backend/approved_dict_manager.py` 新規作成
   - `ApprovedDictManager` クラス（list/read/append/update/delete/backup）
   - 書き込み前自動バックアップ（`archive/old_versions/` にタイムスタンプ付き保存）
   - 原子的書き込み（tempfile + os.replace）
   - パストラバーサル防止（`resolve()` + prefix チェック）
2. `backend/models.py` に approved 辞書モデル追加
   - `ApprovedDictEntry` / `AddApprovedEntryRequest` / `UpdateApprovedEntryRequest` / `ApprovedDictListResponse`
3. `backend/main.py` に API エンドポイント追加
   - `GET /api/dictionary/entries?q=` — 全エントリ + 検索（term/normalized/category/domain）
   - `POST /api/dictionary/entries` — エントリ追加（即時 reload）
   - `PUT /api/dictionary/entries/{filename}/{term}` — 部分更新（即時 reload）
   - `DELETE /api/dictionary/entries/{filename}/{term}` — 削除（バックアップ後）
   - `POST /api/dictionary/backup` — 手動バックアップ
4. `frontend/src/components/DictionaryManager.jsx` 新規作成
   - モーダルオーバーレイ形式（ヘッダーの 📖 ボタンで開閉）
   - ファイルタブ + フロントエンドサイド検索・フィルタ
   - インライン編集（行クリック→該当行がフォームに展開）
   - 削除確認ダイアログ（「バックアップ後に削除」を明示）
   - バックアップボタン + 結果メッセージ
5. `frontend/src/services/documentService.js` に approved 辞書 API 関数追加
6. `frontend/src/App.jsx` にボタン追加・コンポーネントマウント
7. `frontend/src/App.css` に辞書 GUI スタイル追加

**完成条件の充足状況（2026-06-09）**:
- [x] OCR が動作すること（既存）
- [x] 辞書を参照して補正処理に反映できること（既存）
- [x] 辞書エントリを GUI で一覧表示できること ✅
- [x] 辞書エントリを GUI で追加・編集できること ✅
- [x] 辞書エントリを削除、または少なくとも無効化できること ✅（物理削除 + バックアップ）
- [x] 辞書エントリを検索できること ✅
- [x] GUI 上の変更を保存し、再読込または即時反映できること ✅
- [x] 辞書データの破壊を避けるため、最低限のバックアップ手段を持つこと ✅

**今回スコープ外（後回し）**:
- staging/ エントリの GUI 編集
- approved→staging 昇格フロー
- Phase 4C（YAML fallback 終了）
- 実験観測ダッシュボード
- PDF OCR import

---

## ポスト移行・将来予定

### PDF_OCR_IMPORT 🗓 ポスト移行予定（outside-Vault 移行安定後）

- **設計文書**: `docs/pdf_ocr_design.md`（ソースオブトゥルース）
- **ステータス**: 未着手。設計完了・アーキテクチャ予約済み。
- **実装条件**（`docs/pdf_ocr_design.md > Implementation Timing` 参照）:
  - [ ] アプリリポジトリが Obsidian Vault 外で動作している
  - [ ] `VAULT_ROOT` 設定が安定している
  - [ ] `OCR_TEMP_ROOT` が Vault 外を指している（現在: `/Users/kazumikaizuka/Obsidian/ocr_temp` ✅）
  - [ ] 既存の画像 OCR ワークフローが移行後も動作確認済み
  - [ ] Markdown 保存・バックアップ動作が確認済み
  - [ ] ログ・辞書・キャッシュパスが Obsidian Sync スコープ外に分離済み

**現時点で保証済みの制約（コード側）**:
- `OCR_TEMP_ROOT` は Vault 外（`.env` 専管・Sync 対象外）
- `get_pdf_settings()` スタブを `config_loader.py` に追加済み（設定読み取り口の予約）
- `PDF_ALLOWED_ROOTS` / `PDF_RENDER_DPI` / `PDF_RENDER_FORMAT` / `PDF_CACHE_TTL_HOURS` の env var 名を `.env.example` / `app.toml.example` に記載済み
- 既存の画像 OCR パス（`ocr_runner.py`）は変更なし

**実装しないこと（この段階では）**:
- `pypdfium2` の追加
- PDF レンダリング関数の実装
- PDF API エンドポイントの追加
- フロントエンド PDF ビューアー

**実装時の参照先**:
- `docs/pdf_ocr_design.md` — 全仕様（ワークフロー / 設定 / ノート形式 / エラー処理 / 検証チェックリスト）
- `backend/config_loader.py` — `PdfSettings` / `get_pdf_settings()`（スタブ→実装に昇格する）
- `backend/.env.example` — PDF 設定の env var テンプレート
- `app.toml.example` — `[pdf]` セクションのコメント（将来 TOML 化候補）
