from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth import get_current_user
from src.db import get_conn

router = APIRouter(prefix="/api/status", tags=["status"])

ALLOWED_STATUSES = {"AC", "WA", "TL", "RE", "NI", "No submission", ""}


class StatusBody(BaseModel):
    status: str


@router.get("")
def list_status(user: dict = Depends(get_current_user)):
    cur = get_conn().cursor()
    cur.execute(
        "SELECT problem_id, status, updated_at FROM problem_status WHERE user_id = ?",
        (user["id"],),
    )
    return {
        str(pid): {"status": status, "updated_at": ts}
        for pid, status, ts in cur.fetchall()
    }


@router.put("/{problem_id}")
def upsert_status(
    problem_id: int,
    body: StatusBody,
    user: dict = Depends(get_current_user),
):
    if body.status not in ALLOWED_STATUSES:
        raise HTTPException(400, f"Invalid status: {body.status!r}")
    conn = get_conn()
    conn.execute(
        """INSERT INTO problem_status (user_id, problem_id, status)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, problem_id) DO UPDATE SET
             status = excluded.status,
             updated_at = CURRENT_TIMESTAMP""",
        (user["id"], problem_id, body.status),
    )
    conn.commit()
    return {"ok": True}


@router.delete("/{problem_id}")
def clear_status(
    problem_id: int,
    user: dict = Depends(get_current_user),
):
    conn = get_conn()
    conn.execute(
        "DELETE FROM problem_status WHERE user_id = ? AND problem_id = ?",
        (user["id"], problem_id),
    )
    conn.commit()
    return {"ok": True}
