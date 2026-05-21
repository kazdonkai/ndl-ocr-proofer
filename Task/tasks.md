# Task Tracker — proofreading-app

最終更新: 2026-05-22（Task 9: span_accepted 集計スクリプト + わり→ヨリ soft hint）

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

---

## 進行中・次優先

### 1. DANGEROUS_CANDIDATE_VIS_MODE ✅
- `backend/models.py` — `AnalyzedSpan.is_dangerous` computed field 追加（`verdict == "reject"` → true）
- `frontend/src/components/Proofreader.jsx` — `highlight-dangerous` class 付与（補正済みは除外）
- `frontend/src/components/Proofreader.css` — 赤系スタイル追加（通常/hover/active）

### 2. stable / experimental 辞書ティア分離 ✅
- `backend/models.py` — `DictionaryTerm.tier: str = "stable"` フィールド追加
- `backend/dictionary_loader.py` — `load_csv(tier=)` 引数追加、`approved/` → stable、`staging/` → experimental で自動タグ付け
- `backend/candidate_engine.py` — experimental 語のスコアに `× 0.8` ペナルティ適用

### 3. user_action ログ追加 ✅
- `backend/models.py` — `CorrectionEntry.action_type: str = "accept"` フィールド追加
- `frontend/src/services/learningEventLogger.js` — `logSpanSkipped()` 追加
- `frontend/src/components/Proofreader.jsx` — `dismissPopover()` ヘルパー追加、Escape/overlay/close ボタンに適用

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
- **ステータス**: 設計待ち

---

## 凍結・保留

- 設定項目の追加: 凍結（2026-05-21）
- OCR 実行ボタン UI 改善: 保留
