import json
import os
import sqlite3
import threading
import urllib.request

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


def _is_remote(url: str) -> bool:
    return url.startswith("libsql://") or url.startswith("http://") or url.startswith("https://")


def _http_url(url: str) -> str:
    if url.startswith("libsql://"):
        return "https://" + url[len("libsql://"):]
    return url


def _encode_value(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, bool):
        return {"type": "integer", "value": "1" if v else "0"}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    if isinstance(v, (bytes, bytearray)):
        import base64
        return {"type": "blob", "value": base64.b64encode(bytes(v)).decode()}
    return {"type": "text", "value": str(v)}


def _decode_value(v):
    t = v.get("type")
    if t == "null":
        return None
    if t == "integer":
        return int(v["value"])
    if t == "float":
        return float(v["value"])
    if t == "text":
        return v["value"]
    if t == "blob":
        import base64
        return base64.b64decode(v["value"])
    return None


def _pipeline(http_url: str, token: str, requests: list) -> dict:
    body = json.dumps({"requests": requests}).encode()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(http_url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


class _RemoteCursor:
    def __init__(self, conn):
        self._conn = conn
        self._rows: list = []
        self._idx = 0
        self._lastrowid = None

    def execute(self, sql, params=()):
        data = self._conn._do([{"type": "execute", "stmt": {
            "sql": sql, "args": [_encode_value(p) for p in params]
        }}])
        result = data["results"][0]
        if result.get("type") == "error":
            err = result.get("error", {})
            raise RuntimeError(err.get("message") if isinstance(err, dict) else str(err))
        resp = result["response"]["result"]
        self._rows = [[_decode_value(c) for c in row] for row in resp.get("rows", [])]
        self._idx = 0
        lid = resp.get("last_insert_rowid")
        self._lastrowid = int(lid) if lid is not None else None
        return self

    def fetchone(self):
        if self._idx >= len(self._rows):
            return None
        row = tuple(self._rows[self._idx])
        self._idx += 1
        return row

    def fetchall(self):
        remaining = [tuple(r) for r in self._rows[self._idx:]]
        self._idx = len(self._rows)
        return remaining

    @property
    def lastrowid(self):
        return self._lastrowid


class _RemoteConnection:
    def __init__(self, url: str, token: str):
        self._pipeline_url = _http_url(url) + "/v2/pipeline"
        self._token = token

    def cursor(self):
        return _RemoteCursor(self)

    def execute(self, sql, params=()):
        data = self._do([{"type": "execute", "stmt": {
            "sql": sql, "args": [_encode_value(p) for p in params]
        }, "commit": True}])
        result = data["results"][0]
        if result.get("type") == "error":
            err = result.get("error", {})
            raise RuntimeError(err.get("message") if isinstance(err, dict) else str(err))
        return self

    def commit(self):
        pass

    def executescript(self, sql: str):
        stmts = [s.strip() for s in sql.split(";") if s.strip()]
        if not stmts:
            return
        self._do([{"type": "execute", "stmt": {"sql": s}, "commit": True} for s in stmts])

    def _do(self, requests: list) -> dict:
        data = _pipeline(self._pipeline_url, self._token, requests)
        if "error" in data:
            err = data["error"]
            raise RuntimeError(err.get("message") if isinstance(err, dict) else str(err))
        return data


def _connect():
    url = os.environ.get("TURSO_URL") or os.environ.get("LIBSQL_URL", "local.db")
    token = os.environ.get("TURSO_TOKEN") or os.environ.get("LIBSQL_AUTH_TOKEN", "")
    if _is_remote(url):
        return _RemoteConnection(url, token)
    return sqlite3.connect(url)


_tls = threading.local()
_schema_lock = threading.Lock()
_schema_done = False


def get_conn():
    conn = getattr(_tls, "conn", None)
    if conn is None:
        conn = _connect()
        global _schema_done
        with _schema_lock:
            if not _schema_done:
                conn.executescript(SCHEMA)
                _schema_done = True
        _tls.conn = conn
    return conn
