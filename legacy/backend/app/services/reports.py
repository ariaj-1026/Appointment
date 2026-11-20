"""Schedule summaries, utilisation and cancellation reporting.

Two definitions drive every number here, and both are worth stating plainly
because reports are easy to read the wrong way:

**Booked minutes** count only appointments that still hold their slot
(scheduled, confirmed, completed). Cancelled and no-show appointments freed
their time, so counting them would overstate how busy a clinic was.

**Available minutes** come from configured business hours. A staff member with
no hours configured is unrestricted, which means their capacity is undefined
rather than zero — utilisation is reported as `null` for them, not 0% or 100%.
Reporting a number there would invent a denominator nobody set.
"""

from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Appointment, BusinessHour, Staff
from app.models.appointment import BLOCKING_STATUSES, AppointmentStatus

# Statuses that represent time the clinic lost rather than used.
LOST_STATUSES = (AppointmentStatus.CANCELLED.value, AppointmentStatus.NO_SHOW.value)


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    return datetime.combine(day, time.min), datetime.combine(
        day + timedelta(days=1), time.min
    )


def _date_range(date_from: date, date_to: date) -> list[date]:
    days = (date_to - date_from).days
    return [date_from + timedelta(days=i) for i in range(days + 1)]


def _hours_by_staff(db: Session) -> dict[int, list[BusinessHour]]:
    out: dict[int, list[BusinessHour]] = defaultdict(list)
    for window in db.execute(select(BusinessHour)).scalars():
        out[window.staff_id].append(window)
    return out


def _available_minutes(
    windows: list[BusinessHour], days: list[date]
) -> int | None:
    """Capacity across `days`, or None when no hours are configured."""
    if not windows:
        return None
    per_weekday: dict[int, int] = defaultdict(int)
    for w in windows:
        opens = w.opens_at.hour * 60 + w.opens_at.minute
        closes = w.closes_at.hour * 60 + w.closes_at.minute
        per_weekday[w.weekday] += closes - opens
    return sum(per_weekday.get(day.weekday(), 0) for day in days)


def _utilisation(booked: int, available: int | None) -> float | None:
    if available is None or available == 0:
        return None
    return round(booked / available * 100, 1)


def _fetch(db: Session, start: datetime, end: datetime, staff_id: int | None):
    stmt = (
        select(Appointment)
        .options(joinedload(Appointment.service), joinedload(Appointment.patient))
        .where(Appointment.starts_at >= start, Appointment.starts_at < end)
    )
    if staff_id is not None:
        stmt = stmt.where(Appointment.staff_id == staff_id)
    return list(db.execute(stmt).unique().scalars())


def _blank_counts() -> dict[str, int]:
    return {s.value: 0 for s in AppointmentStatus}


# --------------------------------------------------------------------------
# Daily summary
# --------------------------------------------------------------------------

def daily_summary(db: Session, *, day: date, staff_id: int | None = None) -> dict:
    """One day, broken down per staff member."""
    start, end = _day_bounds(day)
    appointments = _fetch(db, start, end, staff_id)
    hours = _hours_by_staff(db)

    staff_stmt = select(Staff).order_by(Staff.full_name)
    if staff_id is not None:
        staff_stmt = staff_stmt.where(Staff.id == staff_id)
    staff_rows = list(db.execute(staff_stmt).scalars())

    by_staff: dict[int, list[Appointment]] = defaultdict(list)
    for appointment in appointments:
        by_staff[appointment.staff_id].append(appointment)

    rows = []
    for member in staff_rows:
        mine = by_staff.get(member.id, [])
        counts = _blank_counts()
        booked = 0
        for a in mine:
            counts[a.status] += 1
            if a.status in BLOCKING_STATUSES:
                booked += a.duration_minutes

        available = _available_minutes(hours.get(member.id, []), [day])
        rows.append(
            {
                "staff_id": member.id,
                "staff_name": member.full_name,
                "role": member.role,
                "total": len(mine),
                "counts": counts,
                "booked_minutes": booked,
                "available_minutes": available,
                "free_minutes": None if available is None else max(available - booked, 0),
                "utilisation_pct": _utilisation(booked, available),
                "first_start": min((a.starts_at for a in mine), default=None),
                "last_end": max((a.ends_at for a in mine), default=None),
            }
        )

    totals_counts = _blank_counts()
    for a in appointments:
        totals_counts[a.status] += 1
    total_booked = sum(r["booked_minutes"] for r in rows)
    known_available = [r["available_minutes"] for r in rows if r["available_minutes"] is not None]
    total_available = sum(known_available) if known_available else None

    return {
        "date": day,
        "staff": rows,
        "totals": {
            "total": len(appointments),
            "counts": totals_counts,
            "booked_minutes": total_booked,
            "available_minutes": total_available,
            "utilisation_pct": _utilisation(total_booked, total_available),
            # True when at least one staff member has no hours configured, so
            # the totals above cover only part of the clinic.
            "partial_capacity": len(known_available) < len(rows),
        },
    }


# --------------------------------------------------------------------------
# Utilisation over a range
# --------------------------------------------------------------------------

def utilisation(
    db: Session, *, date_from: date, date_to: date, staff_id: int | None = None
) -> dict:
    days = _date_range(date_from, date_to)
    start = datetime.combine(date_from, time.min)
    end = datetime.combine(date_to + timedelta(days=1), time.min)

    appointments = _fetch(db, start, end, staff_id)
    hours = _hours_by_staff(db)

    staff_stmt = select(Staff).order_by(Staff.full_name)
    if staff_id is not None:
        staff_stmt = staff_stmt.where(Staff.id == staff_id)
    staff_rows = list(db.execute(staff_stmt).scalars())

    booked_by_staff: dict[int, int] = defaultdict(int)
    count_by_staff: dict[int, int] = defaultdict(int)
    for a in appointments:
        count_by_staff[a.staff_id] += 1
        if a.status in BLOCKING_STATUSES:
            booked_by_staff[a.staff_id] += a.duration_minutes

    rows = []
    for member in staff_rows:
        booked = booked_by_staff.get(member.id, 0)
        available = _available_minutes(hours.get(member.id, []), days)
        rows.append(
            {
                "staff_id": member.id,
                "staff_name": member.full_name,
                "role": member.role,
                "appointments": count_by_staff.get(member.id, 0),
                "booked_minutes": booked,
                "available_minutes": available,
                "free_minutes": None if available is None else max(available - booked, 0),
                "utilisation_pct": _utilisation(booked, available),
            }
        )

    total_booked = sum(r["booked_minutes"] for r in rows)
    known = [r["available_minutes"] for r in rows if r["available_minutes"] is not None]
    total_available = sum(known) if known else None

    return {
        "date_from": date_from,
        "date_to": date_to,
        "days": len(days),
        "staff": rows,
        "totals": {
            "appointments": len(appointments),
            "booked_minutes": total_booked,
            "available_minutes": total_available,
            "utilisation_pct": _utilisation(total_booked, total_available),
            "partial_capacity": len(known) < len(rows),
        },
    }


# --------------------------------------------------------------------------
# Cancellations
# --------------------------------------------------------------------------

def cancellations(
    db: Session, *, date_from: date, date_to: date, staff_id: int | None = None
) -> dict:
    """Cancellation and no-show rates, with the lost time they represent."""
    start = datetime.combine(date_from, time.min)
    end = datetime.combine(date_to + timedelta(days=1), time.min)
    appointments = _fetch(db, start, end, staff_id)

    total = len(appointments)
    cancelled = [a for a in appointments if a.status == AppointmentStatus.CANCELLED.value]
    no_shows = [a for a in appointments if a.status == AppointmentStatus.NO_SHOW.value]
    lost_minutes = sum(a.duration_minutes for a in cancelled + no_shows)

    def _rate(n: int) -> float | None:
        return None if total == 0 else round(n / total * 100, 1)

    by_staff: dict[int, dict] = {}
    for a in appointments:
        row = by_staff.setdefault(
            a.staff_id,
            {
                "staff_id": a.staff_id,
                "staff_name": a.staff.full_name,
                "total": 0,
                "cancelled": 0,
                "no_show": 0,
                "lost_minutes": 0,
            },
        )
        row["total"] += 1
        if a.status in LOST_STATUSES:
            key = "cancelled" if a.status == AppointmentStatus.CANCELLED.value else "no_show"
            row[key] += 1
            row["lost_minutes"] += a.duration_minutes
    for row in by_staff.values():
        lost = row["cancelled"] + row["no_show"]
        row["rate_pct"] = round(lost / row["total"] * 100, 1) if row["total"] else None

    by_service: dict[int, dict] = {}
    for a in appointments:
        row = by_service.setdefault(
            a.service_id,
            {
                "service_id": a.service_id,
                "service_name": a.service.name,
                "total": 0,
                "cancelled": 0,
                "no_show": 0,
            },
        )
        row["total"] += 1
        if a.status == AppointmentStatus.CANCELLED.value:
            row["cancelled"] += 1
        elif a.status == AppointmentStatus.NO_SHOW.value:
            row["no_show"] += 1
    for row in by_service.values():
        lost = row["cancelled"] + row["no_show"]
        row["rate_pct"] = round(lost / row["total"] * 100, 1) if row["total"] else None

    recent = sorted(cancelled + no_shows, key=lambda a: a.starts_at, reverse=True)[:50]

    return {
        "date_from": date_from,
        "date_to": date_to,
        "totals": {
            "total": total,
            "cancelled": len(cancelled),
            "no_show": len(no_shows),
            "lost": len(cancelled) + len(no_shows),
            "cancellation_rate_pct": _rate(len(cancelled)),
            "no_show_rate_pct": _rate(len(no_shows)),
            "combined_rate_pct": _rate(len(cancelled) + len(no_shows)),
            "lost_minutes": lost_minutes,
        },
        "by_staff": sorted(by_staff.values(), key=lambda r: -r["lost_minutes"]),
        "by_service": sorted(by_service.values(), key=lambda r: -r["total"]),
        "recent": [
            {
                "id": a.id,
                "starts_at": a.starts_at,
                "status": a.status,
                "patient_name": a.patient.full_name,
                "staff_name": a.staff.full_name,
                "service_name": a.service.name,
                "duration_minutes": a.duration_minutes,
                "reason": a.reason,
            }
            for a in recent
        ],
    }
