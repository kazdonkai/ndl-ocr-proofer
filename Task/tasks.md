# Task Tracker — proofreading-app

最終更新: 2026-05-22（DANGEROUS_CANDIDATE_VIS_MODE 条件変更 + USER_ACTION_LOGGING 接続確認）

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
- [x] FILE_BULK_KATA — 全ページ一括カタカナ化（Task 10）
  - `settings.js` — `document.bulkKatakanaThreshold: 0.85` 追加
  - `SettingsSidebar.jsx` — 「全ページカタカナ優勢判定閾値」スライダー（min 85%・凍結対象外）
  - `App.jsx` — `bulkKatakanaThreshold` prop を Proofreader に渡す
  - `Proofreader.jsx` — `fileLevelKataRatio` メモ（全ページカナ文字比率）・`handleFileBulkHiraAllPreview` / `executeFileBulkHiraAll` ハンドラー・undo/redo 対応（`isFileBulkHiraAllNorm`）・ツールバー ROW 1「カタカナ優勢 XX%」バッジ右隣ボタン・確認ダイアログ・補正一覧「全カタカナ一括 N文字」表示
  - `Proofreader.css` — `.btn-file-bulk-kata` / `.crp-item.crp-bulk-norm .crp-suspect { max-width: none }`

---

## 進行中・次優先

> **次フェーズ優先順位（2026-05-22 確定）**
> 1. DANGEROUS_CANDIDATE_VIS_MODE（dangerous flag 可視化）
> 2. USER_ACTION_LOGGING（accept/reject/ignore 操作ログ基盤）
> 3. DICT_TIER_SAFETY（stable / experimental tier 分離と切替安全性担保）

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

### 10. DICT_TIER_SAFETY（次フェーズ着手予定）
- **概要**: stable / experimental 辞書 tier の分離と切替安全性の整理
- **スコープ**:
  - `approved/` → stable tier、`staging/` → experimental tier の自動タグ付け（dictionary_loader.py、既実装）
  - experimental tier の切替安全性: 切替前後で is_dangerous 変化スパンの差分確認 UI
  - experimental 辞書語が rank1 かつ dangerous になるケースの扱い整理
- **依存**: DANGEROUS_CANDIDATE_VIS_MODE 完了後
- **ステータス**: 設計待ち

---

## 凍結・保留

- OCR 実行ボタン UI 改善: 保留
