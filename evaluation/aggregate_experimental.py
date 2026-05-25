#!/usr/bin/env python3
"""
Experimental dictionary observation — log aggregation script.
EXPERIMENTAL_LOG_AGGREGATION_PLAN 実装体。

Usage:
    cd proofreading-app
    python3 evaluation/aggregate_experimental.py

出力指標:
  [A] rank1FromExperimental=true の accept 件数
  [B] rank1FromExperimental=true の reject 件数
  [C] rank1FromExperimental=true の skip 件数
  [D] [A] のうち dismissedDangerFlag=true（dangerous かつ accept）の件数
  [E] [B] のうち isDangerous=true の件数
  [F] [C] のうち isDangerous=true の件数
  [G] experimental 候補の accept rate（A ÷ A+B+C）
  [H] experimental ON/OFF 切替前後の件数比較（dictionary_setting_changed 経由）
  [I] experimental 候補の suspectSpan 分布（accept/reject/skip 内訳）
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

LOG_DIR = Path(__file__).parent / "logs"
SA_PATH = LOG_DIR / "span_accepted.jsonl"   # span_accepted イベント
UA_PATH = LOG_DIR / "user_actions.jsonl"    # span_rejected / span_skipped イベント
LC_PATH = LOG_DIR / "learning_candidates.jsonl"  # dictionary_setting_changed 等


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    entries = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"[aggregate] skip malformed line in {path.name}: {e}", file=sys.stderr)
    return entries


def _pct(n: int, total: int) -> str:
    return f"{n / total * 100:.1f}%" if total else "—"


def main() -> None:
    sa_entries = load_jsonl(SA_PATH)
    ua_entries = load_jsonl(UA_PATH)
    lc_entries = load_jsonl(LC_PATH)

    # ── イベント種別でフィルタ ──────────────────────────────────────────────
    # NOTE: user_actions.jsonl には manual_selection_corrected イベントも記録されるが、
    #       このスクリプトの A〜I 指標はすべて span 単位の実験的辞書評価であり、
    #       manual_selection_corrected（テキスト選択手動補正）は対象外とする。
    #       以下のフィルタで event 名を明示することで自然に除外される。
    accepted = [e for e in sa_entries if e.get("event") == "span_accepted"]
    rejected = [e for e in ua_entries if e.get("event") == "span_rejected"]
    skipped  = [e for e in ua_entries if e.get("event") == "span_skipped"]

    # experimental rank1 サブセット
    exp_acc = [e for e in accepted if e.get("rank1FromExperimental") is True]
    exp_rej = [e for e in rejected if e.get("rank1FromExperimental") is True]
    exp_skp = [e for e in skipped  if e.get("rank1FromExperimental") is True]

    # dangerous × experimental
    exp_acc_danger = [e for e in exp_acc if e.get("dismissedDangerFlag") is True]
    exp_rej_danger = [e for e in exp_rej if e.get("isDangerous") is True]
    exp_skp_danger = [e for e in exp_skp if e.get("isDangerous") is True]

    SEP = "=" * 68
    print(f"\n{SEP}")
    print("EXPERIMENTAL DICT OBSERVATION  (aggregate_experimental.py)")
    print(SEP)
    print(f"  span_accepted.jsonl : {len(accepted)} accept 件")
    print(f"  user_actions.jsonl  : {len(rejected)} reject + {len(skipped)} skip 件")
    print()

    # ── [A]〜[G] 指標テーブル ──────────────────────────────────────────────
    hdr = f"  {'指標':<44} {'実験':>6} {'全体':>6}  {'割合':>7}"
    print(hdr)
    print(f"  {'-'*44} {'-'*6} {'-'*6}  {'-'*7}")

    def row(tag: str, label: str, n_exp: int, n_all: int) -> None:
        print(f"  [{tag}] {label:<42} {n_exp:>6} {n_all:>6}  {_pct(n_exp, n_all):>7}")

    row("A", "rank1FromExperimental=true  accept",     len(exp_acc),        len(accepted))
    row("B", "rank1FromExperimental=true  reject",     len(exp_rej),        len(rejected))
    row("C", "rank1FromExperimental=true  skip",       len(exp_skp),        len(skipped))
    print()
    row("D", "[A] のうち dismissedDangerFlag=true",    len(exp_acc_danger), len(exp_acc))
    row("E", "[B] のうち isDangerous=true",            len(exp_rej_danger), len(exp_rej))
    row("F", "[C] のうち isDangerous=true",            len(exp_skp_danger), len(exp_skp))

    exp_total = len(exp_acc) + len(exp_rej) + len(exp_skp)
    print()
    print(f"  [G] experimental 候補 accept rate (A÷(A+B+C)={exp_total})"
          f"  {_pct(len(exp_acc), exp_total):>7}")

    # ── [H] ON/OFF 切替比較 ────────────────────────────────────────────────
    setting_changes = [
        e for e in lc_entries
        if e.get("event") == "dictionary_setting_changed"
    ]

    print(f"\n{SEP}")
    print(f"[H] experimental ON/OFF 切替履歴  ({len(setting_changes)} 件)")
    print(SEP)

    if not setting_changes:
        print("  (dictionary_setting_changed イベントなし — 切替比較不可)")
        print("  ヒント: 設定パネルで experimental を ON/OFF するとここに記録されます")
    else:
        sorted_changes = sorted(setting_changes, key=lambda e: e.get("ts", ""))
        for c in sorted_changes:
            ts  = (c.get("ts") or "?")[:19]
            old = c.get("old_value", "?")
            new = c.get("new_value", "?")
            res = c.get("reload_result", "?")
            print(f"  {ts}  {str(old):>5} → {str(new):<5}  reload={res}")

        # タイムラインから各イベントの experimental 状態を推定
        timeline = sorted(
            [
                (c.get("ts", ""), bool(c.get("new_value")))
                for c in sorted_changes
            ],
            key=lambda x: x[0],
        )

        def infer_state(event_ts: str) -> str:
            """タイムラインから event_ts 時点の experimental 設定状態を返す。"""
            state = None
            for change_ts, new_val in timeline:
                if change_ts <= event_ts:
                    state = new_val
                else:
                    break
            if state is None:
                return "unknown"
            return "ON" if state else "OFF"

        # 全イベントを状態別にカウント
        counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        all_events = (
            [(e, "accept") for e in accepted if "ts" in e]
            + [(e, "reject") for e in rejected if "ts" in e]
            + [(e, "skip")   for e in skipped  if "ts" in e]
        )
        for e, action in all_events:
            key = infer_state(e["ts"])
            counts[key][action] += 1

        # experimental フラグの状態別内訳
        exp_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for e in exp_acc:
            if "ts" in e:
                exp_counts[infer_state(e["ts"])]["accept"] += 1
        for e in exp_rej:
            if "ts" in e:
                exp_counts[infer_state(e["ts"])]["reject"] += 1
        for e in exp_skp:
            if "ts" in e:
                exp_counts[infer_state(e["ts"])]["skip"] += 1

        print(f"\n  ── 全スパン（設定状態別） ──")
        print(f"  {'状態':8} {'accept':>8} {'reject':>8} {'skip':>8}  {'accept率':>9}")
        print(f"  {'-'*8} {'-'*8} {'-'*8} {'-'*8}  {'-'*9}")
        for state_key in ("ON", "OFF", "unknown"):
            c = counts[state_key]
            a, r, s = c["accept"], c["reject"], c["skip"]
            t = a + r + s
            print(f"  {state_key:8} {a:>8} {r:>8} {s:>8}  {_pct(a, t):>9}")

        print(f"\n  ── experimental 候補のみ（設定状態別） ──")
        print(f"  {'状態':8} {'accept':>8} {'reject':>8} {'skip':>8}  {'accept率':>9}")
        print(f"  {'-'*8} {'-'*8} {'-'*8} {'-'*8}  {'-'*9}")
        for state_key in ("ON", "OFF", "unknown"):
            c = exp_counts[state_key]
            a, r, s = c["accept"], c["reject"], c["skip"]
            t = a + r + s
            print(f"  {state_key:8} {a:>8} {r:>8} {s:>8}  {_pct(a, t):>9}")

    # ── [I] suspectSpan 分布（experimental 候補のみ）─────────────────────
    all_exp_pairs = (
        [(e.get("suspectSpan", ""), "accept") for e in exp_acc]
        + [(e.get("suspectSpan", ""), "reject") for e in exp_rej]
        + [(e.get("suspectSpan", ""), "skip")   for e in exp_skp]
    )

    print(f"\n{SEP}")
    print(f"[I] experimental 候補 suspectSpan 分布  (total={len(all_exp_pairs)})")
    print(SEP)
    if not all_exp_pairs:
        print("  (experimental 候補のログなし)")
        print("  ヒント: 実験的辞書 ON で校正操作を行い flush するとここに表示されます")
    else:
        span_counts = Counter(span for span, _ in all_exp_pairs)
        print(f"  {'suspectSpan':18} {'total':>6} {'accept':>8} {'reject':>8} {'skip':>8}  {'accept率':>9}")
        print(f"  {'-'*18} {'-'*6} {'-'*8} {'-'*8} {'-'*8}  {'-'*9}")
        for span, total in span_counts.most_common(20):
            a  = sum(1 for s, t in all_exp_pairs if s == span and t == "accept")
            r  = sum(1 for s, t in all_exp_pairs if s == span and t == "reject")
            sk = sum(1 for s, t in all_exp_pairs if s == span and t == "skip")
            print(f"  {span:18} {total:>6} {a:>8} {r:>8} {sk:>8}  {_pct(a, total):>9}")

    print(f"\n{SEP}\n")


if __name__ == "__main__":
    main()
