# Appointment Scheduling System

A clinic appointment scheduler. Front desk staff register patient visits, the
system refuses double-bookings and out-of-hours slots, and every appointment is
tracked through its lifecycle.

FastAPI + SQLite on the backend, React + Vite on the frontend.

See [ROADMAP.md](ROADMAP.md) for the design decisions and remaining phases.

## Setup

Requires Python 3.11+ and Node 18+.

```bash
# Backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..
```

## Running

Two processes, in two terminals.

**Terminal 1 — API on :8000**

```bash
cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — UI on :5173**

```bash
cd frontend
npm run dev
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api` to the
backend, so the browser stays on one origin. If port 5173 is busy Vite picks
the next free one — check its output. To point the UI at a different API, set
`VITE_API_TARGET=http://127.0.0.1:8001`.

Interactive API docs are at http://localhost:8000/docs.

## Demo data

```bash
cd backend
../.venv/bin/python seed.py          # 3 staff, 5 services, 6 patients, 14 appointments
../.venv/bin/python seed.py --reset  # wipe everything first (asks to confirm)
```

The database is a single file, `backend/clinic.db`, created on first run and
ignored by git. Delete it to start over.

## Database migrations

The app runs `alembic upgrade head` on startup, so normal use needs no migrate
step. To drive it by hand:

```bash
cd backend
../.venv/bin/python -m alembic upgrade head     # apply
../.venv/bin/python -m alembic downgrade 0001   # roll back phase 3
../.venv/bin/python -m alembic current          # which revision am I on
```

A database created before migrations existed is detected and stamped at `0001`
automatically, so it upgrades in place instead of being rebuilt.

Auto-migrating on startup suits one process and one SQLite file. For a
multi-replica deployment, set `AUTO_MIGRATE=0` and migrate as its own deploy
step so replicas cannot race each other.

## Tests

```bash
cd backend
../.venv/bin/python -m pytest
```

88 tests cover the booking rules: overlap detection, back-to-back bookings,
per-staff isolation, rebooking cancelled slots, the status machine, business
hours including split shifts, rescheduling, search, audit history, the three
reports and reminder dispatch.

## How it works

**Conflict detection.** Two appointments for the same staff member overlap when

```
new.starts_at < existing.ends_at AND new.ends_at > existing.starts_at
```

Strict inequalities on both sides, so back-to-back appointments (one ending
exactly as the next begins) do not collide. Cancelled and no-show appointments
are excluded, which is what frees their slot for rebooking. A completed one is
not excluded — a finished visit still happened, so its slot stays taken.

Appointment length always comes from the service, never the caller: `ends_at`
is computed at booking time and stored, making the overlap test a single
comparison with no join.

**Business hours.** Each staff member has zero or more open windows per
weekday. A staff member with no windows at all is unrestricted, so hours are
opt-in; once any window exists, a weekday without one is closed. Several
windows on one day express a split shift, and the gap between them is closed.
The calendar hatches closed cells, so the UI shows the same rule the API
enforces.

**Status lifecycle.**

```
scheduled ──► confirmed ──► completed
    │             │
    └──► cancelled / no_show ◄──┘
```

A walk-in may go straight from scheduled to completed. Terminal statuses accept
no further transitions, so a cancelled appointment cannot be quietly revived —
book a new one. The UI offers only the legal next moves rather than letting the
user attempt one that will be rejected.

**Errors.** Rule violations come back as `{code, message, ...detail}` with a
fitting status: `409` for a slot conflict (listing what clashes), `422` for
out-of-hours or an illegal status move, `404` for a missing record.

**History.** Every create, status change and reschedule writes an `audit_logs`
row in the same transaction as the change itself, so a rejected booking cannot
leave a log entry claiming it happened. The rows are append-only; the
appointment detail view renders them as a timeline.

**Reports.** Three of them, at `/api/reports/{daily-summary,utilisation,cancellations}`.
Two definitions drive every number:

- *Booked minutes* count only appointments that still hold their slot.
  Cancelled and no-show time was given back, so counting it would overstate how
  busy the clinic was. Completed time still counts — the visit happened.
- *Available minutes* come from configured business hours. A staff member
  without hours is unrestricted, so their capacity is **undefined, not zero**:
  utilisation reports `null` for them, and clinic totals carry a
  `partial_capacity` flag. The UI shows "not set" rather than 0%.

**Reminders.** `GET /api/reminders/due` lists upcoming appointments that are
still active and have not been reminded; `POST /api/reminders/dispatch` sends
them. Delivery sits behind a `ReminderSender` protocol — `ConsoleSender` ships,
and email or SMS drops in without touching the sweep. Each attempt is logged,
and a successful log row removes the appointment from the due list, so
re-running dispatch does not pester the same patient twice. A *failed* attempt
leaves it due, so a transient outage retries on the next sweep.

## Layout

```
backend/
  app/
    main.py            app factory, CORS, error handlers
    config.py          env-driven settings
    database.py        engine, session, create_all
    migrate.py         programmatic Alembic runner
    models/            SQLAlchemy models
    schemas/           Pydantic request/response models
    routers/           appointments, patients, staff, services, reports, reminders
    services/          scheduling rules, status machine, audit, reports, reminders
  migrations/          Alembic environment and versions
  tests/
  seed.py
frontend/
  src/
    api/client.js      fetch wrapper, structured errors
    lib/datetime.js    local-time helpers
    lib/csv.js         CSV export
    components/        calendar, forms, modal, badges, bars, timeline
    pages/             Schedule, Search, Reports, Settings
    styles/            tokens.css, base.css
```

## Using it

**Schedule** opens on a day grid with a column per staff member. Closed hours
are hatched; click an empty slot to book, or an appointment to open it. The
**Week** toggle shows seven days for one staff member — a week cannot also fit
a column each, so that is the trade.

The grid is keyboard-navigable as one tab stop, not forty: Tab into it, then

| Key | Does |
|---|---|
| arrows | move between cells |
| Home / End | first or last column in the row |
| Ctrl+Home / Ctrl+End | first or last cell in the grid |
| PageUp / PageDown | jump four rows |
| Enter / Space | open the appointment, or book the empty slot |

**Find** searches by patient name or phone, staff, service, status and date
range. **Reports** holds the daily summary, utilisation, cancellations and
reminder dispatch, each exportable as CSV. **Settings** manages staff, services
and weekly hours — add a second window to a day for a split shift, and the gap
between windows is closed.

## Design

Yellow and white, Inter throughout. Tokens live in
[frontend/src/styles/tokens.css](frontend/src/styles/tokens.css).

```bash
cd frontend && npm run contrast   # audit every text and UI colour pair
```

Yellow (`#F5C518`) against white fails contrast for text, so yellow is used for
fills, borders and backgrounds only — text on yellow is near-black, never
white. Status colours sit outside the yellow range so they stay distinguishable
from each other and from the brand colour.

`npm run contrast` checks all 31 pairs the app actually renders against the
threshold that applies to each — 4.5:1 for body text, 3:1 for focus rings and
control borders. Two of its findings are baked into the tokens: the no-show
badge is `#C24300` rather than `#E65100` (3.46:1 failed for text), and form
controls use `--color-border-input` rather than `--color-border-strong`, which
measures 1.67:1 and is fine only for decorative rules.

Two measured constraints shape the charts, both verified rather than guessed:

- Brand yellow is **not** used for data marks. It measures 1.59:1 against white
  and sits outside the readable lightness band, so bars use `--mark-primary`
  (`#A37F06`), which passes both.
- There is **no** two-colour cancelled/no-show chart. That pair measures ΔE
  10.3 for normal colour vision, below the 15 floor, meaning full-colour
  readers cannot reliably tell them apart either. The cancellation breakdown
  encodes by column and number instead, and every chart has a table beneath it
  carrying the same figures.
