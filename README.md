<<<<<<< HEAD
# appointment
=======
# Clinic Appointment Scheduling v2

A clinic appointment system with three kinds of user:

- **Patients** sign up (email or Google), request appointments by choosing a service, a doctor
  and a free time slot, and get emails when the clinic confirms or changes them.
- **Employees** run the clinic's schedule: day/week calendar, booking, conflict and
  business-hour checks, search, reports, reminders and settings (all of v1), plus a queue to
  approve or decline patient requests, a notification inbox, and changing or cancelling patient
  bookings (the patient is told why).
- **Admins** create staff accounts, delete records, read the activity log of every sign-in and
  change, and set the clinic time zone.

Plan and decisions: [ROADMAP_V2.md](ROADMAP_V2.md). The v1 app is kept in [legacy/](legacy/).

| Part | Path | Runs on |
|------|------|---------|
| Web — React + Vite + TypeScript | `apps/web` | Vercel |
| API — Node + Fastify + TypeScript | `apps/api` | Render |
| Shared types and rules | `packages/shared` | — |
| Database — PostgreSQL | `apps/api/drizzle` (migrations) | Neon |
| Email | `apps/api/src/lib/templates.ts` | Brevo |

## Run it locally

Needs Node 20+ and either Docker or a Neon dev branch.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL (Docker URL is in the file)
cp apps/web/.env.example apps/web/.env
npm run build -w @clinic/shared             # once, and after changing packages/shared

docker compose up -d                        # local Postgres on :5433 (skip if using Neon)
npm run db:migrate -w @clinic/api
npm run db:seed -w @clinic/api              # demo data + logins
```

Then in two terminals:

```bash
npm run dev:api     # API on :8000
npm run dev:web     # http://localhost:5173
```

If port 8000 is taken, set `PORT` in `apps/api/.env` and `VITE_API_TARGET` in `apps/web/.env` to match.

**Demo logins** (password `ClinicDemo2026!`, or `SEED_PASSWORD`):

| Who | Sign in at | Email |
|-----|-----------|-------|
| Patient | `/login` | `ana.cruz@example.com` |
| Employee | `/staff/login` | `employee@clinic.local` |
| Admin | `/staff/login` | `admin@clinic.local` |

Without `BREVO_API_KEY`, emails are printed in the API log instead of sent.

## Tests

```bash
npm test -w @clinic/api     # 123 tests, Vitest + PGlite (Postgres in-process, real migrations)
npm run typecheck           # all workspaces
```

## Deploy

Do these in order; each step needs a value from the one before.

1. **Neon** — create a project (region: Singapore). Copy the **pooled** connection string.
2. **Brevo** — SMTP & API → create an API key. Senders → add and verify the address emails
   come from. (Later, with a domain, authenticate the domain instead for better delivery.)
3. **Render** — New → Blueprint → pick this repo (`render.yaml`). Fill in `DATABASE_URL`,
   `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`. `JWT_SECRET` and `CRON_SECRET` are generated.
   Leave `WEB_ORIGIN` for step 5. Migrations run automatically on every start.
   Note the service URL, e.g. `https://clinic-api.onrender.com`.
4. **Vercel** — import the repo, **Root Directory `apps/web`**, framework Vite. Before deploying,
   replace `REPLACE-WITH-RENDER-SERVICE` in `apps/web/vercel.json` with the Render host.
   Note the site URL, e.g. `https://clinic.vercel.app`.
5. **Render** again — set `WEB_ORIGIN` to the Vercel URL. Redeploy.
6. **First admin** — open `https://<vercel-url>/setup`. Paste `SETUP_TOKEN` from Render
   (clinic-api → Environment), enter your name, email and a 12+ character password. This
   works only while no admin exists; afterwards the page refuses and further admins are
   created under **Accounts**. Then create employee accounts, and have employees set each
   doctor's **services offered** under Settings → Staff (a doctor with none can't be booked).
   (Command-line alternative: `npm run db:create-admin -w @clinic/api`, see the script header.)
7. **Reminders** — GitHub repo → Settings → Secrets → Actions: add `APP_URL` (the Vercel URL)
   and `CRON_SECRET` (copy it from Render). `.github/workflows/reminders.yml` then runs every
   30 minutes.
8. **Google sign-in** (optional, free) — create an OAuth client (see `apps/api/.env.example`),
   add `https://<vercel-url>/api/auth/google/callback` as a redirect URI, set
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on Render.

Check: `https://<vercel-url>/api/health` → `{"ok":true,"db":"up",…}`.

Render's free tier sleeps after 15 minutes idle, so the first request after a quiet spell
takes up to a minute.

## How it fits together

- The browser only ever talks to the Vercel URL. Vercel serves the app and forwards `/api/*`
  to Render, so the login cookie is first-party.
- The session is a signed token in an httpOnly cookie. The user is re-read on every request,
  so deactivating an account signs it out immediately.
- Times are stored as exact moments and shown in the clinic's time zone (default Asia/Manila,
  admins can change it). Business hours are clinic wall-clock times.
- Double-booking is prevented twice: the API checks first to give a clear message, and a
  database constraint makes it impossible even for two requests at the same instant.
- Every change is written to the activity log in the same transaction as the change itself.

## API

All under `/api`. Errors are `{ code, message, …detail }`.

| Area | Who | Endpoints |
|------|-----|-----------|
| `auth` | anyone | `register`, `login` (`portal: patient\|staff`), `logout`, `me`, `forgot-password`, `reset-password`, `change-password`, `google/start` |
| `portal` | patient | `services`, `staff`, `availability`, `appointments` (+ `/cancel`, `/reschedule`), `profile` |
| `appointments` | employee (admin read) | list, `search`, detail, create, `/status`, `/reschedule`, `/approve`, `/decline`, `/history` |
| `patients`, `staff`, `services` | employee (admin read) | CRUD, `staff/:id/business-hours` |
| `reports`, `reminders` | employee | `daily-summary`, `utilisation`, `cancellations`; `due`, `dispatch`, `log` |
| `notifications` | signed in | list, `/:id/read`, `read-all` |
| `admin` | admin | `users`, `patients/:id` (delete), `appointments/:id` (delete), `activity`, `settings` |
| `cron/reminders` | `CRON_SECRET` | sends due 24h and 2h reminders |
>>>>>>> cd0aee307e98cf919aab0ab09219f3972eefa617
