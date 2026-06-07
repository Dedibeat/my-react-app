import os
import libsql

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS problem_status (
  user_id INTEGER NOT NULL,
  problem_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, problem_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_status_user ON problem_status(user_id);
"""

_conn = None


def get_conn():
    global _conn
    if _conn is None:
        url = os.environ.get("TURSO_URL") or os.environ.get("LIBSQL_URL", "local.db")
        token = os.environ.get("TURSO_TOKEN") or os.environ.get("LIBSQL_AUTH_TOKEN", "")
        if url.startswith(("libsql://", "http://", "https://")):
            _conn = libsql.connect(url, auth_token=token)
        else:
            _conn = libsql.connect(url)
        _conn.executescript(SCHEMA)
    return _conn
