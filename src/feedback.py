from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth import get_current_user
from src.db import get_conn

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

ALLOWED_CATEGORIES = {"wrong-tags", "wrong-importance", "broken-link", "great-problem", "other"}
MAX_COMMENT_LEN = 500


class FeedbackBody(BaseModel):
    category: str
    comment: str = ""


@router.get("")
def list_feedback(user: dict = Depends(get_current_user)):
    cur = get_conn().cursor()
    cur.execute(
        "SELECT problem_id, category, comment FROM problem_feedback WHERE user_id = ?",
        (user["id"],),
    )
    return {str(pid): {"category": cat, "comment": com} for pid, cat, com in cur.fetchall()}


@router.put("/{problem_id}")
def upsert_feedback(
    problem_id: int,
    body: FeedbackBody,
    user: dict = Depends(get_current_user),
):
    if body.category not in ALLOWED_CATEGORIES:
        raise HTTPException(400, f"Invalid category: {body.category!r}")
    if len(body.comment) > MAX_COMMENT_LEN:
        raise HTTPException(400, f"Comment too long (max {MAX_COMMENT_LEN} chars)")
    conn = get_conn()
    conn.execute(
        """INSERT INTO problem_feedback (user_id, problem_id, category, comment)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, problem_id) DO UPDATE SET
             category = excluded.category,
             comment = excluded.comment,
             updated_at = CURRENT_TIMESTAMP""",
        (user["id"], problem_id, body.category, body.comment),
    )
    conn.commit()
    return {"ok": True}


@router.delete("/{problem_id}")
def delete_feedback(
    problem_id: int,
    user: dict = Depends(get_current_user),
):
    conn = get_conn()
    conn.execute(
        "DELETE FROM problem_feedback WHERE user_id = ? AND problem_id = ?",
        (user["id"], problem_id),
    )
    conn.commit()
    return {"ok": True}
