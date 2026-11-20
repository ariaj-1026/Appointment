# Appointment Scheduling v2

Clinic appointment system with patient, employee and admin roles.
Plan and decisions: [ROADMAP_V2.md](ROADMAP_V2.md). The v1 app lives in [legacy/](legacy/).

| Part | Path | Deploys to |
|------|------|------------|
| Web (React + Vite + TSX) | `apps/web` | Vercel |
| API (Node + Fastify + TS) | `apps/api` | Render |
| Shared types | `packages/shared` | — |
| Database | Postgres | Neon |
| Email | Brevo | — |

## Local setup

Node 20+.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # fill DATABASE_URL etc. (all optional for now)
cp apps/web/.env.example apps/web/.env
npm run build -w @clinic/shared          # once, and after changing packages/shared
```

Two terminals:

```bash
npm run dev:api   # http://localhost:8000
npm run dev:web   # http://localhost:5173 (proxies /api to the API)
```

If port 8000 is taken, set `PORT` in `apps/api/.env` and `VITE_API_TARGET` in `apps/web/.env` to match.

## Deploying

1. **Neon** — create a project (region Singapore), copy the *pooled* connection string.
2. **Render** — New → Blueprint → this repo (uses `render.yaml`). Fill the `sync: false`
   env vars from `apps/api/.env.example`. Note the service URL.
3. **Vercel** — import the repo, Root Directory `apps/web`, framework Vite. Replace
   `REPLACE-WITH-RENDER-SERVICE` in `apps/web/vercel.json` with the Render URL.
   Then set Render's `WEB_ORIGIN` to the Vercel URL.
4. **Brevo** — create an API key, verify a sender address (Senders), set both on Render.

Check: `https://<vercel-app>/api/health` should return `{"ok":true,"db":"up",...}`.
