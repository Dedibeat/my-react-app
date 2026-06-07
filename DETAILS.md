# DETAILS.md — Problemset App: Full State, Changes, and Open Issues

## TL;DR

- **Frontend (React/Vite):** deployed at https://my-react-app-mu-ecru.vercel.app
- **API (FastAPI):** deployed at https://my-react-app-33zw.onrender.com
- **DB:** Turso (libSQL/SQLite) — same instance used in dev and prod
- **Vercel proxies `/api/*` → Render** (server-side, so browser sees one origin and CORS is a non-issue)
- **Current blocker:** signup and login return HTTP 500 (empty body) on Render, but work fine locally against the same Turso DB

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

The FastAPI app is the one already in `src/server.py`, `src/auth.py`, `src/db.py`, `src/status.py`. Routes:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | none | Liveness |
| POST | `/api/auth/signup` | none | Create user, return JWT |
| POST | `/api/auth/login` | none | Verify password, return JWT |
| GET | `/api/auth/me` | Bearer | Current user |
| GET | `/api/status` | Bearer | `{problemId: status, ...}` |
| PUT | `/api/status/{problemId}` | Bearer | Upsert one status |
| DELETE | `/api/status/{problemId}` | Bearer | Clear one status |

Schema is created on first request via `executescript(SCHEMA)` in `src/db.py` — two tables (`users`, `problem_status`) and one index.

### Frontend (`src/api.js`)

The existing `api.js` uses path params (`/api/status/42`) which match FastAPI's `@router.put("/{problem_id}")` etc. An earlier session had switched to query params (`/api/status?id=42`) for a per-file Vercel-functions approach; reverted to path params now that we're back on a single FastAPI app.

### Vercel config (`vercel.json`)

```json
{
  "framework": null,
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://my-react-app-33zw.onrender.com/api/$1" }
  ]
}
```

The single rewrite forwards every `/api/*` request to Render. Vercel preserves HTTP method, headers (including `Authorization`), and body. The response (with the original 200/401/500 status) is sent back to the browser.

### Render config

- **Service:** `my-react-app` on Render, Python 3, free tier
- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn src.server:app --host 0.0.0.0 --port $PORT`
- **Env vars:** `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`, `JWT_SECRET`, `CORS_ORIGINS=https://my-react-app-mu-ecru.vercel.app`
- **Region:** Oregon (US West)
- **Repo:** `Dedibeat/my-react-app` on GitHub, auto-deploy on push to `master`

### `src/server.py`

Added a global exception handler so a worker crash surfaces as a JSON error in the response (instead of an empty body from Render's reverse proxy):

```python
@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    log.error("unhandled error on %s %s: %s\n%s",
              request.method, request.url.path, exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )
```

This is the only meaningful code change this session — everything else is just config.

### `README.md`

Rewritten to document the Vercel + Render architecture, the actual deploy steps, and the real `uvicorn src.server:app` start command (the old README referenced a non-existent `api/index.py`).

## Open issues

### Issue 1: signup/login return 500 on Render (NOT YET FIXED)

**Symptoms:**
- `GET /api/health` → 200 ✅
- `POST /api/auth/signup` (valid body) → 500, empty body ❌
- `POST /api/auth/login` → 500, empty body ❌
- `POST /api/auth/signup` (invalid body, e.g. short username) → 400, proper JSON ✅
- `POST /api/auth/signup` (bad JSON) → 422, proper JSON ✅
- OPTIONS preflight → 200 with correct CORS headers ✅

**Pattern:** anything that touches the DB with an actual query crashes. Anything that doesn't (validation, OPTIONS, schema-only `get_conn()`) works.

**Empty body, not FastAPI's normal `{"detail": "Internal Server Error"}`:** this is Render's reverse proxy returning 500, not FastAPI. That means the worker process is dying mid-request — likely a segfault in the libsql native extension (it's a Rust-based client with a prebuilt binary per platform). uvicorn logs requests *after* they complete, so a worker crash leaves no access-log entry, which matches what we see in the Render dashboard.

**Confirmed working locally:** I ran the exact same INSERT and SELECT against the same Turso DB from this machine, and both succeeded (with a `localdebug1` user created, id=6). The query is fine; the runtime environment is the problem.

**Most likely root cause:** the libsql 0.1.11 native binary doesn't load correctly on Render's Ubuntu container, or there's a thread-safety issue with the sync `cursor().execute()` interface when called from FastAPI's thread-pool sync handlers.

**Fix not yet applied.** I added the exception handler above but haven't pushed it yet — it would at least make the next failure surface the actual Python exception (e.g. `RuntimeError: native extension failed to load`) instead of a silent 500.

**Possible next steps once we have the error message:**
1. Pin libsql to a different version (`libsql==0.1.10` or whatever's latest on PyPI)
2. Switch to the `libsql-experimental` async client
3. Switch the DB to a plain-HTTP libsql client (no native binary)
4. Use a different driver entirely — `httpx` against Turso's HTTP API directly
5. Try psycopg-style connection pooling with `urllib3` + libsql's HTTP mode

### Issue 2: Render free tier sleeps after 15 min of inactivity

The first request after sleep takes ~30-50s. Subsequent requests are fast. The signup 500 above happens even on a warm service (I curled it within seconds of `/api/health` succeeding), so the sleep isn't the cause of issue 1. But it will bite any real user. Options:
- Upgrade to Starter ($7/mo)
- Set up a free external pinger (cron-job.org hitting `/api/health` every 10 min)

### Issue 3: Git history doesn't reflect the current working state

The current `master` branch on GitHub reflects the previous session's state (per-file Vercel functions, which don't work). The `src/server.py` and `vercel.json` changes from this session are in the working tree but uncommitted:

```
M README.md
M src/api.js
M src/server.py
M vercel.json
D api/_auth.py
D api/_db.py
D api/_util.py
D api/auth/login.py
D api/auth/me.py
D api/auth/signup.py
D api/health.py
D api/status.py
D .vercelignore
```

The local `api/` directory (and `api/auth/`) was an experiment that's now gone. Once the 500 issue is fixed, these should be committed and pushed so Render picks up the exception handler.

### Issue 4: `problems.json` is dead code

`src/problems.json` is a legacy dummy dataset from before the real `data/tagged.json` (15.6 MB) was wired in. Not used by `ProblemSet.jsx` anymore. Leaving it alone per the AGENTS.md "Surgical Changes" rule.

## Verification status

End-to-end working on production (Vercel → Render → Turso):
- ✅ Static SPA loads (`GET /` → index.html)
- ✅ `tagged.json` serves (15.6 MB, 200 OK)
- ✅ `GET /api/health` → `{"status":"ok"}`
- ❌ `POST /api/auth/signup` → 500, empty body (worker crash, see Issue 1)
- ❌ `POST /api/auth/login` → 500, empty body (same)
- ✅ OPTIONS preflight → 200 with CORS headers
- ❌ All DB-touching endpoints blocked behind the 500

So the wiring is correct, but the API itself is broken in production until Issue 1 is fixed.

## Local development (still works)

```bash
cd /home/dedibeat/Projects/my-react-app
source .venv/bin/activate
LIBSQL_URL=local.db JWT_SECRET=dev-secret uvicorn src.server:app --reload --port 8000
# separate terminal
npm run dev
```

Vite's dev server (5173) proxies `/api/*` → `localhost:8000`, matching the Vercel prod setup. Schema is auto-created on first request.
