#!/usr/bin/env python3
"""Slim the canonical ICPC dataset down to exactly what the UI reads.

The canonical file (canonical/tagged.json) keeps the full LLM-generated
fields (statement, analysis_notes, shortest_solution, tagging provenance, ...)
for future use; this script produces the served data/tagged.json with only:

  contest: contest_id, contest_name, year, region, editorial_url, contest_url, source
  problem: problem_id, problem_label, problem_name, problem_url,
           primary_tags, secondary_tags, extra_tags,
           importance, importance_confidence, olympiad_techniques

Re-run after updating canonical/tagged.json:

    python3 scripts/slim_tagged.py

Input/output default to canonical/tagged.json -> data/tagged.json (pass args
to override).
"""
import json
import sys

CONTEST_KEEP = ("contest_id", "contest_name", "year", "region", "editorial_url", "contest_url")
PROBLEM_KEEP = (
    "problem_id",
    "problem_name",
    "problem_url",
    "primary_tags",
    "secondary_tags",
    "extra_tags",
    "importance",
    "importance_confidence",
    "olympiad_techniques",
)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "canonical/tagged.json"
    dst = sys.argv[2] if len(sys.argv) > 2 else "data/tagged.json"

    with open(src, encoding="utf-8") as f:
        data = json.load(f)

    slim = []
    for contest in data:
        out_contest = {k: contest.get(k) for k in CONTEST_KEEP}
        if contest.get("source"):
            out_contest["source"] = contest["source"]
        out_contest["problems"] = []
        for p in contest.get("problems", []):
            out_problem = {k: p.get(k) for k in PROBLEM_KEEP}
            if contest.get("source") == "xcpcio" and p.get("problem_label"):
                out_problem["problem_label"] = p["problem_label"]
            out_contest["problems"].append(out_problem)
        slim.append(out_contest)

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(slim, f, indent=2, ensure_ascii=False)
    print(f"wrote {dst}: {len(slim)} contests, "
          f"{sum(len(c['problems']) for c in slim)} problems, "
          f"{__import__('os').path.getsize(dst) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
