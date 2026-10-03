"""One-off: unlink QOJ and delete all problem statuses for one user.

Usage (prod): TURSO_URL=libsql://... TURSO_TOKEN=... python scripts/wipe_user_status.py TEAM_R3 [--yes]
Without --yes it only prints what would be removed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.db import get_conn

username = sys.argv[1]
conn = get_conn()
cur = conn.cursor()
cur.execute("SELECT id, qoj_handle FROM users WHERE username = ?", (username,))
row = cur.fetchone()
if row is None:
    sys.exit(f"no user named {username!r}")
user_id, handle = row
cur.execute("SELECT status, COUNT(*) FROM problem_status WHERE user_id = ? GROUP BY status", (user_id,))
print(f"user {username} (id {user_id}), qoj_handle={handle!r}, statuses: {cur.fetchall()}")

if "--yes" not in sys.argv:
    sys.exit("dry run; pass --yes to delete")

# Unlink first so the background auto-sync can't re-import while we delete.
cur.execute(
    "UPDATE users SET qoj_handle = NULL, qoj_cookie = NULL, qoj_last_synced = NULL, qoj_auto_sync = 0 WHERE id = ?",
    (user_id,),
)
cur.execute("DELETE FROM problem_status WHERE user_id = ?", (user_id,))
conn.commit()
cur.execute("SELECT COUNT(*) FROM problem_status WHERE user_id = ?", (user_id,))
print(f"done; remaining statuses: {cur.fetchone()[0]}")
