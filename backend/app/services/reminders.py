"""Appointment reminders.

Delivery sits behind a `ReminderSender` protocol so email or SMS can drop in
later without touching the sweep logic. The console sender prints, which is
what Phase 3 ships; `REMINDER_SENDER=null` disables output for tests.

Each attempt is logged, and the due query excludes appointments that already
have a successful log row for the same channel, so re-running dispatch does
not pester the same patient twice. A failed attempt is left due, so a transient
outage retries on the next sweep.
"""

from datetime import datetime, timedelta
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.config import REMINDER_LOOKAHEAD_HOURS, REMINDER_SENDER
from app.models import Appointment, ReminderLog
from app.models.appointment import AppointmentStatus
from app.models.reminder import ReminderStatus

# Only appointments the patient is still expected at are worth reminding about.
REMINDABLE_STATUSES = (
    AppointmentStatus.SCHEDULED.value,
    AppointmentStatus.CONFIRMED.value,
)


class ReminderSender(Protocol):
    channel: str

    def send(self, appointment: Appointment, message: str) -> str:
        """Deliver, returning a short detail string. Raise to signal failure."""
        ...


class ConsoleSender:
    """Prints the reminder. The default, and what the demo uses."""

    channel = "console"

    def send(self, appointment: Appointment, message: str) -> str:
        print(f"[reminder] {message}", flush=True)
        return "printed to stdout"


class NullSender:
    """Records the attempt without emitting anything. Used by tests."""

    channel = "null"

    def send(self, appointment: Appointment, message: str) -> str:
        return "suppressed"


_SENDERS: dict[str, type] = {
    "console": ConsoleSender,
    "null": NullSender,
}


def get_sender(name: str | None = None) -> ReminderSender:
    key = (name or REMINDER_SENDER).lower()
    sender_cls = _SENDERS.get(key)
    if sender_cls is None:
        raise ValueError(
            f"Unknown reminder sender {key!r}. Available: {', '.join(sorted(_SENDERS))}."
        )
    return sender_cls()


def build_message(appointment: Appointment) -> str:
    patient = appointment.patient
    return (
        f"Reminder for {patient.full_name} ({patient.phone}): "
        f"{appointment.service.name} with {appointment.staff.full_name} on "
        f"{appointment.starts_at:%a %d %b} at {appointment.starts_at:%H:%M}."
    )


def find_due(
    db: Session,
    *,
    within_hours: int | None = None,
    now: datetime | None = None,
    channel: str = "console",
) -> list[Appointment]:
    """Appointments starting inside the window that have not been reminded.

    Past appointments are excluded: a reminder for a visit that has already
    begun is noise, not a service.
    """
    now = now or datetime.now()
    hours = within_hours if within_hours is not None else REMINDER_LOOKAHEAD_HOURS
    horizon = now + timedelta(hours=hours)

    already_sent = (
        select(ReminderLog.appointment_id)
        .where(
            ReminderLog.channel == channel,
            ReminderLog.status == ReminderStatus.SENT.value,
        )
        .scalar_subquery()
    )

    stmt = (
        select(Appointment)
        .options(
            joinedload(Appointment.patient),
            joinedload(Appointment.staff),
            joinedload(Appointment.service),
        )
        .where(
            Appointment.status.in_(REMINDABLE_STATUSES),
            Appointment.starts_at >= now,
            Appointment.starts_at <= horizon,
            Appointment.id.not_in(already_sent),
        )
        .order_by(Appointment.starts_at)
    )
    return list(db.execute(stmt).unique().scalars())


def dispatch(
    db: Session,
    *,
    within_hours: int | None = None,
    now: datetime | None = None,
    sender: ReminderSender | None = None,
) -> dict:
    """Send every due reminder, logging each attempt."""
    sender = sender or get_sender()
    due = find_due(db, within_hours=within_hours, now=now, channel=sender.channel)

    sent, failed = 0, 0
    results = []
    for appointment in due:
        message = build_message(appointment)
        try:
            detail = sender.send(appointment, message)
            status = ReminderStatus.SENT
            sent += 1
        except Exception as exc:  # a sender failing must not abort the sweep
            detail = f"{type(exc).__name__}: {exc}"
            status = ReminderStatus.FAILED
            failed += 1

        db.add(
            ReminderLog(
                appointment_id=appointment.id,
                channel=sender.channel,
                status=status.value,
                recipient=appointment.patient.email or appointment.patient.phone,
                detail=detail,
            )
        )
        results.append(
            {
                "appointment_id": appointment.id,
                "patient_name": appointment.patient.full_name,
                "starts_at": appointment.starts_at,
                "status": status.value,
                "detail": detail,
            }
        )

    db.commit()
    return {
        "channel": sender.channel,
        "considered": len(due),
        "sent": sent,
        "failed": failed,
        "results": results,
    }
