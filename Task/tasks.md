# Task Tracker — proofreading-app

最終更新: 2026-05-25（Phase M-1 手動訂正後 temporary辞書登録プロンプト追加）

---

## 完了済み

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

---

## 進行中・次優先

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
