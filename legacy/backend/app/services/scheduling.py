"""Booking rules: slot conflicts and business-hours validation.

The overlap test is the heart of the system:

    new.starts_at < existing.ends_at AND new.ends_at > existing.starts_at

Strict inequalities on both sides, so back-to-back appointments (one ending
exactly as the next begins) do not collide. Rows whose status has released the
slot (cancelled, no_show) are excluded, which is what makes a cancelled slot
rebookable.
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.clock import clinic_now
from app.config import BOOKING_GRACE_MINUTES, MAX_BOOKING_DAYS_AHEAD
from app.models import Appointment, BusinessHour, Patient, Service, Staff
from app.models.appointment import BLOCKING_STATUSES
from app.models.business_hour import WEEKDAY_NAMES
from app.services.errors import (
    ConflictError,
    NotFoundError,
    OutsideBusinessHoursError,
    ValidationError,
)


# --------------------------------------------------------------------------
# Lookups
# --------------------------------------------------------------------------

def get_patient(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise NotFoundError(f"No patient with id {patient_id}.", patient_id=patient_id)
    return patient


def get_staff(db: Session, staff_id: int) -> Staff:
    staff = db.get(Staff, staff_id)
    if staff is None:
        raise NotFoundError(f"No staff member with id {staff_id}.", staff_id=staff_id)
    return staff


def get_service(db: Session, service_id: int) -> Service:
    service = db.get(Service, service_id)
    if service is None:
        raise NotFoundError(f"No service with id {service_id}.", service_id=service_id)
    return service


# Deactivation is not deletion. `get_staff` and `get_service` must keep
# returning inactive rows, because a doctor who has left still appears in their
# past appointments, in the audit history and in reports covering the period
# they worked. What deactivating means is "take no *new* bookings", so the
# check belongs at the moment of booking — and separately per entity, so that
# rescheduling can validate only what the caller is actually changing.

def assert_staff_bookable(staff: Staff) -> None:
    if not staff.is_active:
        raise ValidationError(
            f"{staff.full_name} is deactivated and is not taking new bookings.",
            staff_id=staff.id,
        )


def assert_service_bookable(service: Service) -> None:
    if not service.is_active:
        raise ValidationError(
            f"{service.name} is deactivated and cannot be booked.",
            service_id=service.id,
        )


def get_appointment(db: Session, appointment_id: int) -> Appointment:
    stmt = (
        select(Appointment)
        .options(
            joinedload(Appointment.patient),
            joinedload(Appointment.staff),
            joinedload(Appointment.service),
        )
        .where(Appointment.id == appointment_id)
    )
    appointment = db.execute(stmt).unique().scalar_one_or_none()
    if appointment is None:
        raise NotFoundError(
            f"No appointment with id {appointment_id}.", appointment_id=appointment_id
        )
    return appointment


# --------------------------------------------------------------------------
# Duration
# --------------------------------------------------------------------------

def compute_end(starts_at: datetime, service: Service) -> datetime:
    """Appointment length always comes from the service, never the caller."""
    return starts_at + timedelta(minutes=service.duration_minutes)


# --------------------------------------------------------------------------
# Conflict detection
# --------------------------------------------------------------------------

def find_conflicts(
    db: Session,
    *,
    staff_id: int,
    starts_at: datetime,
    ends_at: datetime,
    exclude_appointment_id: int | None = None,
) -> list[Appointment]:
    """Return appointments for this staff member overlapping the given window.

    `exclude_appointment_id` lets a reschedule ignore the row being moved,
    which would otherwise always conflict with itself.
    """
    stmt = (
        select(Appointment)
        .options(joinedload(Appointment.patient), joinedload(Appointment.service))
        .where(
            Appointment.staff_id == staff_id,
            Appointment.status.in_(BLOCKING_STATUSES),
            Appointment.starts_at < ends_at,
            Appointment.ends_at > starts_at,
        )
        .order_by(Appointment.starts_at)
    )
    if exclude_appointment_id is not None:
        stmt = stmt.where(Appointment.id != exclude_appointment_id)
    return list(db.execute(stmt).unique().scalars())


def assert_no_conflict(
    db: Session,
    *,
    staff_id: int,
    starts_at: datetime,
    ends_at: datetime,
    exclude_appointment_id: int | None = None,
) -> None:
    conflicts = find_conflicts(
        db,
        staff_id=staff_id,
        starts_at=starts_at,
        ends_at=ends_at,
        exclude_appointment_id=exclude_appointment_id,
    )
    if not conflicts:
        return

    clash = conflicts[0]
    raise ConflictError(
        f"{clash.staff.full_name if clash.staff else 'This staff member'} is already "
        f"booked from {clash.starts_at:%H:%M} to {clash.ends_at:%H:%M} "
        f"on {clash.starts_at:%d %b %Y}.",
        conflicting_appointment_ids=[c.id for c in conflicts],
        conflicting_appointments=[
            {
                "id": c.id,
                "starts_at": c.starts_at.isoformat(),
                "ends_at": c.ends_at.isoformat(),
                "status": c.status,
                "patient_name": c.patient.full_name if c.patient else None,
            }
            for c in conflicts
        ],
    )


# --------------------------------------------------------------------------
# Business hours
# --------------------------------------------------------------------------

def assert_within_business_hours(
    db: Session, *, staff_id: int, starts_at: datetime, ends_at: datetime
) -> None:
    """Require the whole appointment to fall inside one open window.

    A staff member with no configured hours is unrestricted, so hours are
    opt-in. Once any window exists, every weekday without one is closed.
    """
    windows = list(
        db.execute(
            select(BusinessHour).where(BusinessHour.staff_id == staff_id)
        ).scalars()
    )
    if not windows:
        return

    if starts_at.date() != ends_at.date():
        raise OutsideBusinessHoursError(
            "An appointment cannot run past midnight.",
            starts_at=starts_at.isoformat(),
            ends_at=ends_at.isoformat(),
        )

    weekday = starts_at.weekday()
    todays = [w for w in windows if w.weekday == weekday]
    day_name = WEEKDAY_NAMES[weekday]

    if not todays:
        open_days = sorted({WEEKDAY_NAMES[w.weekday] for w in windows})
        raise OutsideBusinessHoursError(
            f"{day_name} is not a working day for this staff member. "
            f"Open: {', '.join(open_days)}.",
            weekday=weekday,
            open_weekdays=sorted({w.weekday for w in windows}),
        )

    start_t, end_t = starts_at.time(), ends_at.time()
    if any(w.opens_at <= start_t and end_t <= w.closes_at for w in todays):
        return

    offered = ", ".join(
        f"{w.opens_at:%H:%M}-{w.closes_at:%H:%M}"
        for w in sorted(todays, key=lambda w: w.opens_at)
    )
    raise OutsideBusinessHoursError(
        f"{start_t:%H:%M}-{end_t:%H:%M} falls outside this staff member's "
        f"{day_name} hours ({offered}).",
        weekday=weekday,
        windows=[
            {"opens_at": w.opens_at.isoformat(), "closes_at": w.closes_at.isoformat()}
            for w in sorted(todays, key=lambda w: w.opens_at)
        ],
    )


# --------------------------------------------------------------------------
# Composite validation
# --------------------------------------------------------------------------

def assert_bookable_horizon(starts_at: datetime) -> None:
    """Bound a proposed start on both sides of now.

    The past bound is the one that matters in practice. Without it the system
    would accept a booking for last Thursday and then count it in utilisation
    and reminders as though it were real work the clinic had scheduled — a
    number nobody can act on, attached to time that has already gone. A visit
    that genuinely happened is recorded by booking it and completing it, not by
    back-dating a new appointment into a slot that no longer exists.
    """
    now = clinic_now()

    floor = now - timedelta(minutes=BOOKING_GRACE_MINUTES)
    if starts_at < floor:
        raise ValidationError(
            "Appointments cannot be booked in the past.",
            starts_at=starts_at.isoformat(),
            now=now.isoformat(),
        )

    limit = now + timedelta(days=MAX_BOOKING_DAYS_AHEAD)
    if starts_at > limit:
        raise ValidationError(
            f"Appointments cannot be booked more than "
            f"{MAX_BOOKING_DAYS_AHEAD} days ahead.",
            starts_at=starts_at.isoformat(),
        )


def validate_slot(
    db: Session,
    *,
    staff_id: int,
    starts_at: datetime,
    ends_at: datetime,
    exclude_appointment_id: int | None = None,
) -> None:
    """Run every booking rule for a proposed slot, cheapest check first."""
    assert_bookable_horizon(starts_at)
    assert_within_business_hours(
        db, staff_id=staff_id, starts_at=starts_at, ends_at=ends_at
    )
    assert_no_conflict(
        db,
        staff_id=staff_id,
        starts_at=starts_at,
        ends_at=ends_at,
        exclude_appointment_id=exclude_appointment_id,
    )
