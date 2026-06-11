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


## Frontend changes (next session)

This session was entirely frontend + data. Backend untouched. None of these changes are pushed to GitHub yet — `git status` shows them as uncommitted.

### 1. Fixed dead controls (filter / sort / search / status click)

`ProblemSet.jsx` originally rendered a `Controls` component whose inputs and selects had `id` attributes but no `onChange` handlers, and the parent had no state to read from. The result: typing in search did nothing, changing the sort did nothing, and the Status cell was unclickable when the status was empty (the `<span>` had `display: grid` and zero intrinsic width because the CSS min-width rule was scoped to classed `td`s only).

Wired everything through React state:
- `filter`, `sort`, `region`, `searchInput`, `committedSearch` live in `ProblemSet`.
- `visible` is a single `useMemo([problems, filter, sort, region, searchAst])` that produces the final list. Both `<Top total={visible.length} />` and `<ProblemsTable problems={visible} />` read from it, so the summary count and the table rows are guaranteed to agree.
- Status span now has `minWidth: 120, padding: 8, cursor: pointer` inline so the click target is always ≥120px wide even when status is empty. Empty cells render a muted `—` placeholder so the affordance is visible.

### 2. Search button + delayed filter

Per request: typing alone should not filter; only the Search button (or Enter) commits. Split into two states:
- `searchInput` — what the user is typing.
- `committedSearch` — what `parseSearch` is run against.

`<button type="button">` (explicit, to prevent any accidental form submit) calls `setCommittedSearch(searchInput)`. Enter on the input also commits via `onKeyDown`.

### 3. Region filter

New `Region:` dropdown. `regions` is computed from the dataset via `useMemo([problems])` and sorted. Starts with `All`, then one entry per unique region. The seven regions in `tagged.json` are: Asia East Continent, Asia Pacific, Asia West Continent, Europe, Latin America, North America, Northern Eurasia.

### 4. Boolean search (`and` / `or` / `not` / parens / `|` / `-foo` / `"phrase"`)

The user uploaded an old `search.js` (originally at the repo root, moved to `src/search.js`). It exports:
- `tokenizeSearch(input)` → token stream
- `parseSearch(input)` → AST (or `null` for empty input)
- `evalSearchAst(node, hay)` → boolean

Two real bugs were in the file (the user flagged it as "may be incomplete or wrong"):

1. **`or` keyword was not recognized** — only `|` worked. Tokenizer only mapped `'and'`, `'not'`, and `'|'`; `or` fell through to be parsed as a literal TERM. So `graph OR tree` parsed as `graph AND or AND tree` (with implicit AND), which never matched. Fixed by adding `lower === 'or'` next to `'and'`/`'not'`.
2. **`NOT`/`-foo` as a prefix was silently dropped** when followed by a TERM. The original implicit-AND rule only fired between two atoms (TERM/`)` and TERM/`(`), so `foo -bar` produced tokens `[TERM(foo), NOT, TERM(bar)]` with no AND inserted. The parser then consumed only `TERM(foo)` and returned it, dropping the rest. Fixed the rule to also insert AND when the previous token is an atom *or* a unary prefix (NOT) followed by TERM/`(`. The correct shape is `[TERM(foo), AND, NOT, TERM(bar)]` so the parser produces `AND(TERM(foo), NOT(TERM(bar)))`.

Hay passed to the evaluator: `${name} ${searchKey} ${tags}`.toLowerCase(), where `searchKey = region + ' ' + contest_name + ' ' + year` (per the original spec). Verified the parser with 30+ cases against the real dataset (`graph`, `graph AND tree`, `(graph OR tree) AND dp`, `ICPC 2024 -geometry`, `Hangzhou`, `NOT NOT foo`, etc.).

### 5. Difficulty is now solve-rate, not average score

The cell used to show `p.average_score` (e.g. 93.32 for id 8072). Changed `flattenContests` to compute the percentage of teams that solved:

```js
difficulty: (p.total_number_of_participant > 0
  ? (p.problem_solved_in_contest / p.total_number_of_participant) * 100
  : 0),
```

For id 8072: 2249 solved / 2669 total = **84.26%** (was 93.32). The `DifficultyBadge` already takes a 0–100 number and colorizes green→red via HSL hue, so it works as-is. Sort and top-N logic didn't need changes.

### 6. Deduped `tagged.json` — two passes

The dataset had 2658 problem entries but only 1799 unique `problem_url`s. Pass 1 (this session, earlier) deduped by `problem_url` and dropped the JSON from 15.6 MB to 11.8 MB.

But after that, the browser console started showing React duplicate-key warnings on `10596, 10601, 14917, 14922, 14931, …`. Root cause: 85 `problem_id`s were used in **2+ contests with different URLs** — e.g. id `6303` exists at `qoj.ac/contest/1197/problem/6303` (ICPC) *and* `qoj.ac/contest/1481/problem/6303` (EC-Final 2023 Warm Up). URL-dedup missed them. Pass 2 (this session, later) deduped by `problem_id` first, then URL:

```python
seen_ids, seen_urls = set(), set()
for contest in data:
    contest["problems"] = [p for p in contest["problems"]
        if p["problem_id"] not in seen_ids
        and p["problem_url"] not in seen_urls
        and not (seen_ids.add(p["problem_id"]) or seen_urls.add(p["problem_url"]))]
```

Result: 1799 → **1668** problems, 131 extras removed, 0 remaining duplicate ids. Mirrored to `data/tagged.json` and `public/tagged.json`. `dist/tagged.json` is regenerated by the build.

**Side note about the "table not filtered" complaint:** that was caused by the React key warning. When two `<tr key="10596">` siblings exist, React's reconciler can leave stale rows mounted in some browsers even when `visible` shrinks, making it look like the table isn't responding to the search. The dedup fixed the keys and the table now correctly tracks the count.

### 7. Show-tags button label flips

Minor: button now reads "Show tags" / "Hide tags" based on `showTag` state, so the affordance is obvious. CSS unchanged (`#problemsTable.tags-hidden th:nth-child(4), #problemsTable.tags-hidden td:nth-child(4) { display: none; }` was already correct).

### 8. Small CSS tweak

Added `#searchInput { min-width: 220px; padding: 6px; margin-right: 4px; }` to `ProblemSet.css` so the search box has a reasonable width next to its button. No other CSS changes.

### Uncommitted working tree

```
 M DETAILS.md             (this file)
 M src/ProblemSet.jsx
 M src/ProblemSet.css
 M data/tagged.json
 M public/tagged.json
?? src/search.js
```

Plus the previous session's uncommitted changes (DB fix, etc.) listed in the "Issue 3" section above.

---

## Frontend changes (this session)

Five small UI-only changes, all in `src/ProblemSet.{jsx,css}`. None touched the backend, the data, the deploy config, or any unrelated file.

### 1. Tag badges

The Tags cell used to render the joined string `"math, ad-hoc"` as plain text. Now each tag is its own pill-shaped `<span class="tag">` inside a flex-wrap `.tags` container, styled with the same family as the difficulty badge (rounded background, subtle border, `nowrap`).

- `flattenContests` keeps the `tagList` array, the joined `tags` string (still used by the search hay), and an `extraTagSet` of `extra_tags`.
- Extra tags are prefixed with `*` (e.g. `*math`) and get `title="extra tag"` on hover, so the LLM's tiered confidence is visible without color-coding.
- Tag background is a flat neutral `#f1f1f1` (no longer HSL-by-confidence — the per-problem color wasn't visible because all tags of a problem shared the same hue).
- Mobile (≤768px) keeps tags visible by switching the 4th card cell to `flex-direction: column` so the `Tags` label sits above the wrapping badges.

### 2. Search button icon

Replaced the "Search" text in the search button with a 16×16 inline SVG magnifying glass (Feather-style). Added a `.btn-icon` modifier (`width:32px; height:32px; display:inline-flex; justify/align center`) to keep the button square. `aria-label="Search"` + `title="Search"` for keyboard/screen-reader users. Input type is still `type="search"`, Enter still commits.

### 3. Two columns instead of one "Difficulty" cell

`difficulty_estimate` is LLM-derived per problem with 4 values (`easy`/`medium`/`hard`/`very_hard`, plus 24 missing). It was being thrown away by `flattenContests`. The previous "Difficulty" column was actually showing the calculated solve rate.

- The old column is now labeled **Solve Rate** (header rename only, no logic change; `DifficultyBadge` still renders the red→green HSL gradient on the percent value).
- New **Difficulty** column to the right, populated from `difficulty_estimate`. New `DifficultyLabel` component renders each value as a pill with a fixed hue (green→yellow→orange→red, all 85% lightness). `very_hard` displays as "very hard" for readability. Missing values render as a muted `—`.
- Mobile `::before` label list updated to match the new column order: `Tags / Solve Rate / Difficulty / Status`.

### 5. Importance replaces Difficulty (this session, follow-up)

The previous-session "Difficulty" column was the LLM's `difficulty_estimate` (easy/medium/hard/very_hard). Once the Asia Pacific subset was rated on Mostafa's P1–P5 importance scale (320 of 1668 problems have an `importance` field, see commit `8594cb0`), the column and the sort got replaced. `difficulty_estimate` is no longer used in the UI.

- `flattenContests` now keeps `importance` (default `''`) and `importanceConfidence` (float 0–1) per problem. The old `difficultyEstimate` field is dropped.
- New `ImportanceLabel` component renders the column:
  - Rated (P1–P5): pill with a fixed hue (P5 red, P4 orange, P3 yellow, P2 greenish, P1 neutral gray) and an uppercase label `P5` … `P1`.
  - Unrated (no field): muted italic `*?` with `title="not yet rated"`.
  - `unknown` from the model: muted italic `*?` with `title="model said unknown"` — same visual as unrated by design (both are "I don't know"), distinguished only by tooltip.
  - Tooltip on rated cells shows `confidence NN%` when `importance_confidence > 0`.
- New `.importance` CSS class (replaces the old `.difficulty` styling for the column). The Solve-Rate column still uses `.difficulty` (kept untouched).
- New "Importance:" filter dropdown in the controls bar, between "Quick filter" and "Sort by:". Options:
  - `All` (default)
  - `Rated (P1–P5)` — has any of p1..p5 (i.e. not `''` and not `unknown`)
  - `P1` / `P2` / `P3` / `P4` / `P5` — exact bucket
  - `Unknown` — `importance === 'unknown'`
  - `Not rated` — `importance === ''`
  The filter sits inside the same `useMemo([problems, filter, sort, region, importance, searchAst])`, so it stacks with region/quick-filter/search/sort.
- Sort dropdown: `Difficulty ↓` / `Difficulty ↑` removed and replaced with `Importance ↓` / `Importance ↑`. New `IMPORTANCE_RANK = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 }`. Same tiebreaker as before — solve rate in the same direction. Unrated/unknown sort to the bottom in both directions.
- Mobile `::before` label list updated: `nth-child(6)` is now "Importance" (was "Difficulty"); `nth-child(7)` "Status" unchanged.
- Default selection is now `importance_desc` (most-important problems first).

### 6. What was NOT touched

- `src/search.js` and the boolean search AST are unchanged.
- `data/tagged.json` and `public/tagged.json` are unchanged in this session.
- Backend (`src/server.py`, `src/auth.py`, `src/status.py`, `src/db.py`) and deploy config (`vercel.json`, `vite.config.js`) are unchanged.
- The two pre-existing lint errors in `App.jsx` and `api.js` are still there (unrelated).

### Build / lint

`npm run build` is clean. `npm run lint` shows only the two pre-existing errors noted at the bottom of this file.

---

## Codebase overview

### Repo layout

```
my-react-app/
├── AGENTS.md                  agent conventions (surgical changes, simplicity, etc.)
├── README.md                  user-facing setup + deploy
├── DETAILS.md                 this file
├── package.json               React deps (React 19, Vite 7, react-markdown etc.)
├── vite.config.js             publicDir: 'data', dev proxy /api → :8000
├── vercel.json                rewrites /api/* → Render
├── index.html                 Vite root
├── data/
│   └── tagged.json            the main dataset (now 1668 problems, ~11.3 MB)
├── public/
│   └── tagged.json            mirror of data/tagged.json (Vite serves data/, not public/, but kept in sync for safety)
├── dist/                      vite build output (gitignored, deploys to Vercel)
└── src/
    ├── main.jsx               <StrictMode><App/></StrictMode>
    ├── App.jsx                login / signup / me, gates ProblemSet
    ├── App.css                (empty)
    ├── index.css              (commented out)
    ├── ProblemSet.jsx         the main table + controls + filters
    ├── ProblemSet.css         table + controls + responsive card layout
    ├── search.js              boolean-search tokenizer/parser/evaluator
    ├── api.js                 fetch wrapper with JWT (Bearer token in localStorage "pset.token")
    ├── problems.json          LEGACY dummy data, not used (left alone per AGENTS.md "Surgical Changes")
    ├── assets/                static assets
    ├── auth.py                FastAPI /api/auth/* router
    ├── db.py                  Turso HTTP pipeline (stdlib only, no libsql)
    ├── status.py              FastAPI /api/status/* router
    ├── server.py              FastAPI app, CORS, exception handler
    ├── __init__.py            empty
    ├── __pycache__/           python bytecode
    └── _pyproject.toml, requirements.txt at the repo root
```

### Frontend data flow

1. `App.jsx` checks `localStorage.pset.token`. If absent, shows login/signup form. If present, calls `api.me()` to validate, then renders `<ProblemSet/>`.
2. `ProblemSet.jsx` `useEffect` fetches two things in parallel:
   - `/tagged.json` (Vite serves it from `data/` via `publicDir`).
   - `api.getStatus()` → `{problemId: status, ...}` from the backend.
3. `flattenContests(dataset)` flattens the nested `[{contest, problems: [...]}, ...]` into a flat array of problems, computing `difficulty`, `searchKey`, joined `tags`, etc. per problem.
4. `useMemo` derives `regions` (unique non-null regions, sorted) and `searchAst` (parsed from `committedSearch` via `parseSearch`).
5. `useMemo` derives `visible` from `[problems, filter, sort, region, searchAst]`:
   - region filter (exact match unless "all")
   - quick filter (solved/unsolved/no submission)
   - boolean search (eval AST against hay)
   - sort
6. `<Top total={visible.length}/>` and `<ProblemsTable problems={visible}/>` both read from the same `visible` — they cannot disagree.
7. Status edits call `api.setStatus/clearStatus` and optimistically update local state, rolling back on error.

### Backend data flow

- `src/server.py` mounts `auth_router` and `status_router` and enables CORS for the Vercel origin.
- `src/db.py` talks to Turso via the libSQL HTTP pipeline API directly using stdlib `urllib` + a hand-rolled cursor (`_RemoteCursor` decodes the typed-value envelope). This replaced the libsql native client (which was segfaulting on concurrent requests via Hrana).
- `src/auth.py` issues HS256 JWTs (PyJWT) with bcrypt-hashed passwords.
- `src/status.py` upserts into `problem_status (user_id, problem_id, status)` with `ON CONFLICT … DO UPDATE`.

### Dataset shape

`tagged.json` is an array of contests:

```json
[
  {
    "contest_id": 1485,
    "contest_name": "ICPC",
    "year": 2023,
    "region": "Asia East Continent",
    "contest_url": "https://qoj.ac/contest/1485",
    "editorial_url": null,
    "problems": [
      {
        "problem_id": 8072,
        "problem_label": "A",
        "problem_name": "Qualifiers Ranking Rules",
        "problem_url": "https://qoj.ac/contest/1485/problem/8072",
        "problem_solved_in_contest": 2249,
        "problem_score": 100,
        "total_number_of_participant": 2669,
        "average_score": 93.32,
        "statement": "...",
        "analysis_notes": {...},
        "primary_tags": ["implementation", "strings"],
        "secondary_tags": ["simulation"],
        "extra_tags": [],
        "difficulty_estimate": "easy",
        "confidence": 0.55,
        ...
      }
    ]
  }
]
```

`flattenContests` discards everything except: id, contest_name, region, year, problem_name, joined tags, problem_url, problem_solved_in_contant, total_number_of_participant (used to compute difficulty on the fly). The LLM-derived `statement`, `analysis_notes`, etc. are not used by the UI.

### Deploy

Unchanged from the backend-fix session:
- Vercel (static SPA + edge rewrite) serves the React app.
- Vercel rewrite forwards `/api/*` → Render.
- Render runs `uvicorn src.server:app --host 0.0.0.0 --port $PORT`.
- Render env: `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN` (or `TURSO_URL`/`TURSO_TOKEN`), `JWT_SECRET`, `CORS_ORIGINS`.
- `git push origin master` triggers both Vercel (frontend) and Render (API) auto-deploy.

### What is still dead code / untracked

- `src/problems.json` (legacy dummy dataset, not used) — leaving alone per AGENTS.md surgical-changes rule.
- `public/tagged.json` is a mirror of `data/tagged.json`. Vite actually serves from `data/` (`publicDir: 'data'`), so `public/tagged.json` is not served at runtime, but it's tracked in git and updated alongside `data/tagged.json` for safety. Could be removed in a future cleanup.

### Lint status

`npm run lint` is clean for all new code. The 2 remaining errors are pre-existing in `App.jsx` (`react-hooks/set-state-in-effect`) and `api.js` (`no-empty` try/catch), both unrelated to this session's work and not in the user's request.

## Vercel redeploy (deploy check)

Vercel production was lagging the repo. The previous production deployment (`my-react-jxsoulzmp-…`, 2026-06-07 16:56 +08) was built before the last four commits. Its bundle (`index-BUYBs1Rb.js`) only contained `difficulty_desc` / `difficulty_asc`, while the source on `master` (HEAD = `d885808`) and the local dist already had the new `solve_rate_desc` default plus `Solve Rate ↓ / ↑` options. GitHub auto-deploy was not firing on push (no new production deployment appeared between the last `vercel ls` "4h ago" entry and the manual redeploy below).

Action taken: ran `vercel --prod --yes` from the repo root.

- Build: `npm run build` (Vite) — clean, `dist/assets/index-uggMWM-l.js` (205 kB), `index-DyN98pTy.css` (3.8 kB).
- New production deployment: `my-react-eik31gtmp-dedibeats-projects.vercel.app` (id `dpl_DtRfTRwiuG3QkceVbrPc4JXXZkuF`).
- Aliased to the canonical domain: https://my-react-app-mu-ecru.vercel.app.
- Verified: `curl https://my-react-app-mu-ecru.vercel.app/` now serves `index-uggMWM-l.js`, and that bundle contains all four sort keys (`difficulty_desc`, `difficulty_asc`, `solve_rate_desc`, `solve_rate_asc`).

What was NOT done:
- `git push` was skipped — the local working tree is already in sync with `origin/master`, and the GitHub→Vercel webhook is what is not firing. Pushing again would not change anything. The canonical production URL is now in sync with `master` via the manual `vercel --prod` above.
- The `AGENTS.md` simplification in the working tree (replacing the legacy rules preamble with `First read DETAILS.md`) is left uncommitted — it is the user's pending edit, not part of this deploy task.

## Migration to GitHub Pages (this session)

The new live URL is **https://dedibeat.github.io** (user page repo `Dedibeat/dedibeat.github.io`, default branch `main`, GitHub Pages on). The Vercel deployment is now redundant but left in place for now.

### What changed in this repo

- `src/api.js`: replaced the relative `/api/*` paths with `${API_BASE}${path}`, where
  `API_BASE = import.meta.env.VITE_API_BASE || "https://my-react-app-33zw.onrender.com"`.
  Vite inlines `import.meta.env.VITE_*` at build time. If the env var is unset (the
  normal case), the bundle is hard-wired to Render. The dev server proxy in
  `vite.config.js` still points `/api` to `http://127.0.0.1:8000` so local dev is
  unaffected.
- That's the only source change. No backend changes, no data changes, no config
  changes.

### What was pushed to `Dedibeat/dedibeat.github.io`

Wiped the older vanilla-JS "Live Problem Set" placeholder and replaced it with the
Vite build:

- removed: `index.html`, `scripts.js`, `search.js`, `styles.css`, `num-logo.png`, `search-tip.txt`
- added: `index.html`, `assets/index-wuD9Q862.js`, `assets/index-DyN98pTy.css`, `tagged.json`, `.nojekyll`

`tagged.json` is the full ~11 MB dataset (Vite's `publicDir: 'data'` in
`vite.config.js` copies it into the build). `.nojekyll` disables the Jekyll
processor so the `assets/` directory is served as-is.

### What I did NOT do

- Source was **not** moved into `dedibeat.github.io`. The page repo holds only the
  build output; the source stays in `Dedibeat/my-react-app` (this repo). If you'd
  rather have the React source live in the page repo too, say so and I'll move it.
- The Vercel deployment at `https://my-react-app-mu-ecru.vercel.app` was **not**
  removed. `vercel.json` still has the `/api/*` rewrite. Both can be deleted when
  you've confirmed the GH Pages + Render setup is solid.
- The `git push` from the previous session's commit (`f32d0e8`) is still
  unpushed. The build that is now live on GH Pages was assembled locally
  (`npm run build` against the in-tree source) and pushed via SSH directly to
  `Dedibeat/dedibeat.github.io`, bypassing GitHub. `my-react-app` is still one
  commit ahead of `origin/master`.

### Action item you have to do manually

The Render backend still has the old `CORS_ORIGINS` (whatever it was — almost
certainly just `http://localhost:5173` and possibly the Vercel origin). The
browser will block every API call from `https://dedibeat.github.io` until you
add that origin. Confirmed by preflight:

```
$ curl -sI -X OPTIONS https://my-react-app-33zw.onrender.com/api/health \
    -H "Origin: https://dedibeat.github.io" \
    -H "Access-Control-Request-Method: GET"
HTTP/2 400
vary: Origin
```

→ In the Render dashboard for `my-react-app-33zw`, set `CORS_ORIGINS` to
`https://dedibeat.github.io` (comma-separate if you also want to keep the old
origins working). After that, signup / login / status from the GH Pages site
will start succeeding.

### Live verification

- `curl -s https://dedibeat.github.io/` returns the Vite `index.html` referencing `assets/index-wuD9Q862.js` and `assets/index-DyN98pTy.css`.
- `curl -s https://dedibeat.github.io/assets/index-wuD9Q862.js` contains both `my-react-app-33zw.onrender.com` and all four sort keys (`difficulty_desc`, `difficulty_asc`, `solve_rate_desc`, `solve_rate_asc`).
- `curl -sI https://dedibeat.github.io/tagged.json` → `200`, `content-type: application/json`.
- The `has_pages: true` flag on the repo confirms GitHub Pages is on (the old
  read-time `Mon, 25 Aug 2025` cache was just edge propagation; a re-curl
  seconds later showed the new content).

---

## Importance rating (rating script + system prompt, data not yet rated)

This session added a CLI in the **llm-integration** repo for rating every
Asia Pacific problem in `data/tagged.json` on Dr Mostafa Saad's p1–p5
importance scale. The actual LLM run was started as a smoke test, then
aborted by user request; **the dataset was reverted** to its prior state
and no `importance*` fields are present in `data/tagged.json` or
`public/tagged.json`. The tooling is in place; re-running it will write
the ratings.

### Files added (in `/home/dedibeat/CompetitiveProgramming/llm-integration/`)

- `importance_prompt.md` — system prompt for the rater. Owns the rank
  legend (P5 = must-solve / unique idea, P1 = boring / repeated), the
  rules, and a calibration-traps section. Does **not** inline the few-
  shot examples; those are read from `mostafa_sheet/promth.txt` at
  runtime so the user-curated examples stay canonical.
- `rate_importance.py` — the CLI. Reuses `main.py`'s LLM plumbing by
  direct import: `_call_api`, `clean_text`, `extract_editorial_snippet`,
  `save_output`, `_as_contests`, `MAX_RETRIES`, `SAVE_EVERY`, `MODEL`.
  Region filter (`Asia Pacific` by default) is applied at the contest
  level; resume is keyed on `(contest_id, problem_id)` with
  `llm_importance_status == "success"`. Output is in-place by default;
  a one-shot `data/tagged.json.bak-pre-importance` is created at the
  start and removed on successful end.
- `tests/test_rate_importance.py` — 18 mock-only tests covering
  prompt file, few-shots loader, validation, retry behavior, region
  filter, and resume. All pass. The full suite is 163 passed + 3
  pre-existing errors (unrelated `test.json` is gitignored).

### New per-problem fields (not yet present, will be added on run)

- `importance` — `"p1" | "p2" | "p3" | "p4" | "p5" | "unknown"`
- `importance_confidence` — float in [0, 1], capped at 0.6 without
  editorial, 0.95 with
- `importance_rationale` — 1-2 sentence reason
- `importance_evidence` — list of specific observations
- `importance_model` — `deepseek-v4-flash` (the `MODEL` constant in
  `main.py`)
- `llm_importance_status` — `"success" | "failed"` (resume key)

The `importance_*` prefix is intentional to avoid collision with the
existing `confidence` / `rationale` / `evidence` fields written by
`main.tag_problem`. The two systems can coexist on the same problem.

### Scope choices (and why)

- **Region = Asia Pacific, 324 problems.** Hard-coded as the
  `--region` default. The other 1344 problems stay untouched. Other
  regions are opt-in via `--region "Asia East Continent"` etc.
- **No contest metadata in the user message.** The user prompt gets
  statement + editorial only — no contest name, year, region, solve
  rate, or average score. Brand-bias avoidance was a deliberate
  choice; documented in the prompt's RULES section.
- **OI few-shots, ICPC targets.** The few-shots are Mostafa's 40 OI
  problem blocks (curated for the mostafa-sheet rating task) and the
  targets are ICPC Asia Pacific problems. The mismatch is documented
  in the prompt's calibration-traps section ("Difficulty ≠ importance",
  "Standard combinations are P1–P2", etc.) so the model is reminded to
  judge the **idea**, not the contest. Expect the resulting ratings to
  skew toward the middle (p2–p3) more than mostafa would assign; this
  is a known limitation of using OI few-shots for ICPC targets.
- **No UI changes.** `ProblemSet.jsx` is not updated. The ratings
  are data only; a follow-up session can add an "Importance" column
  and sort/filter, but that's a separate task.

### How to run the full batch

```bash
cd /home/dedibeat/CompetitiveProgramming/llm-integration
.venv/bin/python rate_importance.py --workers 8
```

- 324 problems × 1 call each, with 8 concurrent workers and ~10s/problem,
  should take ~7-10 minutes.
- Re-runs are cheap: any (contest_id, problem_id) already in
  `data/tagged.json` with `llm_importance_status == "success"` is
  skipped and the cached result is re-applied to the in-memory problem.
  The output is checkpointed every 10 newly rated problems.
- `--dry-run` lists what would be rated without calling the API.
- `--problem A` / `--limit N` for small batches; `--region ""` to
  disable the region filter and rate all 1668 problems.

### `.gitignore` addition

`data/tagged.json.bak-pre-importance` and
`public/tagged.json.bak-pre-importance` are added to `.gitignore` so
the run-script backup doesn't get committed.
