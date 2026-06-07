# Problemset App

Personal/small-community problem tracker. React frontend + FastAPI backend with Turso (libSQL) storage and JWT auth.

- **Live app:** https://my-react-app-mu-ecru.vercel.app
- **API host:** Render (`https://my-react-app-33zw.onrender.com`)
- **Frontend host:** Vercel (proxies `/api/*` → Render)

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm install
# Terminal 1 — API on :8000
LIBSQL_URL=local.db JWT_SECRET=dev-secret uvicorn src.server:app --reload --port 8000
# Terminal 2 — Vite on :5173 (proxies /api -> :8000)
npm run dev
```

Schema (`users`, `problem_status`) is created automatically on the first request.

## Deploying

### 1. Create a Turso database

```bash
brew install tursodatabase/tap/turso     # or download from https://turso.tech
turso db create problemset
turso db show problemset --url           # -> LIBSQL_URL
turso db tokens create problemset         # -> LIBSQL_AUTH_TOKEN
```

### 2. Deploy the API to Render

1. New + → Web Service → connect the `my-react-app` repo
2. Language: **Python 3**
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn src.server:app --host 0.0.0.0 --port $PORT`
5. Environment variables:
   - `LIBSQL_URL`
   - `LIBSQL_AUTH_TOKEN`
   - `JWT_SECRET` (any long random string; `openssl rand -hex 32`)
   - `CORS_ORIGINS` = `https://my-react-app-mu-ecru.vercel.app`
6. Deploy. Copy the service URL (e.g. `https://my-react-app-33zw.onrender.com`).

### 3. Deploy the frontend to Vercel

`vercel.json` already contains the `/api/*` rewrite pointing to Render. Update the destination URL if your Render domain differs, then:

```bash
npx vercel --prod
```

Vercel will run `npm run build` and serve `dist/`. The rewrite makes `/api/*` requests on the Vercel origin transparently forward to Render.

## Endpoints

- `GET  /api/health` — liveness
- `POST /api/auth/signup` — `{username, password}` → `{token, user}`
- `POST /api/auth/login` — `{username, password}` → `{token, user}`
- `GET  /api/auth/me` — current user (Bearer token)
- `GET  /api/status` — `{problemId: status, ...}` (Bearer token)
- `PUT  /api/status/{problemId}` — `{status}` (Bearer token)
- `DELETE /api/status/{problemId}` — (Bearer token)
