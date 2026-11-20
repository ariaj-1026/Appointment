"""Writing and reading appointment history.

These helpers add an AuditLog row to the session but never commit: the caller
commits the business change and its audit record together, so a failed booking
cannot leave a log entry claiming it happened.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Appointment, AuditLog
from app.models.appointment import AppointmentStatus
from app.models.audit import AuditAction


def record_created(db: Session, appointment: Appointment) -> AuditLog:
    entry = AuditLog(
        appointment_id=appointment.id,
        action=AuditAction.CREATED.value,
        to_status=appointment.status,
        to_starts_at=appointment.starts_at,
        to_staff_id=appointment.staff_id,
    )
    db.add(entry)
    return entry


def record_status_change(
    db: Session,
    appointment: Appointment,
    *,
    from_status: AppointmentStatus,
    to_status: AppointmentStatus,
    note: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        appointment_id=appointment.id,
        action=AuditAction.STATUS_CHANGED.value,
        from_status=from_status.value,
        to_status=to_status.value,
        note=note,
    )
    db.add(entry)
    return entry


def record_rescheduled(
    db: Session,
    appointment: Appointment,
    *,
    from_starts_at,
    to_starts_at,
    from_staff_id: int,
    to_staff_id: int,
    note: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        appointment_id=appointment.id,
        action=AuditAction.RESCHEDULED.value,
        from_starts_at=from_starts_at,
        to_starts_at=to_starts_at,
        from_staff_id=from_staff_id,
        to_staff_id=to_staff_id,
        note=note,
    )
    db.add(entry)
    return entry


def history_for(db: Session, appointment_id: int) -> list[AuditLog]:
    stmt = (
        select(AuditLog)
        .where(AuditLog.appointment_id == appointment_id)
        .order_by(AuditLog.changed_at, AuditLog.id)
    )
    return list(db.execute(stmt).scalars())
