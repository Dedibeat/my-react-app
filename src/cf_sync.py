import json
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth import get_current_user
from src.db import get_conn

router = APIRouter(prefix="/api/cf-sync", tags=["cf-sync"])

# CF verdict -> app status. Anything non-OK that isn't a clean TL/RE is lumped as WA.
VERDICT_MAP = {
    "OK": "AC",
    "WRONG_ANSWER": "WA",
    "TIME_LIMIT_EXCEEDED": "TL",
    "RUNTIME_ERROR": "RE",
}
SKIP_VERDICTS = {None, "TESTING", "SKIPPED"}


class SyncBody(BaseModel):
    handle: str


def _index_int(index: str) -> int:
    # Must match scripts/pull_codeforces.py so ids line up with data/codeforces.json.
    letters = "".join(c for c in index if c.isalpha())
    digits = "".join(c for c in index if c.isdigit())
    lv = 0
    for c in letters.upper():
        lv = lv * 26 + (ord(c) - 64)
    return lv * 100 + (int(digits) if digits else 0)


def _fetch_submissions(handle: str) -> list:
    url = "https://codeforces.com/api/user.status?" + urllib.parse.urlencode({"handle": handle})
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 400:
            raise HTTPException(400, "Codeforces: handle not found")
        raise HTTPException(502, "Codeforces API error")
    except Exception:
        raise HTTPException(502, "Could not reach Codeforces")
    if data.get("status") != "OK":
        raise HTTPException(400, f"Codeforces: {data.get('comment', 'error')}")
    return data["result"]


def _chunked(seq, n=200):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


@router.post("")
def cf_sync(body: SyncBody, user: dict = Depends(get_current_user)):
    handle = body.handle.strip()
    if not handle:
        raise HTTPException(400, "Handle required")

    best = {}  # problem_id -> "AC" | "WA" | "TL" | "RE"; AC always wins.
    for s in _fetch_submissions(handle):
        prob = s.get("problem", {})
        cid, idx = prob.get("contestId"), prob.get("index")
        if cid is None or not idx:
            continue
        verdict = s.get("verdict")
        if verdict in SKIP_VERDICTS:
            continue
        pid = cid * 100000 + _index_int(idx)
        if verdict == "OK":
            best[pid] = "AC"
        elif pid not in best:  # submissions arrive newest-first, so this keeps the latest
            best[pid] = VERDICT_MAP.get(verdict, "WA")

    ac = [pid for pid, st in best.items() if st == "AC"]
    failed = [(pid, st) for pid, st in best.items() if st != "AC"]

    conn = get_conn()
    uid = user["id"]
    # AC always wins (overrides any existing status, including NI).
    for chunk in _chunked(ac):
        values = ",".join(["(?, ?, 'AC')"] * len(chunk))
        args = [x for pid in chunk for x in (uid, pid)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status='AC', updated_at=CURRENT_TIMESTAMP""",
            args,
        )
    # Failed verdicts do NOT override an existing AC or NI.
    for chunk in _chunked(failed):
        values = ",".join(["(?, ?, ?)"] * len(chunk))
        args = [x for pid, st in chunk for x in (uid, pid, st)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status=excluded.status, updated_at=CURRENT_TIMESTAMP
                WHERE problem_status.status NOT IN ('AC', 'NI')""",
            args,
        )
    conn.commit()

    return {"solved": len(ac), "attempted": len(failed)}
