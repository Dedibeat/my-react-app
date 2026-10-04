import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth import get_current_user
from src.db import get_conn

# A team's (or a person's) result in a past contest: a virtual run or the official one.
# Only the raw result is stored; the performance rating is computed in the browser
# from the contest's real standings, so it follows rating refreshes.
router = APIRouter(prefix="/api/participations", tags=["participations"])

KINDS = {"virtual", "official"}
COLUMNS = "id, contest_id, kind, solved, penalty, team_name, participated_on, created_at"


class ParticipationBody(BaseModel):
    contest_id: int
    kind: str
    solved: int
    penalty: int  # minutes
    team_name: str | None = None  # official: the team's row in the real standings
    participated_on: str | None = None  # YYYY-MM-DD, defaults to today


def _row(r) -> dict:
    keys = [c.strip() for c in COLUMNS.split(",")]
    return dict(zip(keys, r))


@router.get("")
def list_participations(user: dict = Depends(get_current_user)):
    cur = get_conn().cursor()
    cur.execute(
        f"SELECT {COLUMNS} FROM contest_participations WHERE user_id = ? "
        "ORDER BY participated_on DESC, id DESC",
        (user["id"],),
    )
    return [_row(r) for r in cur.fetchall()]


@router.post("")
def add_participation(body: ParticipationBody, user: dict = Depends(get_current_user)):
    if body.kind not in KINDS:
        raise HTTPException(400, "kind must be 'virtual' or 'official'")
    if not 0 <= body.solved <= 50 or not 0 <= body.penalty <= 100000:
        raise HTTPException(400, "solved/penalty out of range")
    team = (body.team_name or "").strip() or None
    if body.kind == "official" and not team:
        raise HTTPException(400, "Official results need the team's name")
    if team and len(team) > 200:
        raise HTTPException(400, "Team name too long")
    day = body.participated_on or date.today().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "participated_on must be YYYY-MM-DD")

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO contest_participations
           (user_id, contest_id, kind, solved, penalty, team_name, participated_on)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (user["id"], body.contest_id, body.kind, body.solved, body.penalty, team, day),
    )
    conn.commit()
    new_id = cur.lastrowid  # before the SELECT, which resets it on Turso
    cur.execute(f"SELECT {COLUMNS} FROM contest_participations WHERE id = ?", (new_id,))
    return _row(cur.fetchone())


@router.delete("/{participation_id}")
def delete_participation(participation_id: int, user: dict = Depends(get_current_user)):
    conn = get_conn()
    conn.execute(
        "DELETE FROM contest_participations WHERE id = ? AND user_id = ?",
        (participation_id, user["id"]),
    )
    conn.commit()
    return {"ok": True}
