#!/usr/bin/env python3
"""
Aggregate span_accepted.jsonl for rule-promotion analysis.

Usage:
    cd proofreading-app
    python3 evaluation/aggregate_span_accepted.py

Metrics:
  [1] wasBigramSuspect == true 件数
  [2] particleScript == "katakana_dominant" 限定件数
  [3] candidateRank == -1 (手動入力) 件数
  [4] suspectSpan × chosenCandidate 件数（上位20件）
  [5] chosenCandidate が candidateList 内 vs 手動入力 の比率
  [6] BIGRAM SUSPECT 絞り込み集計表
  [7] katakana_dominant 限定: suspectSpan 分布
  [8] suspectSpan == "わり" 詳細
"""

import json
import sys
from collections import Counter
from pathlib import Path

LOG_PATH = Path(__file__).parent / "logs" / "span_accepted.jsonl"


def _candidate_rank(entry: dict) -> int:
    """candidateRank を entry から取得または再計算する。
    - ログに candidateRank があればそれを使う
    - なければ candidateList.index(chosenCandidate)
    - 見つからなければ -1（手動入力）
    """
    if "candidateRank" in entry:
        return entry["candidateRank"]
    chosen = entry.get("chosenCandidate", "")
    cand_list = entry.get("candidateList") or []
    try:
        return cand_list.index(chosen)
    except ValueError:
        return -1


def _in_list(entry: dict) -> bool:
    chosen = entry.get("chosenCandidate", "")
    cand_list = entry.get("candidateList") or []
    return chosen in cand_list


def main():
    if not LOG_PATH.exists():
        print(f"[aggregate] {LOG_PATH} not found", file=sys.stderr)
        sys.exit(1)

    entries = []
    with LOG_PATH.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"[aggregate] skip malformed line: {e}", file=sys.stderr)

    # span_accepted イベントのみ対象
    entries = [e for e in entries if e.get("event") == "span_accepted"]
    total = len(entries)

    if total == 0:
        print("[aggregate] No span_accepted entries found.")
        return

    SEP = "=" * 64
    print(f"\n{SEP}")
    print(f"SPAN_ACCEPTED AGGREGATION  (total={total})")
    print(f"LOG: {LOG_PATH}")
    print(SEP)

    # ── [1] wasBigramSuspect ────────────────────────────────────────────────
    bigram_entries = [e for e in entries if e.get("wasBigramSuspect") is True]
    print(f"\n[1] wasBigramSuspect == true  : {len(bigram_entries):>4} / {total}")

    # ── [2] particleScript == katakana_dominant ─────────────────────────────
    kata_entries = [e for e in entries if e.get("particleScript") == "katakana_dominant"]
    print(f"[2] particleScript=katakana_dominant : {len(kata_entries):>4} / {total}")

    # ── [3] candidateRank == -1 (手動入力) ───────────────────────────────────
    manual_entries = [e for e in entries if _candidate_rank(e) == -1]
    print(f"[3] candidateRank == -1 (手動入力)   : {len(manual_entries):>4} / {total}")

    # ── [4] suspectSpan × chosenCandidate 件数 ──────────────────────────────
    print(f"\n{SEP}")
    print("[4] suspectSpan × chosenCandidate  (上位 20 件)")
    print(SEP)
    pair_counts = Counter(
        (e.get("suspectSpan", ""), e.get("chosenCandidate", ""))
        for e in entries
    )
    print(f"  {'suspectSpan':14} {'chosenCandidate':16} {'N':>4}  note")
    print(f"  {'-'*14} {'-'*16} {'-'*4}  {'-'*16}")
    for (suspect, chosen), count in pair_counts.most_common(20):
        # そのペアのうち少なくとも1エントリで candidateList に含まれていれば in-list
        sample = next(
            (e for e in entries
             if e.get("suspectSpan") == suspect and e.get("chosenCandidate") == chosen),
            None,
        )
        in_cand = _in_list(sample) if sample else False
        note = "" if in_cand else "[手動入力]"
        hint_src = sample.get("hintSource", "") if sample else ""
        if hint_src:
            note += f" hint={hint_src}"
        print(f"  {suspect:14} {chosen:16} {count:>4}  {note}")

    # ── [5] chosenCandidate が candidateList 内かどうか ───────────────────────
    in_list_count = sum(1 for e in entries if _in_list(e))
    manual_count = total - in_list_count
    print(f"\n[5] chosenCandidate in candidateList : {in_list_count:>4} / {total}")
    print(f"    chosenCandidate 手動入力 (リスト外): {manual_count:>4} / {total}")

    # ── [6] BIGRAM SUSPECT 集計 ─────────────────────────────────────────────
    print(f"\n{SEP}")
    print(f"[6] BIGRAM SUSPECT 集計  (wasBigramSuspect==true, n={len(bigram_entries)})")
    print(SEP)
    if bigram_entries:
        bigram_pair_counts = Counter(
            (e.get("suspectSpan", ""), e.get("chosenCandidate", ""))
            for e in bigram_entries
        )
        print(f"  {'suspectSpan':12} {'chosenCandidate':16} {'N':>4}  {'in list':>8}  hintSource")
        print(f"  {'-'*12} {'-'*16} {'-'*4}  {'-'*8}  {'-'*20}")
        for (suspect, chosen), count in bigram_pair_counts.most_common():
            sample = next(
                (e for e in bigram_entries
                 if e.get("suspectSpan") == suspect and e.get("chosenCandidate") == chosen),
                None,
            )
            in_cand = _in_list(sample) if sample else False
            hint_src = (sample.get("hintSource") or "") if sample else ""
            print(
                f"  {suspect:12} {chosen:16} {count:>4}  "
                f"{'yes':>8}  {hint_src}"
                if in_cand else
                f"  {suspect:12} {chosen:16} {count:>4}  "
                f"{'NO(手動)':>8}  {hint_src}"
            )
    else:
        print("  (no bigram entries)")

    # ── [7] katakana_dominant 限定: suspectSpan 分布 ─────────────────────────
    print(f"\n{SEP}")
    print(f"[7] katakana_dominant 限定: suspectSpan 分布  (n={len(kata_entries)})")
    print(SEP)
    if kata_entries:
        kata_suspect_counts = Counter(e.get("suspectSpan", "") for e in kata_entries)
        print(f"  {'suspectSpan':16} {'N':>4}")
        print(f"  {'-'*16} {'-'*4}")
        for suspect, count in kata_suspect_counts.most_common(20):
            print(f"  {suspect:16} {count:>4}")
    else:
        print("  (no katakana_dominant entries)")

    # ── [8] suspectSpan == "わり" 詳細 ─────────────────────────────────────
    wari_entries = [e for e in entries if e.get("suspectSpan") == "わり"]
    print(f"\n{SEP}")
    print(f"[8] suspectSpan == 'わり' 詳細  (n={len(wari_entries)})")
    print(SEP)
    if wari_entries:
        for e in wari_entries:
            rank = _candidate_rank(e)
            hint_src = e.get("hintSource", "")
            manual = " [手動入力]" if not _in_list(e) else ""
            hint_tag = f" hint={hint_src}" if hint_src else ""
            print(
                f"  chosen={e.get('chosenCandidate'):8} "
                f"cands={e.get('candidateList')} "
                f"bigram={e.get('wasBigramSuspect')} "
                f"rank={rank}"
                f"{manual}{hint_tag}"
            )
    else:
        print("  (no entries for 'わり')")

    print(f"\n{SEP}\n")


if __name__ == "__main__":
    main()
