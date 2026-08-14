#!/usr/bin/env python3
"""Sync problem statuses from QOJ.ac into the database.

Usage:
    # 1. Sync via direct API (requires JWT token or username/password):
    python3 scripts/qoj_sync.py --handle Dedibeat --cookie "UOJSESSID=..."

    # 2. Sync directly to local database:
    python3 scripts/qoj_sync.py --handle Dedibeat --db local.db --cookie "UOJSESSID=..."

    # 3. Read cookie from $QOJ_COOKIES environment variable:
    export QOJ_COOKIES="UOJSESSID=..."
    python3 scripts/qoj_sync.py --handle Dedibeat
"""
import argparse
import os
import sys

# Ensure src is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.qoj_sync import fetch_qoj_profile, parse_qoj_profile_html, _chunked
from src.db import get_conn


def sync_local_db(handle: str, cookie: str | None = None, username: str | None = None, db_path: str | None = None):
    if db_path:
        os.environ["LIBSQL_URL"] = db_path

    conn = get_conn()
    cur = conn.cursor()

    # Find target user
    if username:
        cur.execute("SELECT id, username FROM users WHERE username = ?", (username,))
    else:
        cur.execute("SELECT id, username FROM users ORDER BY id ASC LIMIT 1")
    user_row = cur.fetchone()
    if not user_row:
        print("Error: No users found in database.")
        sys.exit(1)

    uid, uname = user_row[0], user_row[1]
    print(f"Syncing QOJ user '{handle}' for app account '{uname}' (id={uid})...")

    html = fetch_qoj_profile(handle, cookie)
    accepted, tried = parse_qoj_profile_html(html)

    print(f"Found {len(accepted)} accepted problems and {len(tried)} tried problems on QOJ.")

    # Update problem_status
    ac_pids = list(dict.fromkeys(accepted))
    for chunk in _chunked(ac_pids):
        values = ",".join(["(?, ?, 'AC')"] * len(chunk))
        args = [x for pid in chunk for x in (uid, pid)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status='AC', updated_at=CURRENT_TIMESTAMP""",
            args,
        )

    tried_pids = [pid for pid in dict.fromkeys(tried) if pid not in set(ac_pids)]
    for chunk in _chunked(tried_pids):
        values = ",".join(["(?, ?, 'WA')"] * len(chunk))
        args = [x for pid in chunk for x in (uid, pid)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status=excluded.status, updated_at=CURRENT_TIMESTAMP
                WHERE problem_status.status NOT IN ('AC', 'NI')""",
            args,
        )

    # Save handle & cookie in user record
    conn.execute(
        "UPDATE users SET qoj_handle = ?, qoj_cookie = COALESCE(?, qoj_cookie) WHERE id = ?",
        (handle, cookie, uid),
    )
    conn.commit()

    print(f"✓ Successfully synced {len(ac_pids)} AC and {len(tried_pids)} WA problem statuses into database.")


def main():
    parser = argparse.ArgumentParser(description="Sync problem statuses from QOJ.ac")
    parser.add_argument("--handle", required=True, help="QOJ handle/username (e.g. Dedibeat)")
    parser.add_argument("--cookie", help="QOJ session cookie string (e.g. UOJSESSID=...)")
    parser.add_argument("--user", help="App username to sync to (defaults to first user)")
    parser.add_argument("--db", help="Path to SQLite database (e.g. local.db)")

    args = parser.parse_args()
    cookie = args.cookie or os.environ.get("QOJ_COOKIES")

    sync_local_db(args.handle, cookie, args.user, args.db)


if __name__ == "__main__":
    main()
