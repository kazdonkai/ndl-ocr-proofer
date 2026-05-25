# ON_OFF_COMPARISON_PROTOCOL — Experimental Dictionary Observation

作成: 2026-05-23  
対象フェーズ: EXPERIMENTAL_LOG_AGGREGATION（観測フェーズ）

---

## 目的

`use_experimental` 設定を ON / OFF に切り替えたとき、dangerous / non-dangerous スパンの挙動がどの程度変わるかを確認する。  
**差分 UI は未実装**。本プロトコルは CLI と集計スクリプトによる手動比較手順のみを定義する。

---

## 前提条件

- `flushToBackend()` が動作していること（設定サイドバー「ログをフラッシュ」ボタン）
- `evaluation/logs/span_accepted.jsonl` と `evaluation/logs/user_actions.jsonl` が更新されていること
- `aggregate_experimental.py` が実行可能であること

---

## 比較手順

### Step 1: ベースライン採取（experimental = OFF）

```bash
# 1. 設定サイドバーで「実験的辞書を使用」= OFF に設定
# 2. 対象文書を 5〜10 件程度解析・校正操作を行う
# 3. 設定サイドバーで「ログをフラッシュ」を実行
# 4. スナップショット保存
python3 evaluation/aggregate_experimental.py | tee evaluation/snapshots/baseline_off_$(date +%Y%m%d).txt
```

### Step 2: experimental ON での採取

```bash
# 1. 設定サイドバーで「実験的辞書を使用」= ON に設定
# 2. 同一または類似文書を同程度 解析・校正操作を行う
# 3. フラッシュ後にスナップショット保存
python3 evaluation/aggregate_experimental.py | tee evaluation/snapshots/baseline_on_$(date +%Y%m%d).txt
```

### Step 3: 差分確認

```bash
diff evaluation/snapshots/baseline_off_YYYYMMDD.txt \
     evaluation/snapshots/baseline_on_YYYYMMDD.txt
```

または `aggregate_experimental.py` の `[H]` セクション出力を参照する。  
`dictionary_setting_changed` イベントが記録されていれば、ON/OFF 状態が自動分類される。

---

## 注目すべき差分指標

| 指標 | 解釈 |
|---|---|
| accept 率 ON > OFF | experimental 候補が有用（採用されやすい） |
| accept 率 ON ≈ OFF | experimental 候補は全体の挙動に影響なし（rank-1 は stable が勝っている） |
| accept 率 ON < OFF | experimental 候補が邪魔（スコアペナルティ検討） |
| dangerous 件数 ON > OFF | experimental 候補が dangerous フラグと重なっている（将来の条件追加を要検討） |
| reject / skip 率 ON > OFF | experimental 候補がノイズになっている可能性 |

---

## 次フェーズ移行の判断基準

以下のいずれかが観測されたとき、次フェーズを検討する:

| 条件 | 検討すべき対応 |
|---|---|
| experimental accept 率 < 40%（安定採用率と比較） | スコアペナルティの強化 or 辞書エントリの見直し |
| experimental + `isDangerous = true` の件数が全 experimental accept の 20% 超 | `is_dangerous` 条件への experimental 追加を検討 |
| 同一 suspectSpan への experimental 候補 reject が 5 件以上 | 該当エントリの辞書ランク見直し |
| 差分 UI が明らかに必要と感じる場面が生じた | 差分 UI 設計フェーズ着手 |

**それまでは観測を継続する。以下の変更は行わない**:
- `is_dangerous` 条件への `rank1FromExperimental` の追加
- `AUTO_DOWNWEIGHT` の発火条件変更
- 差分 UI の実装

---

## スナップショット保管場所

```
proofreading-app/evaluation/snapshots/
  baseline_off_YYYYMMDD.txt
  baseline_on_YYYYMMDD.txt
  ...
```

`snapshots/` ディレクトリが存在しない場合は作成してから実行すること:

```bash
mkdir -p proofreading-app/evaluation/snapshots
```
