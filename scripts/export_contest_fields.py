#!/usr/bin/env python3
"""Export each contest's real final standings for the Contests page's performance ratings.

Source is the data embedded in analyze_standings' generated virtual calculator
(output/virtual_calc.html, written by `arch_b.export_virtual_calc`), so the app's
numbers match that tool exactly. Writes:

  data/contest_fields/index.json    {"scale", "to_cf", "ids"}  rating scale, the
                                    internal-rating -> CF-points lookup table, and
                                    which contest ids have standings
  data/contest_fields/<id>.json     {"teams": [[name, affiliation, solved,
                                    penalty_minutes, theta, performance, rank], ...]}
                                    in final-rank order

Re-run after regenerating virtual_calc.html:

    python3 scripts/export_contest_fields.py [path/to/virtual_calc.html]
"""
import json
import os
import sys

SRC = "../analyze_standings/output/virtual_calc.html"
OUT = "data/contest_fields"


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    with open(src, encoding="utf-8") as f:
        html = f.read()
    marker = "const DATA = "
    data, _ = json.JSONDecoder().raw_decode(html, html.index(marker) + len(marker))

    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):  # drop contests that left the fit
        if name.endswith(".json"):
            os.remove(os.path.join(OUT, name))

    ids = []
    total = 0
    for c in data["contests"]:
        teams = [
            [t["name"], t["affiliation"], t["solved"], round(t["penalty"] / 60),
             round(t["theta"], 1), round(t["performance"]), t["rank"]]
            for t in c["teams"]
        ]
        path = os.path.join(OUT, f"{c['contest_id']}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"teams": teams}, f, separators=(",", ":"), ensure_ascii=False)
        total += os.path.getsize(path)
        ids.append(c["contest_id"])

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"scale": data["scale"], "to_cf": data["to_cf"], "ids": sorted(ids)},
                  f, separators=(",", ":"))
    print(f"wrote {len(ids)} contests to {OUT}/ ({total / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
