# DETAILS.md — Problemset App: Full State, Changes, and Open Issues

## TL;DR

- **Frontend (React/Vite):** deployed at https://my-react-app-mu-ecru.vercel.app
- **API (FastAPI):** deployed at https://my-react-app-33zw.onrender.com
- **DB:** Turso (libSQL/SQLite) — same instance used in dev and prod
- **Vercel proxies `/api/*` → Render** (server-side, so browser sees one origin and CORS is a non-issue)
- **DB 500 issue: FIXED.** Root cause was `libsql 0.1.11`'s Hrana protocol losing server-side streams under concurrent connections. Replaced the libsql native client with a stdlib-only DB layer (`urllib` + `sqlite3`) talking to Turso's HTTP pipeline API directly. No native binary, no Hrana, no streams. Verified against the real Turso DB with 15 parallel signups + 15 parallel status PUTs — all 200, zero 500s. **Needs to be committed and pushed to deploy the fix to Render.**

## Architecture

```
Browser
  │
  │  fetch("/api/auth/signup", { method: "POST", body: ... })
  ▼
Vercel (static SPA + edge rewrite)
  │  vercel.json: { "rewrites": [{ "source": "/api/(.*)", "destination": "https://my-react-app-33zw.onrender.com/api/$1" }] }
  ▼
Render (uvicorn → FastAPI app in src/server.py)
  │
  ▼
Turso (libSQL over HTTPS, single shared DB)
```

The rewrite is a server-side proxy — the browser never talks to Render directly. The JWT is forwarded in the `Authorization` header.

## Why this split (Vercel + Render, not Vercel alone)

We started with the goal of running both the React SPA and FastAPI on Vercel. **This is where the previous session burned the most time**, and it's worth documenting so the next person doesn't redo the same work.

### The Vercel-Python problem

Vercel's Python runtime (`@vercel/python`) only creates serverless functions for files in the `api/` directory. For each `.py` file, it makes one function whose URL is `/api/<filename>` (without `.py`). Catch-all dynamic routes (the `[...slug].py` style Next.js supports) **are not supported for Python** on Vercel.

The combination of the two produces a real blocker for FastAPI:

1. **Single-function approach:** `api/index.py` becomes a function at `/api`. The function IS invoked for `/api` exactly, but `/api/auth/login` etc. don't route to it — Vercel only invokes the function for its exact mapped path.
2. **Rewrites:** `{ "rewrites": [{ "source": "/api/(.*)", "destination": "/api" }] }` does forward requests, but it rewrites the path before the function sees it. Mangum (the ASGI↔Lambda adapter Vercel uses) reads `scope["path"]` from the event, and Vercel puts the destination path there. So the FastAPI app sees the request as coming in at `/api`, not `/api/auth/login` — and every route defined as `@router.get("/api/auth/login")` 404s.
3. **`root_path="/api"` workaround:** doesn't help. `root_path` only affects OpenAPI doc generation, not path stripping during route matching (this is modern Starlette/FastAPI behavior; older versions did strip, but that behavior was removed).
4. **Per-file functions (`api/health.py`, `api/auth/signup.py`, …):** I built the whole backend this way and verified all 13 handler tests pass locally. **But the Vercel builder never invoked `@vercel/python`** because the project has `framework: null` and `buildCommand: "npm run build"` — Vercel treats it as a Node.js static site. The deployment JSON shows `builds: []` and `functions: null`. Python packages get installed (side effect of detecting `pyproject.toml`) but no lambdas are created. Same issue hits the previous LLM's single-file `api/index.py` if you remove the `pyproject.toml` `[tool.vercel]` entrypoint.
5. **Build Output API v3** (hand-rolled `.vercel/output/config.json`): the handoff says the file gets stripped from the deployment. Plausible to fix with a postbuild hook in `package.json`, but it's ~2-3 hours of fiddly work and Vercel doesn't recommend it for typical apps.
6. **Vercel "Services"** (the official way to mix static + API on Vercel): it's complex configuration for what is a simple problem elsewhere.

**Conclusion:** the Vercel+FastAPI story is not simple, and "use FastAPI if it's easier to deploy" (your original framing) — on Vercel, it isn't easier. Switching the API to Render gets us a long-running `uvicorn` process that runs FastAPI as written, with zero changes to the Python code. The React side stays on Vercel where it shines.

## What was changed in this session

### Backend (unchanged code, just hosted)

The FastAPI app is the one already in `src/server.py`, `src/auth.py`, `src/status.py`. Routes:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | none | Liveness |
| POST | `/api/auth/signup` | none | Create user, return JWT |
| POST | `/api/auth/login` | none | Verify password, return JWT |
| GET | `/api/auth/me` | Bearer | Current user |
| GET | `/api/status` | Bearer | `{problemId: status, ...}` |
| PUT | `/api/status/{problemId}` | Bearer | Upsert one status |
| DELETE | `/api/status/{problemId}` | Bearer | Clear one status |

### `src/db.py` — rewritten (DB 500 fix, this session)

**Root cause of the 500s.** `libsql 0.1.11` is a Rust native extension that talks to Turso using the Hrana protocol (stateful server-side "streams"). Under concurrent connections from the same process, the server returns `404 stream not found` on commit, and the native client either surfaces this as a `ValueError` (caught locally, returns 500 with a JSON body) or segfaults (on Render, where the reverse proxy then returns 500 with an empty body). I reproduced this locally against the real Turso DB with a concurrent signup stress test — 20 parallel signups produced a mix of 200s and 500s with the exact `stream not found` error.

A first attempt at a thread-local connection (one `libsql` connection per FastAPI thread-pool thread) did **not** fix it — the bug is in the Hrana client itself, not in connection sharing. The native binary still loses streams.

**The fix.** Replaced the libsql native client with a stdlib-only DB layer that talks to Turso's HTTP pipeline API directly. No native binary, no Hrana protocol, no long-lived streams — each query is a plain `POST` to `{db-url}/v2/pipeline` with `Authorization: Bearer {token}`.

- **Remote (Turso):** `urllib.request` (stdlib) → `_RemoteConnection` / `_RemoteCursor` classes implementing the same `cursor()` / `execute()` / `fetchone()` / `fetchall()` / `lastrowid` / `commit()` / `executescript()` interface that `auth.py` and `status.py` already use. Args are encoded as Hrana v2 typed values (`{"type": "integer", "value": "1"}` etc.); rows are decoded back to Python objects.
- **Local (dev):** `sqlite3` (stdlib) — `libsql.connect("local.db")` is gone; the new `_connect()` returns `sqlite3.connect(url)` directly. The sqlite3 connection already has the same interface, so no wrapper is needed.
- **Threading:** thread-local connection (one per thread-pool thread), same as before. Schema is applied exactly once per process under a `threading.Lock` with double-checked locking, so only the first-ever connection runs `CREATE TABLE IF NOT EXISTS` — subsequent threads skip it.
- **Dependency:** `libsql==0.1.11` removed from `requirements.txt` and `pyproject.toml`. The new layer uses only stdlib.

**Result.** 15 parallel signups + 15 parallel status PUTs against the real Turso DB → all 200, zero 500s. Process stays alive. The exception handler in `src/server.py` (added in the previous session) is no longer the safety net it was, but it's harmless and stays as defense-in-depth.

### `README.md`

Rewritten to document the Vercel + Render architecture, the actual deploy steps, and the real `uvicorn src.server:app` start command (the old README referenced a non-existent `api/index.py`).

## Open issues

### Issue 1: signup/login return 500 on Render — RESOLVED ✅

**Resolution (this session):** root cause was `libsql 0.1.11`'s Hrana stream bug under concurrency. Fixed by replacing the DB layer with a stdlib HTTP client (see "What was changed → `src/db.py`"). Verified locally against the real Turso DB. **Still needs to be committed and pushed** (see Issue 3) for the fix to reach Render.

For historical context, the previous-session symptoms and hypotheses:

- `GET /api/health` → 200 ✅
- `POST /api/auth/signup` (valid body) → 500, empty body ❌
- `POST /api/auth/login` → 500, empty body ❌
- `POST /api/auth/signup` (invalid body, e.g. short username) → 400, proper JSON ✅
- `POST /api/auth/signup` (bad JSON) → 422, proper JSON ✅
- OPTIONS preflight → 200 with correct CORS headers ✅

**Pattern:** anything that touches the DB with an actual query crashes. Anything that doesn't (validation, OPTIONS, schema-only `get_conn()`) works.

**Empty body, not FastAPI's normal `{"detail": "Internal Server Error"}`:** this is Render's reverse proxy returning 500, not FastAPI. That means the worker process is dying mid-request — likely a segfault in the libsql native extension. uvicorn logs requests *after* they complete, so a worker crash leaves no access-log entry.

**The actual error** (only visible locally, where the worker survives the exception):
```
ValueError: Hrana: `api error: `status=404 Not Found,
  body={"error":"stream not found: 1c7cf458:1af51a"}``
```

### Issue 2: Render free tier sleeps after 15 min of inactivity

The first request after sleep takes ~30-50s. Subsequent requests are fast. This is unrelated to the DB fix and still applies. Options:
- Upgrade to Starter ($7/mo)
- Set up a free external pinger (cron-job.org hitting `/api/health` every 10 min)

### Issue 3: Git history doesn't reflect the current working state

The current `master` branch on GitHub reflects the previous session's state (per-file Vercel functions, which don't work, plus the old libsql-based `db.py` with the 500 bug). The working tree has uncommitted changes from this session and the previous one, including the DB fix:

```
M  DETAILS.md              (this update)
M  README.md               (previous session: deploy docs)
M  src/api.js              (previous session: path-param URLs)
M  src/db.py               (this session: rewritten, stdlib only)
M  src/server.py           (previous session: exception handler + CORS)
M  vercel.json             (previous session: /api/* rewrite)
M  requirements.txt        (this session: removed libsql)
M  pyproject.toml          (this session: removed libsql)
D  .vercelignore           (previous session: no longer needed)
D  api/_auth.py            (previous session: dead Vercel experiment)
D  api/_db.py              (previous session: dead Vercel experiment)
D  api/_util.py            (previous session: dead Vercel experiment)
D  api/auth/login.py       (previous session: dead Vercel experiment)
D  api/auth/me.py          (previous session: dead Vercel experiment)
D  api/auth/signup.py      (previous session: dead Vercel experiment)
D  api/health.py           (previous session: dead Vercel experiment)
D  api/status.py           (previous session: dead Vercel experiment)
```

Once committed and pushed, Render auto-deploys from `master` and the DB fix goes live.

### Issue 4: `problems.json` is dead code

`src/problems.json` is a legacy dummy dataset from before the real `data/tagged.json` (15.6 MB) was wired in. Not used by `ProblemSet.jsx` anymore. Leaving it alone per the AGENTS.md "Surgical Changes" rule.

## Verification status

End-to-end working on production (Vercel → Render → Turso), **after this session's DB fix is deployed**:
- ✅ Static SPA loads (`GET /` → index.html)
- ✅ `tagged.json` serves (15.6 MB, 200 OK)
- ✅ `GET /api/health` → `{"status":"ok"}`
- ✅ `POST /api/auth/signup` → 200, JWT returned
- ✅ `POST /api/auth/login` → 200, JWT returned
- ✅ `GET /api/auth/me` → user object
- ✅ `GET /api/status` → `{problemId: status, ...}`
- ✅ `PUT /api/status/{problemId}` → upsert
- ✅ `DELETE /api/status/{problemId}` → clear
- ✅ Concurrent: 15 parallel signups + 15 parallel PUTs, all 200, no 500s
- ✅ OPTIONS preflight → 200 with CORS headers

Locally verified against the real Turso DB (env had `TURSO_URL`/`TURSO_TOKEN` set). Until the commit reaches Render, the deployed API still has the old libsql-based `db.py` and 500s.

## Local development (still works)

```bash
cd /home/dedibeat/Projects/my-react-app
source .venv/bin/activate
# Local SQLite (default):
LIBSQL_URL=local.db JWT_SECRET=dev-secret uvicorn src.server:app --reload --port 8000
# Or against the real Turso DB:
TURSO_URL=libsql://... TURSO_TOKEN=... JWT_SECRET=... uvicorn src.server:app --reload --port 8000
# separate terminal
npm run dev
```

Vite's dev server (5173) proxies `/api/*` → `localhost:8000`, matching the Vercel prod setup. Schema is auto-created on first request.

**Sandbox note:** if verifying in a Codex-style sandbox, run the server and the test curls in the **same** `exec_command` — background uvicorn processes started with `nohup`/`disown` get reaped between separate `exec_command` calls, and subsequent curls will hit a dead process. The earlier "server died on the first request" symptom in the previous session's notes was almost certainly this, not a real bug.
