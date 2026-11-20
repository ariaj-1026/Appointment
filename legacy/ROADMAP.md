# Appointment Scheduling System — Roadmap

A clinic-facing appointment scheduler. Front desk staff register patient visits,
the system refuses double-bookings, and appointment status is tracked through its
lifecycle.

## Stack decisions

| Area      | Choice                        | Why |
|-----------|-------------------------------|-----|
| Backend   | Python + FastAPI              | JSON API, automatic OpenAPI docs at `/docs`, async-ready |
| Database  | SQLite via SQLAlchemy         | Single file, stdlib driver, real SQL constraints for conflict checks |
| Frontend  | React + Vite                  | SPA consuming the JSON API |
| Styling   | Plain CSS with custom properties | No framework needed at this scale |
| Font      | Inter (Google Fonts)          | Per design spec |
| Dates     | Naive local clinic time throughout | See the note below |

Two processes in development: `uvicorn` on `:8000`, Vite dev server on `:5173`
proxying `/api` to the backend.

### Decisions changed during Phase 0–2 implementation

Three things were planned one way above and built another. Each is a
single-clinic simplification; revisit if that assumption breaks.

1. **Time is stored naive and local, not UTC.** Business hours are inherently
   local ("Monday 09:00"), so storing UTC would mean converting on every hours
   check, for no gain while one clinic sits in one timezone. `datetime-local`
   inputs produce exactly this format, so nothing converts anywhere. If the
   system ever spans timezones, this is the thing to change first.
2. **`Base.metadata.create_all()` instead of Alembic.** The schema was still
   moving and SQLite is disposable. Introduce migrations before Phase 3 adds
   `AuditLog`, since by then there is history worth not dropping.
3. **No database-level overlap constraint.** SQLite has no exclusion
   constraints, so genuine overlap cannot be expressed in DDL. There is a
   partial unique index on `(staff_id, starts_at)` for blocking statuses, which
   catches exact duplicates cheaply, and the real guard is the service layer in
   `app/services/scheduling.py`. With one API process and SQLite's write lock
   this is sound; a concurrent multi-process deployment would want Postgres and
   an `EXCLUDE USING gist` constraint.

## Design system

Yellow and white, with near-black text for contrast.

```
--color-bg:          #FFFFFF   page background
--color-surface:     #FFFDF5   cards, panels
--color-primary:     #F5C518   primary actions, active states
--color-primary-dark:#D4A70C   hover, pressed
--color-accent:      #FFF3C4   selected slots, subtle fills
--color-border:      #E8E3D3   dividers, input outlines
--color-text:        #1A1A1A   body text
--color-text-muted:  #6B6B6B   labels, secondary text
```

Status colors sit outside the yellow palette so they stay distinguishable:
scheduled `#F5C518`, confirmed `#2E7D32`, completed `#6B6B6B`,
cancelled `#C62828`, no-show `#E65100`.

Accessibility note: yellow on white fails contrast for text. Yellow is for
fills, borders and backgrounds only — any text sitting on yellow uses
`--color-text`, never white.

## Data model

```
Patient      id, first_name, last_name, phone, email, date_of_birth, notes
Staff        id, full_name, role, is_active
Service      id, name, duration_minutes, description, is_active
Appointment  id, patient_id, staff_id, service_id,
             starts_at, ends_at, status, reason, created_at, updated_at
BusinessHour staff_id, weekday, opens_at, closes_at   (closed if absent)
AuditLog     id, appointment_id, action, from_status, to_status,
             changed_at, note
```

`ends_at` is derived from `starts_at + service.duration_minutes` and stored, so
overlap queries are a single comparison.

**Status lifecycle:** `scheduled → confirmed → completed`, with `cancelled` and
`no_show` as terminal states reachable from `scheduled` or `confirmed`.
Transitions out of a terminal state are rejected.

**Conflict rule:** two appointments for the same staff member conflict when
`new.starts_at < existing.ends_at AND new.ends_at > existing.starts_at`, ignoring
rows in `cancelled` or `no_show`. Enforced in a service-layer check and backed by
a database constraint.

---

## Phase 0 — Scaffolding ✅ done

- `backend/`: FastAPI app factory, config, SQLAlchemy session, Alembic migrations
- `frontend/`: Vite + React, Inter loaded, CSS custom properties from above
- `requirements.txt`, `.gitignore` (`*.db`, `__pycache__/`, `node_modules/`, `.venv/`)
- Health endpoint `GET /api/health` wired through to a page that displays it

Done when: both servers start and the frontend reads something from the backend.

## Phase 1 — Minimal functional requirements ✅ done

Covers the three required behaviours.

- `Patient` and `Appointment` models and migrations
- `POST /api/appointments` — register, rejecting overlaps with `409 Conflict`
- `GET /api/appointments` — list, filterable by date
- `PATCH /api/appointments/{id}/status` — update status, validating the transition
- UI: appointment list, "New appointment" form, status dropdown per row
- Tests: overlap detected, back-to-back booking allowed, cancelled slot reusable,
  illegal transition rejected

Done when: a double-booking is impossible through the UI and status changes stick.

## Phase 2 — Intermediate extensions ✅ done

- `Staff`, `Service`, `BusinessHour` models; duration drives `ends_at`
- Conflict checking becomes per-staff rather than global
- Business-hours validation — bookings outside a staff member's hours rejected
- `GET /api/appointments/search` — by patient name, phone, staff, service,
  status, date range
- `PATCH /api/appointments/{id}/reschedule` — re-runs conflict and hours checks
- UI: day/week calendar grid per staff member, search bar with filters,
  reschedule dialog, service and staff management pages

Done when: each staff member has an independent schedule bounded by their hours,
and any booking can be found and moved.

Built beyond the plan: inline new-patient registration in the booking form
(the front desk usually meets the patient and the booking at the same moment),
and a seed script, which Phase 4 had listed.

The **week view** was deferred from this phase and built in Phase 4: it has to
drop the per-staff columns to fit seven days, making it a separate component
rather than a variant of the day grid.

## Phase 3 — Advanced extensions ✅ done

- `AuditLog` written on every create, status change and reschedule
- Appointment detail view showing full history
- `GET /api/reports/daily-summary` — appointments per staff, booked vs. free time
- `GET /api/reports/utilization` — booked minutes ÷ available minutes, by staff
  and date range
- `GET /api/reports/cancellations` — cancellation and no-show rate, with reasons
- Reminders: due-reminder list and a dispatch log, printed to console behind a
  pluggable sender so email or SMS can drop in later
- UI: reports dashboard with the above, plus CSV export

Done when: every appointment's history is reconstructable and utilization is
reportable for any date range.

Alembic arrived here as planned, with `0001` capturing the phase 0–2 schema so
an existing database adopts it via `alembic stamp 0001` rather than being
rebuilt, and `0002` adding the two new tables. The app migrates to head on
startup, which suits one process and one SQLite file; a multi-replica
deployment should migrate as its own deploy step instead.

Two reporting decisions worth knowing when reading the numbers:

- **Cancelled and no-show time is not booked time.** Those slots were given
  back, so counting them would overstate how busy the clinic was. A *completed*
  appointment still counts — the visit happened.
- **Unconfigured hours mean undefined capacity, not zero.** A staff member with
  no business hours is unrestricted, so utilisation is reported as `null`
  rather than 0% or 100%, and clinic-wide totals carry a `partial_capacity`
  flag when anyone is missing hours. Inventing a denominator would be worse
  than admitting there isn't one.

Built beyond the plan: a reason prompt when cancelling or marking a no-show,
which flows into both the history and the cancellation report; a reminders tab
showing what is due and what was dispatched; and seeded history, so the
timeline and reports have real data on a fresh install.

Not built: the **chart** some of these reports might suggest. The cancelled
vs. no-show pair measures ΔE 10.3 for normal colour vision — below the 15
floor — so a two-colour stacked bar would be unreadable for everyone, not just
colourblind readers. The breakdown encodes by column and number instead.
Utilisation does get bars, in `#A37F06` rather than the brand yellow, which
measures 1.59:1 against white and fails as a data mark.

## Phase 4 — Polish ✅ done

- Seed script with realistic clinic data for demos *(done in Phase 2)*
- Empty, loading and error states on every view
- Keyboard navigation through the calendar grid; focus-visible rings
- README with setup and run instructions *(done in Phase 2)*
- Contrast audit against the accessibility note above

Plus the two items deferred earlier: the **week view** and the **split-shift
hours editor**.

**Keyboard navigation.** The day grid was forty tab stops; it is now one. A
roving tabindex keeps exactly one cell focusable, arrows move between cells,
Home/End travel along a row, Ctrl+Home/End to the grid's corners, and
Enter/Space either opens the appointment in the cell or books the empty slot.
Closed cells refuse activation, matching the backend. The grid carries
`role="grid"` with `role="row"`/`role="gridcell"` children, and each cell's
`aria-label` names the time, the staff member and what is there.

**Focus ring: `--color-primary-darker`, not `--color-primary-dark`.** The plan
above named the latter, but it measures 2.25:1 against white where WCAG 1.4.11
wants 3:1 for a focus indicator. `--color-primary-darker` measures 3.75:1.

**Contrast audit.** `npm run contrast` checks all 31 text and UI pairs the app
renders, so the audit is reproducible rather than a one-time claim. It found
two real failures, both now fixed:

- The no-show badge, `#E65100` on `#FFF3E0`, measured 3.46:1 against the 4.5
  needed for text. Now `#C24300` at 4.67:1.
- Input and secondary-button borders used `--color-border-strong` at 1.67:1.
  These controls sit white-on-white, so the border is the only thing marking
  where they are — WCAG 1.4.11 territory. Added `--color-border-input` at
  3.27:1, leaving the old token for decorative rules.

**Empty states.** Audited by pointing the dev server at a blank database
(`VITE_API_TARGET` now makes that a one-liner). Three screens were *confidently
wrong* on a fresh install rather than merely bare: Find blamed the user's
filters when no appointments existed at all; Utilisation rendered empty tables
instead of saying there were no staff; and Reminders claimed "every appointment
has had its reminder" when there were no appointments. A misleading message is
worse than a missing one, so all three now distinguish "nothing matched" from
"nothing exists yet".

**Week view.** Seven days for one staff member, chosen above the grid. It
cannot also carry a column per staff member — that is the trade, and the UI
says so rather than leaving it to be discovered. Clicking a date opens that day
in the detailed view.

**Split-shift hours editor.** Each weekday now holds a list of windows instead
of one pair, so a lunch break round-trips. Previously the editor collapsed a
split shift to its outer bounds, meaning anyone who opened the hours page and
pressed Save silently deleted the break. Overlapping windows are caught inline
and block the save before the server has to reject them.

---

## Deliberately out of scope

Patient self-service booking, authentication and user accounts, payments or
billing, multi-clinic tenancy, recurring appointments. Each is a reasonable
follow-on; none is needed for the requirements above.

## Suggested directory layout

```
backend/
  app/
    main.py            app factory, router registration
    config.py
    database.py        engine, session
    models/            SQLAlchemy models
    schemas/           Pydantic request/response models
    routers/           appointments, patients, staff, services, reports
    services/          conflict checking, status machine, reports
  migrations/          Alembic
  tests/
frontend/
  src/
    main.jsx
    api/               fetch wrappers
    components/        AppointmentForm, Calendar, StatusBadge, ...
    pages/             Schedule, Search, Reports, Settings
    styles/            tokens.css, base.css
  index.html
```
