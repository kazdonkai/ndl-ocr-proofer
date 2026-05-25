# LOG_SCHEMA_NOTE — Experimental Dictionary Observation

作成: 2026-05-23  
対象フェーズ: EXPERIMENTAL_LOG_AGGREGATION（観測フェーズ）

---

## 1. ログファイル構成

| ファイル | 対象イベント | 主な目的 |
|---|---|---|
| `evaluation/logs/span_accepted.jsonl` | `span_accepted` | accept パターン蓄積・bigram rule-promotion 判断材料 |
| `evaluation/logs/user_actions.jsonl` | `span_rejected`, `span_skipped` | reject/skip パターン蓄積・AUTO_DOWNWEIGHT 判断材料 |
| `evaluation/logs/learning_candidates.jsonl` | その他全イベント | doctype_switched, particle_norm_applied, **dictionary_setting_changed** 等 |

---

## 2. accept / reject / skip の定義

| 操作 | イベント名 | 書き込み先 | 定義 |
|---|---|---|---|
| **accept** | `span_accepted` | `span_accepted.jsonl` | ユーザーが popover 内で候補を選択し確定した（リスト内候補 rank 0〜N、または手動入力） |
| **reject** | `span_rejected` | `user_actions.jsonl` | ユーザーが popover 内で明示的に「却下」ボタンを押した（rank-1 候補を否定） |
| **skip** | `span_skipped` | `user_actions.jsonl` | ユーザーが候補を選ばず popover を閉じた（Escape / overlay クリック / close ボタン） |

**操作の性質の違い**:
- `reject` は意図的な「この候補は違う」という否定シグナル。強い学習素材。
- `skip` は「今は決めない」「誤検出かもしれない」を含む弱いシグナル。
  - `popoverOpenMs < 1000ms` のケースはミスクリックの可能性が高い（集計時は除外推奨）。

---

## 3. rank1FromExperimental フィールド

### 定義

```json
// span_accepted.jsonl の例
{
  "event": "span_accepted",
  "rank1FromExperimental": true,   // rank-1 候補が staging/ 辞書由来のとき true
  ...
}
```

| 値 | 意味 |
|---|---|
| `true` | popover の rank-1 候補が `experimental` (staging/) 辞書ティア由来 |
| `false` | rank-1 候補が `stable` (approved/) 辞書ティア由来 |
| フィールドなし / `null` | experimental 機能が OFF だった、または rank-1 が辞書外（bigram 推測等）だった |

### 注意事項

- このフィールドは **観測専用補助フィールド** であり、`is_dangerous` 条件の計算には使用されていない
- experimental 機能 OFF 時は experimental 候補がそもそも生成されないため、`rank1FromExperimental=true` のエントリは存在しない
- experimental 機能 ON でも、rank-1 が stable 辞書から来ればこのフィールドは `false` になる

---

## 4. isDangerous / dismissedDangerFlag の使い分け

| フィールド | 出現ファイル | 意味 |
|---|---|---|
| `dismissedDangerFlag` | `span_accepted.jsonl` | accept 時に `is_dangerous == true` だったスパン（危険候補を承認した） |
| `isDangerous` | `user_actions.jsonl` | reject / skip 時に `is_dangerous == true` だったスパン |

両者は概念的に同じ `is_dangerous` フラグの "accept 側" / "reject・skip 側" での別名。  
`is_dangerous` の定義: `rank1_is_proper_noun == true AND rank1_from_shape == false`（backend/models.py）

---

## 5. 集計スクリプト

```bash
cd proofreading-app
python3 evaluation/aggregate_experimental.py
```

出力セクション:

| セクション | 内容 |
|---|---|
| [A]–[C] | experimental rank1 の accept/reject/skip 件数 |
| [D]–[F] | experimental × dangerous の危険パターン件数 |
| [G] | experimental 候補の accept rate |
| [H] | ON/OFF 切替履歴と状態別件数比較 |
| [I] | suspectSpan 別の accept/reject/skip 内訳 |

---

## 6. 現在のフェーズ制約

観測フェーズとして、以下は**行わない**:

- `is_dangerous` 条件への `rank1FromExperimental` の追加
- `AUTO_DOWNWEIGHT` の発火条件変更
- 差分 UI の実装
- 辞書スコアリングの再調整

次フェーズ移行の判断は `aggregate_experimental.py` の出力を基に行う（`EXPERIMENTAL_COMPARISON_PROTOCOL.md` 参照）。
