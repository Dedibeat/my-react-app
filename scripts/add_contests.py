#!/usr/bin/env python3
"""Copy contests from ../analyze_standings/data/tagged.json into canonical/tagged.json.

Use after a contest was added to the analyzer (its scripts/add_qoj_contest.py)
and the fit was rerun. Copies the contest fields and its problems, without the
standings. Tags and importance stay empty until the LLM pipeline runs on them,
which the app renders as blank. Ids already in canonical/tagged.json are skipped.

    python3 scripts/add_contests.py 4071 4113
    python3 scripts/slim_tagged.py   # regenerate data/tagged.json afterwards

Then copy ../analyze_standings/output/problem_ratings_calibrated.json to
data/problem_rating.json and re-run scripts/export_contest_fields.py (DETAILS.md).
"""
import json
import sys

SRC = "../analyze_standings/data/tagged.json"
DST = "canonical/tagged.json"


def main():
    ids = {int(a) for a in sys.argv[1:]}
    with open(DST, encoding="utf-8") as f:
        canonical = json.load(f)
    with open(SRC, encoding="utf-8") as f:
        source = {c["contest_id"]: c for c in json.load(f)}
    missing = ids - source.keys()
    if missing:
        raise SystemExit(f"not in {SRC}: {sorted(missing)}")
    present = {c["contest_id"] for c in canonical}
    for cid in sorted(ids - present):
        canonical.append({k: v for k, v in source[cid].items() if k != "standings"})
        print(f"added {cid} {source[cid]['contest_name']} {source[cid]['year']}")
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(canonical, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
