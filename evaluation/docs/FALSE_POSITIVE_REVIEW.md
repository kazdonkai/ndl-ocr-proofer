# FALSE_POSITIVE_REVIEW — legal_term 由来 dangerous 誤判定 追跡シート

作成: 2026-05-23  
最終更新: 2026-05-23（Task #11 正式クローズ・V2 フェーズ独立）

---

## 概要

`is_dangerous = True` の偽陽性（False Positive）を追跡するドキュメント。  
特に `proper_noun_terms` に混入した `type: legal_term` 語が原因となるケースを記録する。

**根本原因**: `_load_proper_nouns()` の type フィルタ欠如 → [設計メモ](../../scratch/DESIGN_MEMO_PROPER_NOUN_TERMS_FILTER.md) 参照  
**修正方針**: 案A（type フィルタ追加）— 実装は次フェーズ待ち

---

## legal_term 全 12 語のステータス（core.yaml 由来）

| 語 | aliases | V1 での dangerous 観測 | V2 での dangerous 観測 | 備考 |
|----|---------|----------------------|----------------------|------|
| 官有地 | — | 未観測 | — | 地目分類語 |
| 民有地 | — | 未観測 | — | 官有地に対する語 |
| 入会権 | 入会, 入会地 | 未観測 | — | 入会一件で頻出 |
| 共有地 | 共有山, 共有林, 共有林野 | 未観測 | — | |
| 山論 | 山論一件, 山論訴訟 | 未観測 | — | |
| 地租 | 地租改正, 地租改正条例 | 未観測 | — | |
| 地券 | — | 未観測 | — | |
| 地押調査 | — | 未観測 | — | |
| 林野 | — | 未観測 | — | |
| 申立 | — | 未観測 | — | ※ GrammarValidator で別問題あり（申立レ共/トモ の候→レ誤変換）|
| **控訴** | 控訴状, 控訴審, 控訴裁判 | **⚠️ V1 で観測: dangerous=True** | — | **根本原因特定済み。案A で解消予定** |
| 訴状 | 訴訟, 訴訟状 | 未観測 | — | |

**V1 Summary**: `控訴` のみ dangerous 観測（B=1 reject, F=2 skip, E=1 reject is_dangerous）

---

## V2 観測での確認事項

1. **legal_term 12 語のうち、控訴 以外で dangerous が出るか**  
   → 出ない場合: 「控訴 のみが問題（type フィルタより個別対応でも可）」の議論あり  
   → 複数語で出る場合: 「type: legal_term 一括遮断が正当化される」根拠強化

2. **V1 での suspicious suspectSpan 分布（参考）**:

   | suspectSpan | total | accept | reject | skip | accept率 |
   |-------------|-------|--------|--------|------|---------|
   | 山奈 | 2 | 1 | 0 | 1 | 50.0% |
   | 催足 | 2 | 2 | 0 | 0 | 100.0% |
   | 控告 | 2 | 0 | 1 | 1 | 0.0% |
   | 酒治 | 1 | 1 | 0 | 0 | 100.0% |
   | 裁判人 | 1 | 1 | 0 | 0 | 100.0% |

   → `控告`（→ 控訴 として出た）が 0% accept = ユーザーが全件拒否・スキップ = 正しい判断

3. **era（元号）由来の dangerous が出るか**  
   → core.yaml に era エントリが 41 語ある。元号（明治・大正・昭和等）が dangerous になる場合、案A で era も除外候補に

---

## 過去の偽陽性インシデント記録

| 日付 | 語 | type | 症状 | 対応 |
|------|-----|------|------|------|
| 2026-05-23 | 控訴 | legal_term | `控告` スパンの rank1 が `控訴` → is_dangerous=True | 根本原因特定。案A 設計確定。実装は次フェーズ |

---

## 判断基準（次フェーズ実装トリガー）

**案A 実装を判断する条件**:
- V2 データで legal_term 由来の dangerous が **控訴 以外にも 2 語以上** 観測される、または
- V1+V2 合計で legal_term 由来 dangerous の reject/skip 率が **80%以上**（ユーザーが一貫して拒否）

**上記に達しない場合**: さらに観測継続（V3）または案Cバックアップ（控訴のみ削除）を検討

---

## V2 次回報告形式（確定・2026-05-23）

V2 観測完了時には以下の形式で報告する。

```
EXPERIMENTAL_ON_DATA_COLLECTION_STATUS_V2
  - 本番史料操作件数: XX 件（目標: 20〜30 件）
  - 対象地域: 山梨 + [その他地域名]
  - 期間: YYYY-MM-DD 〜 YYYY-MM-DD

AGGREGATE_EXPERIMENTAL_RUN_RESULT_V2
  - A（experimental accept）: X
  - B（experimental reject）: X
  - C（experimental skip）: X
  - D（dangerous accept）: X
  - E（dangerous reject）: X
  - F（dangerous skip）: X
  - G（experimental accept rate）: X%
  - スナップショット: snapshots/experimental-on-obs-V2/

FALSE_POSITIVE_REVIEW_UPDATE
  - legal_term 12語 の dangerous 観測状況:
    | 語 | V2 dangerous 観測 | 備考 |
    |------|------|------|
    | 官有地 | 未観測 / ⚠️ 観測 | |
    | 民有地 | ... | |
    | 入会権 | ... | |
    | 共有地 | ... | |
    | 山論 | ... | |
    | 地租 | ... | |
    | 地券 | ... | |
    | 地押調査 | ... | |
    | 林野 | ... | |
    | 申立 | ... | |
    | 控訴 | ⚠️ V1 で観測済み | |
    | 訴状 | ... | |
  - 控訴 以外で 2語以上観測 → 案A 実装推奨
  - 控訴 のみ → 観測継続 or 案C バックアップ検討

PROPER_NOUN_TERMS_SOURCE_NOTE
  - 参照: scratch/DESIGN_MEMO_PROPER_NOUN_TERMS_FILTER.md
  - proper_noun_terms への era 混入状況（明治・大正・昭和等の dangerous 観測有無）

WAITING_FOR_APPROVAL
```
