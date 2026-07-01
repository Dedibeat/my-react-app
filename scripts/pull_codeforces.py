#!/usr/bin/env python3
"""Pull rated Codeforces problems into data/codeforces.json.

Re-run any time to sync with Codeforces — it fetches the live problemset API
(https://codeforces.com/api/problemset.problems) each run and regenerates the
file from scratch, so the app tracks the current CF problemset.

Each problem gets a stable integer id = contestId * 100000 + index_int(index).
index_int packs the letter+digit index (A -> 100, C2 -> 302, D10 -> 410) into
a value < 100000, so the map is injective (contestId and index are recoverable)
and every id lands far above the ICPC id range (~6k-15k). That lets CF and ICPC
share the backend's integer problem_id key with zero collisions and no backend
change.

    python3 scripts/pull_codeforces.py
"""
import json
import os
import urllib.request

API_URL = "https://codeforces.com/api/problemset.problems"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "codeforces.json")


def index_int(index):
    letters = "".join(c for c in index if c.isalpha())
    digits = "".join(c for c in index if c.isdigit())
    lv = 0
    for c in letters.upper():
        lv = lv * 26 + (ord(c) - 64)
    return lv * 100 + (int(digits) if digits else 0)


def main():
    with urllib.request.urlopen(API_URL, timeout=60) as resp:
        data = json.loads(resp.read())
    if data.get("status") != "OK":
        raise SystemExit(f"CF API error: {data.get('comment')}")

    out = []
    for p in data["result"]["problems"]:
        rating = p.get("rating")
        if rating is None:
            continue  # rated problems only
        cid, idx = p["contestId"], p["index"]
        out.append({
            "id": cid * 100000 + index_int(idx),
            "code": f"{cid}{idx}",
            "name": p["name"],
            "rating": rating,
            "tags": p.get("tags", []),
            "url": f"https://codeforces.com/problemset/problem/{cid}/{idx}",
        })

    out.sort(key=lambda x: (-x["rating"], x["id"]))
    path = os.path.abspath(OUT_PATH)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(out)} rated problems to {path}")


if __name__ == "__main__":
    main()
