#!/usr/bin/env python3
"""
Standalone evaluation runner for proper_noun scoring.

Processes all *.md files in evaluation/datasets/ through AIAnalyzer,
then summarizes correction_events.jsonl in evaluation/logs/.

Usage:
    cd proofreading-app
    python3 evaluation/run_eval.py
"""

import sys
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import yaml as _yaml

from ai_analyzer import AIAnalyzer

DICT_DIR  = str(ROOT / "data" / "dictionaries")
EVAL_DIR  = str(ROOT / "evaluation" / "logs")
DATASETS  = ROOT / "evaluation" / "datasets"
LOG_PATH  = Path(EVAL_DIR) / "correction_events.jsonl"


def _parse_frontmatter(content: str) -> dict:
    if not content.startswith("---"):
        return {}
    end = content.find("---", 3)
    if end == -1:
        return {}
    try:
        return _yaml.safe_load(content[3:end]) or {}
    except Exception:
        return {}


def main():
    # Clear previous log for a clean run
    Path(EVAL_DIR).mkdir(parents=True, exist_ok=True)
    if LOG_PATH.exists():
        LOG_PATH.unlink()

    analyzer = AIAnalyzer(dict_dir=DICT_DIR, eval_dir=EVAL_DIR)

    test_files = sorted(DATASETS.glob("*.md"))
    if not test_files:
        print(f"No *.md files found in {DATASETS}")
        sys.exit(1)

    print(f"\n{'='*64}")
    print(f"EVAL_RUN: {len(test_files)} files  |  dict_dir={DICT_DIR}")
    print(f"{'='*64}")

    all_spans = []

    for md_file in test_files:
        content = md_file.read_text(encoding="utf-8")
        fm = _parse_frontmatter(content)

        results, clean_text, doc_type, doc_conf, doc_src, pcnt, _ = analyzer.analyze_document(
            text=content,
            frontmatter=fm,
            filename=md_file.name,
        )

        region = fm.get("region", "")
        print(f"\n[{md_file.name}]")
        print(f"  region={region!r}  doc_type={doc_type}  spans={len(results)}")

        for span in results:
            candidates = span.get("candidates", [])
            rank1 = candidates[0] if candidates else "(none)"
            suspect = span["suspect_span"]
            print(f"  {suspect!r:12} → rank1: {rank1!r:14}  all: {candidates}")
            all_spans.append({
                "file": md_file.name,
                "region": region,
                "suspect": suspect,
                "rank1": rank1,
                "candidates": candidates,
            })

    # ── Summarize correction_events.jsonl ─────────────────────────────────
    print(f"\n{'='*64}")
    print("correction_events.jsonl SUMMARY")
    print(f"{'='*64}")

    if not LOG_PATH.exists():
        print("  (no events logged — proper_noun_terms set was empty for all files)")
        _print_misfire_analysis(all_spans)
        return

    events = [json.loads(line) for line in LOG_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]

    by_region: dict[str, list] = {}
    for ev in events:
        r = ev.get("region", "(none)")
        by_region.setdefault(r, []).append(ev)

    for region, evs in sorted(by_region.items()):
        rank1_pn  = sum(1 for e in evs if e.get("rank1_is_proper_noun"))
        rank1_bad = len(evs) - rank1_pn
        mult_vals = [e.get("region_multiplier", 1.0) for e in evs]
        mult_zero = sum(1 for m in mult_vals if m == 0.0)
        print(f"\n  region={region!r}  events={len(evs)}")
        print(f"    rank1=proper_noun : {rank1_pn}")
        print(f"    rank1=other       : {rank1_bad}")
        print(f"    region_multiplier=0.0 cases: {mult_zero}")

    print(f"\n  TOTAL events: {len(events)}")
    total_pn  = sum(1 for e in events if e.get("rank1_is_proper_noun"))
    total_bad = len(events) - total_pn
    print(f"  rank1=proper_noun : {total_pn}")
    print(f"  rank1=other       : {total_bad}")

    _print_misfire_analysis(all_spans)
    _print_region_multiplier_check(events)


def _print_misfire_analysis(all_spans: list):
    print(f"\n{'='*64}")
    print("PROPER_NOUN_MISFIRE_EXAMPLES (rank1 が地名で不自然なケース)")
    print(f"{'='*64}")
    PLACE_SUFFIX = ("国", "県", "郡", "州", "道", "府")
    misfires = []
    for s in all_spans:
        rank1 = s.get("rank1", "")
        suspect = s.get("suspect", "")
        if rank1 and rank1 != suspect and any(rank1.endswith(sfx) for sfx in PLACE_SUFFIX):
            misfires.append(s)
    if not misfires:
        print("  (none detected)")
    else:
        for m in misfires:
            print(f"  [{m['file']}] {m['suspect']!r} → rank1={m['rank1']!r}  cands={m['candidates']}")


def _print_region_multiplier_check(events: list):
    print(f"\n{'='*64}")
    print("REGION_MULTIPLIER=0.0 SANITY CHECK")
    print(f"{'='*64}")
    zero_mult = [e for e in events if e.get("region_multiplier", 1.0) == 0.0]
    if not zero_mult:
        print("  (no events with region_multiplier=0.0)")
        return
    for e in zero_mult:
        rank1_is_pn = e.get("rank1_is_proper_noun", False)
        flag = "WARNING" if rank1_is_pn else "ok"
        print(f"  [{flag}] file={e['filename']} suspect={e['suspect_span']!r} "
              f"rank1={e['rank1_candidate']!r} pn_cands={e['proper_noun_candidates']}")


if __name__ == "__main__":
    main()
