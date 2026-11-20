# Appointment Scheduling v2 — Roadmap

v1 (see [ROADMAP.md](legacy/ROADMAP.md)) is a single-role, front-desk tool on FastAPI + SQLite.
v2 rebuilds it as a live, multi-role web app: **patients** request their own visits,
**employees** keep every v1 feature and approve/override bookings, and **admins**
manage accounts, deletions and activity logs.

## Stack

| Layer      | Choice | Hosted on |
|------------|--------|-----------|
| Frontend   | React + Vite + TypeScript (TSX), React Router | **Vercel** |
| Backend    | Node.js + TypeScript, **Fastify**, Zod validation | **Render** (web service + cron job) |
| Database   | PostgreSQL, Drizzle ORM + drizzle-kit migrations | **Neon** |
| Email      | Brevo transactional API (email only, no SMS) | Brevo |
| Auth       | Email + password (argon2), **Google sign-in for patients** (free OAuth), JWT in httpOnly cookie | — |

Why a separate API on Render instead of Vercel functions: reminder dispatch needs a
scheduled job and long-lived DB pooling. Vercel serves the SPA and rewrites `/api/*`
to the Render URL so the browser sees one origin and cookies work.

Domain: not decided yet; the app runs on the default `*.vercel.app` URL. Until a domain
exists, Brevo sends from a single verified sender address. Switch to domain
authentication (SPF/DKIM) once a domain is set up — deliverability improves.

## Repository layout (monorepo)

```
/apps/web        React + Vite + TSX       → Vercel
/apps/api        Node + Fastify + TS      → Render
/packages/shared Zod schemas + types shared by web and api
/legacy          v1 FastAPI + JSX app, kept for reference until v2 parity
```

npm workspaces; one `tsconfig.base.json`; `.env` locally, dashboards in prod.

## Login pages

| Page | Who | Methods |
|------|-----|---------|
| `/login` | Patients | Email + password, Google, "Create account", forgot password |
| `/staff/login` | Employees **and** admins (same page; role decides where they land) | Email + password only |

A patient account cannot sign in on `/staff/login` and vice versa.

## Roles

### Patient
- **Self-registration** open to anyone (email/password or Google). Each new signup
  creates a "New patient" notification for employees.
- Profile: name, phone, DOB, email.
- **Request a booking**: choose **service** → **staff/doctor** → **available slot**
  (computed from that staff member's business hours, existing bookings, service duration).
  The request is created as **`pending`** and holds the slot until an employee acts.
- My appointments: pending / upcoming / past.
- Cancel or request a reschedule **up to 24h before** start; after that, they must call the clinic.
- Emails: request received, approved, declined, changed by clinic, cancelled by clinic,
  reminders (24h and 2h before).

### Employee (= all of v1, plus approval and override)
Everything in today's app is retained:
- Schedule page — day/week calendar, create appointment, detail modal, history timeline.
- Status lifecycle, reschedule with conflict + business-hours checks.
- Search, Reports (daily summary, utilisation, cancellations, CSV export).
- **Settings — staff, services, business hours (employees only; admins cannot edit these).**
- Reminders — due list, dispatch, reminder log.

New for employees:
- **Approval queue**: pending patient requests → approve or decline (with reason). Patient is emailed.
- Notification inbox: new patient registrations, new booking requests, patient cancellations.
- Book on behalf of a patient (linked to their account if one exists).
- **Override**: move a patient's appointment or **cancel** it, with a required reason;
  the patient is emailed. Employees cannot hard-delete anything.

### Admin
- Create employee and admin accounts (the only way those accounts exist);
  deactivate/reactivate users, reset their passwords.
- **Delete** records (users, patients, appointments) — the only role that can.
  Deletes are logged with a full snapshot so they can be audited.
- **Activity log**: logins (success/failure), logouts, and every create/update/
  cancel/delete/override, with before/after values, IP and user agent.
  Filter by user, role, action, entity, date; CSV export.
- **Clinic settings**: time zone (default `Asia/Manila`).
- Not allowed: editing services, staff or business hours.

## Appointment lifecycle

```
pending ──approve──▶ scheduled → confirmed → checked_in → completed
   │                     │            │
   └─decline─▶ declined  └──────┴──▶ cancelled / no_show
```
`pending` and `declined` are new; the rest are v1 statuses. Pending requests block
the slot so two patients cannot request the same time.

## Data model

New tables:
- `users` — id, email (unique), password_hash (nullable for Google-only), google_id,
  role (`patient|employee|admin`), is_active, created_at, last_login_at.
- `password_resets` — token hash, user_id, expires_at, used_at.
- `activity_log` — id, user_id, role, action, entity, entity_id, before (jsonb),
  after (jsonb), ip, user_agent, created_at. Supersedes v1 `audit_logs`.
- `notifications` — id, recipient (user or "all employees"), type, appointment_id,
  channel (`in_app|email`), status, read_at, sent_at. Supersedes v1 `reminder_logs`.
- `clinic_settings` — single row: timezone, reminder offsets (24h, 2h), cancel cutoff (24h).

Changed tables:
- `patients.user_id` (nullable FK) — walk-in patients still exist without an account.
- `staff.user_id` (nullable FK) — an employee login can map to a staff member.
- `appointments`: + `created_by`, `booked_via` (`patient|employee`),
  `decision_by`, `decision_reason`, `deleted_at`; new statuses `pending`, `declined`.
- All timestamps `timestamptz`; display converts to the clinic time zone.
- Overlap protection: Postgres **exclusion constraint** on
  `(staff_id, tstzrange(starts_at, ends_at))` for `pending|scheduled|confirmed|checked_in`,
  so the database itself refuses double-booking.

## Phases

**Phase 0 — Scaffold & deploy pipeline**
Monorepo, TS configs, ESLint/Prettier, Fastify app with `/health`, Vite app, Neon project
(dev + prod branches), Render service, Vercel project with `/api` rewrite, Brevo key,
`.env.example` files. Move v1 into `/legacy`.

**Phase 1 — Database & core API port**
Drizzle schema, migrations, demo seed (staff, services, patients, appointments, one admin,
one employee, one patient login). Port v1 endpoints to Fastify with the same behaviour;
port v1 tests to Vitest.

**Phase 2 — Auth & roles**
Patient register/login (+ Google), staff login page, logout, forgot/reset password,
`requireRole` guard, SPA route guards. Logins written to `activity_log`.

**Phase 3 — Employee app (parity + new flows)**
Port v1 pages to TSX. Add approval queue, notification inbox, override/cancel with reason.

**Phase 4 — Patient portal**
Service → staff → slot picker (`GET /availability?service&staff&date`), booking request,
my-appointments, 24h cancel/reschedule rule.

**Phase 5 — Notifications (Brevo)**
Email templates for every event above; Render cron sends 24h and 2h reminders;
every send recorded in `notifications`.

**Phase 6 — Admin console**
Account creation/management, hard delete, activity log viewer + export, time zone setting.

**Phase 7 — Hardening & launch**
Rate-limit auth routes, CORS/cookie config, validation everywhere, error monitoring,
Neon backups, deploy docs, custom domain + Brevo domain auth, retire `/legacy`.

## Decisions log

| # | Question | Decision |
|---|----------|----------|
| 1 | Patient booking | Needs employee approval; patient picks service, staff/doctor, time |
| 2 | Signup | Open for patients (notifies employees); employee/admin created by admin only |
| 3 | Patient cancel cutoff | 24h |
| 4 | Employee delete | Cancel only; hard delete is admin-only |
| 5 | Admin editing services/staff/hours | Not allowed |
| 6 | Reminders | 24h and 2h before |
| 7 | SMS | No |
| 8 | Data migration | Demo data only |
| 9 | Time zone | Admin-configurable, default Asia/Manila |
| 10 | Google sign-in | Yes, for patients (free) |
| 11 | Backend framework | Fastify |
| 12 | Domain | Later; use vercel.app + single-sender Brevo until then |
| 13 | Login pages | Patient page separate; employee + admin share one page |
