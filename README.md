# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm install
# Terminal 1: API on :8000
LIBSQL_URL=local.db JWT_SECRET=dev-secret uvicorn api.index:app --reload --port 8000
# Terminal 2: Vite on :5173 (proxies /api -> :8000)
npm run dev
```

## Deploying to Vercel

1. **Create a Turso database** (libSQL, SQLite-compatible):
   ```bash
   brew install tursodatabase/tap/turso     # or download from https://turso.tech
   turso db create problemset
   turso db show problemset --url           # -> LIBSQL_URL
   turso db tokens create problemset         # -> LIBSQL_AUTH_TOKEN
   ```

2. **Deploy**:
   ```bash
   npx vercel link                          # link to a Vercel project (create one if needed)
   npx vercel env add LIBSQL_URL production
   npx vercel env add LIBSQL_AUTH_TOKEN production
   npx vercel env add JWT_SECRET production  # any long random string
   npx vercel --prod
   ```

   Or push to a Git repo connected to Vercel for auto-deploy.

After deploy, the schema (`users`, `problem_status`) is created automatically on the first request via `executescript` in `api/db.py`.
