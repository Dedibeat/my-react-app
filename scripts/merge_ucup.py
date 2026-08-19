#!/usr/bin/env python3
"""Merge Universal Cup contests (not already in tagged.json) into this app.

UCup rounds (ucup_s3.json/ucup_s4.json in ../analyze_standings) are rated by
a separate Phase-1 fit and were never part of tagged.json, so they're absent
from both canonical/tagged.json (browsable list) and data/problem_rating.json
(ratings). ../analyze_standings/arch_b/export_ucup_only.py computes and
writes the two source files this script merges in. No LLM tags/analysis
fields are added -- that pipeline never ran on these problems, and the app
already renders missing tags/importance as blank.

Idempotent (skips contest/problem ids already present), so safe to re-run
after analyze_standings' UCup fit is refreshed.

    python3 scripts/merge_ucup.py
    python3 scripts/slim_tagged.py   # regenerate data/tagged.json afterwards

Note: data/problem_rating.json is otherwise refreshed by copying
../analyze_standings/output/problem_ratings_calibrated.json wholesale (see
DETAILS.md) -- that file does not include UCup-only problems, so re-run this
script after any such refresh too, or the merged-in UCup ratings are lost.
"""
import json

SRC_CONTESTS = "../analyze_standings/output/ucup_only_contests.json"
SRC_RATINGS = "../analyze_standings/output/ucup_only_ratings.json"


def merge_contests():
    with open("canonical/tagged.json", encoding="utf-8") as f:
        canonical = json.load(f)
    existing_ids = {c["contest_id"] for c in canonical}
    with open(SRC_CONTESTS, encoding="utf-8") as f:
        new = [c for c in json.load(f) if c["contest_id"] not in existing_ids]
    canonical.extend(new)
    with open("canonical/tagged.json", "w", encoding="utf-8") as f:
        json.dump(canonical, f, indent=2, ensure_ascii=False)
    return len(new)


def merge_ratings():
    with open("data/problem_rating.json", encoding="utf-8") as f:
        ratings = json.load(f)
    existing_ids = {r["problem_id"] for r in ratings}
    with open(SRC_RATINGS, encoding="utf-8") as f:
        new = [r for r in json.load(f) if r["problem_id"] not in existing_ids]
    ratings.extend(new)
    with open("data/problem_rating.json", "w", encoding="utf-8") as f:
        json.dump(ratings, f, indent=2, ensure_ascii=False)
    return len(new)


def main():
    n_contests = merge_contests()
    n_ratings = merge_ratings()
    print(f"added {n_contests} contests to canonical/tagged.json, "
          f"{n_ratings} ratings to data/problem_rating.json")


if __name__ == "__main__":
    main()
