import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth import get_current_user
from src.db import get_conn

router = APIRouter(prefix="/api/lists", tags=["lists"])
shared_router = APIRouter(prefix="/api/shared", tags=["shared"])

MAX_NAME_LEN = 100
MAX_ITEMS = 5000
BATCH = 200  # rows per INSERT statement (matches cf_sync.py's chunking)


class ListBody(BaseModel):
    name: str


class ItemsBody(BaseModel):
    problem_ids: list[int]


def _owned_list(conn, list_id: int, user_id: int) -> dict:
    cur = conn.cursor()
    cur.execute(
        "SELECT id, name, created_at, share_token FROM problem_lists WHERE id = ? AND user_id = ?",
        (list_id, user_id),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "List not found")
    return {"id": row[0], "name": row[1], "created_at": row[2], "share_token": row[3]}


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _summaries(cur, user_id: int, list_id: int | None = None) -> list[dict]:
    """Lists with problem + solved-AC counts (solved only counts the owner's statuses)."""
    sql = """SELECT l.id, l.name, l.created_at, l.share_token,
                COUNT(pli.problem_id) AS problem_count,
                SUM(CASE WHEN ps.status = 'AC' THEN 1 ELSE 0 END) AS solved_count
             FROM problem_lists l
             LEFT JOIN problem_list_items pli ON pli.list_id = l.id
             LEFT JOIN problem_status ps
               ON ps.user_id = l.user_id AND ps.problem_id = pli.problem_id
             WHERE l.user_id = ?
             """
    params: list = [user_id]
    if list_id is not None:
        sql += " AND l.id = ?"
        params.append(list_id)
    sql += " GROUP BY l.id ORDER BY l.created_at DESC, l.id DESC"
    cur.execute(sql, tuple(params))
    return [
        {
            "id": rid,
            "name": name,
            "created_at": created_at,
            "problem_count": pcount or 0,
            "solved_count": scount or 0,
            "share_token": token,
        }
        for rid, name, created_at, token, pcount, scount in cur.fetchall()
    ]


def _check_name(name: str) -> str:
    name = name.strip()
    if not name or len(name) > MAX_NAME_LEN:
        raise HTTPException(400, f"Name must be 1-{MAX_NAME_LEN} chars")
    return name


def _check_items(ids: list[int]) -> list[int]:
    if not ids:
        raise HTTPException(400, "No problems given")
    if len(ids) > MAX_ITEMS:
        raise HTTPException(400, f"Too many problems (max {MAX_ITEMS})")
    # De-duplicate within the request.
    return list(dict.fromkeys(ids))


@router.get("")
def list_lists(user: dict = Depends(get_current_user)):
    return _summaries(get_conn().cursor(), user["id"])


@router.post("")
def create_list(body: ListBody, user: dict = Depends(get_current_user)):
    name = _check_name(body.name)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM problem_lists WHERE user_id = ? AND name = ?", (user["id"], name)
    )
    if cur.fetchone():
        raise HTTPException(409, "You already have a list with that name")
    cur.execute("INSERT INTO problem_lists (user_id, name) VALUES (?, ?)", (user["id"], name))
    conn.commit()
    # Read the id before the SELECT: on Turso the SELECT resets the cursor's lastrowid.
    list_id = cur.lastrowid
    cur.execute("SELECT created_at FROM problem_lists WHERE id = ?", (list_id,))
    created_at = cur.fetchone()[0]
    return {"id": list_id, "name": name, "created_at": created_at,
            "problem_count": 0, "solved_count": 0, "share_token": None}


@router.patch("/{list_id}")
def rename_list(list_id: int, body: ListBody, user: dict = Depends(get_current_user)):
    name = _check_name(body.name)
    conn = get_conn()
    _owned_list(conn, list_id, user["id"])
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM problem_lists WHERE user_id = ? AND name = ? AND id != ?",
        (user["id"], name, list_id),
    )
    if cur.fetchone():
        raise HTTPException(409, "You already have a list with that name")
    cur.execute("UPDATE problem_lists SET name = ? WHERE id = ?", (name, list_id))
    conn.commit()
    return {"ok": True}


@router.delete("/{list_id}")
def delete_list(list_id: int, user: dict = Depends(get_current_user)):
    conn = get_conn()
    _owned_list(conn, list_id, user["id"])
    conn.execute("DELETE FROM problem_list_members WHERE list_id = ?", (list_id,))
    conn.execute("DELETE FROM problem_lists WHERE id = ?", (list_id,))
    conn.commit()
    return {"ok": True}


@router.get("/{list_id}")
def get_list(list_id: int, user: dict = Depends(get_current_user)):
    conn = get_conn()
    meta = _owned_list(conn, list_id, user["id"])
    cur = conn.cursor()
    cur.execute(
        "SELECT problem_id FROM problem_list_items WHERE list_id = ? ORDER BY added_at",
        (list_id,),
    )
    problem_ids = [r[0] for r in cur.fetchall()]
    return {**meta, "problem_ids": problem_ids}


@router.post("/{list_id}/items")
def add_items(list_id: int, body: ItemsBody, user: dict = Depends(get_current_user)):
    ids = _check_items(body.problem_ids)
    conn = get_conn()
    _owned_list(conn, list_id, user["id"])
    cur = conn.cursor()

    # Which of these are already in the list?
    existing = set()
    for chunk in _chunks(ids, 500):
        ph = ",".join("?" for _ in chunk)
        cur.execute(
            f"SELECT problem_id FROM problem_list_items WHERE list_id = ? AND problem_id IN ({ph})",
            (list_id, *chunk),
        )
        existing.update(r[0] for r in cur.fetchall())

    new_ids = [i for i in ids if i not in existing]
    for chunk in _chunks(new_ids, BATCH):
        ph = ",".join("(?, ?)" for _ in chunk)
        params = []
        for pid in chunk:
            params.extend([list_id, pid])
        cur.execute(
            f"INSERT INTO problem_list_items (list_id, problem_id) VALUES {ph}",
            tuple(params),
        )
    conn.commit()
    return {"added": len(new_ids), "existing": len(ids) - len(new_ids)}


@router.delete("/{list_id}/items")
def remove_items(list_id: int, body: ItemsBody, user: dict = Depends(get_current_user)):
    ids = _check_items(body.problem_ids)
    conn = get_conn()
    _owned_list(conn, list_id, user["id"])
    cur = conn.cursor()
    for chunk in _chunks(ids, 500):
        ph = ",".join("?" for _ in chunk)
        cur.execute(
            f"DELETE FROM problem_list_items WHERE list_id = ? AND problem_id IN ({ph})",
            (list_id, *chunk),
        )
    conn.commit()
    return {"ok": True}


# ---------- sharing: a secret link any logged-in user can open and join ----------

@router.post("/{list_id}/share")
def share_list(list_id: int, user: dict = Depends(get_current_user)):
    conn = get_conn()
    meta = _owned_list(conn, list_id, user["id"])
    if meta["share_token"]:
        return {"share_token": meta["share_token"]}
    token = secrets.token_urlsafe(12)
    conn.execute("UPDATE problem_lists SET share_token = ? WHERE id = ?", (token, list_id))
    conn.commit()
    return {"share_token": token}


@router.delete("/{list_id}/share")
def unshare_list(list_id: int, user: dict = Depends(get_current_user)):
    """Kills the link and drops every member; sharing again makes a new link."""
    conn = get_conn()
    _owned_list(conn, list_id, user["id"])
    conn.execute("UPDATE problem_lists SET share_token = NULL WHERE id = ?", (list_id,))
    conn.execute("DELETE FROM problem_list_members WHERE list_id = ?", (list_id,))
    conn.commit()
    return {"ok": True}


def _shared_list(cur, token: str) -> dict:
    cur.execute(
        """SELECT l.id, l.name, l.user_id, u.username FROM problem_lists l
           JOIN users u ON u.id = l.user_id WHERE l.share_token = ?""",
        (token,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Shared list not found (the link may have been turned off)")
    return {"id": row[0], "name": row[1], "owner_id": row[2], "owner": row[3]}


@shared_router.get("")
def joined_lists(user: dict = Depends(get_current_user)):
    """Shared lists the user has joined (their own lists are in /api/lists)."""
    cur = get_conn().cursor()
    cur.execute(
        """SELECT l.share_token, l.name, u.username,
                  COUNT(pli.problem_id),
                  SUM(CASE WHEN ps.status = 'AC' THEN 1 ELSE 0 END)
           FROM problem_list_members m
           JOIN problem_lists l ON l.id = m.list_id AND l.share_token IS NOT NULL
           JOIN users u ON u.id = l.user_id
           LEFT JOIN problem_list_items pli ON pli.list_id = l.id
           LEFT JOIN problem_status ps ON ps.user_id = m.user_id AND ps.problem_id = pli.problem_id
           WHERE m.user_id = ?
           GROUP BY l.id ORDER BY m.joined_at DESC""",
        (user["id"],),
    )
    return [
        {"share_token": token, "name": name, "owner": owner,
         "problem_count": pcount or 0, "solved_count": scount or 0}
        for token, name, owner, pcount, scount in cur.fetchall()
    ]


@shared_router.get("/{token}")
def get_shared(token: str, user: dict = Depends(get_current_user)):
    cur = get_conn().cursor()
    meta = _shared_list(cur, token)
    cur.execute(
        "SELECT problem_id FROM problem_list_items WHERE list_id = ? ORDER BY added_at",
        (meta["id"],),
    )
    problem_ids = [r[0] for r in cur.fetchall()]

    # Board = owner + joined members, each with the list problems they have AC'd.
    cur.execute(
        """SELECT u.id, u.username FROM users u WHERE u.id = ?
           UNION
           SELECT u.id, u.username FROM problem_list_members m
           JOIN users u ON u.id = m.user_id WHERE m.list_id = ?""",
        (meta["owner_id"], meta["id"]),
    )
    members = {uid: {"user_id": uid, "username": name, "is_owner": uid == meta["owner_id"], "solved": []}
               for uid, name in cur.fetchall()}
    cur.execute(
        """SELECT ps.user_id, ps.problem_id FROM problem_status ps
           JOIN problem_list_items pli ON pli.problem_id = ps.problem_id AND pli.list_id = ?
           WHERE ps.status = 'AC' AND (ps.user_id = ? OR ps.user_id IN
             (SELECT user_id FROM problem_list_members WHERE list_id = ?))""",
        (meta["id"], meta["owner_id"], meta["id"]),
    )
    for uid, pid in cur.fetchall():
        members[uid]["solved"].append(pid)

    return {
        "name": meta["name"],
        "owner": meta["owner"],
        "is_owner": user["id"] == meta["owner_id"],
        "is_member": user["id"] in members,
        "problem_ids": problem_ids,
        "members": list(members.values()),
    }


@shared_router.post("/{token}/join")
def join_shared(token: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    cur = conn.cursor()
    meta = _shared_list(cur, token)
    if user["id"] != meta["owner_id"]:
        cur.execute(
            "INSERT OR IGNORE INTO problem_list_members (list_id, user_id) VALUES (?, ?)",
            (meta["id"], user["id"]),
        )
        conn.commit()
    return {"ok": True}


@shared_router.delete("/{token}/members/{user_id}")
def remove_member(token: str, user_id: int, user: dict = Depends(get_current_user)):
    """A member can leave; the owner can remove anyone."""
    conn = get_conn()
    meta = _shared_list(conn.cursor(), token)
    if user["id"] not in (user_id, meta["owner_id"]):
        raise HTTPException(403, "Only the owner can remove other members")
    conn.execute(
        "DELETE FROM problem_list_members WHERE list_id = ? AND user_id = ?",
        (meta["id"], user_id),
    )
    conn.commit()
    return {"ok": True}
