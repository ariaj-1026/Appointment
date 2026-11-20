from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import AppointmentDetail
from app.schemas.audit import ReminderLogRead
from app.services import reminders
from app.services.errors import ValidationError
from app.services.scheduling import get_appointment

router = APIRouter(prefix="/api/reminders", tags=["reminders"])


@router.get("/due", response_model=list[AppointmentDetail])
def due_reminders(
    within_hours: int = Query(default=24, ge=1, le=720),
    channel: str = Query(default="console"),
    db: Session = Depends(get_db),
):
    """Upcoming appointments that have not had a reminder sent yet."""
    return reminders.find_due(db, within_hours=within_hours, channel=channel)


@router.post("/dispatch")
def dispatch_reminders(
    within_hours: int = Query(default=24, ge=1, le=720),
    sender: str | None = Query(default=None, description="console or null"),
    db: Session = Depends(get_db),
):
    """Send every due reminder and log each attempt."""
    try:
        chosen = reminders.get_sender(sender)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return reminders.dispatch(db, within_hours=within_hours, sender=chosen)


@router.get("/log", response_model=list[ReminderLogRead])
def reminder_log(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    from app.models import ReminderLog

    stmt = select(ReminderLog).order_by(ReminderLog.sent_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars())


@router.get("/log/{appointment_id}", response_model=list[ReminderLogRead])
def reminder_log_for(appointment_id: int, db: Session = Depends(get_db)):
    from app.models import ReminderLog

    get_appointment(db, appointment_id)
    stmt = (
        select(ReminderLog)
        .where(ReminderLog.appointment_id == appointment_id)
        .order_by(ReminderLog.sent_at)
    )
    return list(db.execute(stmt).scalars())
