from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Appointment, Patient
from app.models.appointment import AppointmentStatus
from app.schemas import (
    AppointmentCreate,
    AppointmentDetail,
    AppointmentReschedule,
    AppointmentStatusUpdate,
)
from app.schemas.audit import AuditLogRead
from app.services import audit, status as status_machine
from app.services.scheduling import (
    assert_service_bookable,
    assert_staff_bookable,
    compute_end,
    get_appointment,
    get_patient,
    get_service,
    get_staff,
    validate_slot,
)

router = APIRouter(prefix="/api/appointments", tags=["appointments"])

_LOADED = (
    joinedload(Appointment.patient),
    joinedload(Appointment.staff),
    joinedload(Appointment.service),
)


def _base_query():
    return select(Appointment).options(*_LOADED)


# --------------------------------------------------------------------------
# Read
# --------------------------------------------------------------------------

@router.get("", response_model=list[AppointmentDetail])
def list_appointments(
    on: date | None = Query(default=None, description="Single day, YYYY-MM-DD"),
    staff_id: int | None = None,
    db: Session = Depends(get_db),
):
    stmt = _base_query().order_by(Appointment.starts_at)
    if on is not None:
        stmt = stmt.where(
            Appointment.starts_at >= datetime.combine(on, time.min),
            Appointment.starts_at < datetime.combine(on + timedelta(days=1), time.min),
        )
    if staff_id is not None:
        stmt = stmt.where(Appointment.staff_id == staff_id)
    return list(db.execute(stmt).unique().scalars())


@router.get("/search", response_model=list[AppointmentDetail])
def search_appointments(
    q: str | None = Query(default=None, description="Patient name or phone"),
    staff_id: int | None = None,
    service_id: int | None = None,
    appointment_status: AppointmentStatus | None = Query(default=None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = Query(default=None, description="Inclusive"),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = _base_query().order_by(Appointment.starts_at.desc()).limit(limit)

    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.join(Appointment.patient).where(
            or_(
                Patient.first_name.ilike(like),
                Patient.last_name.ilike(like),
                Patient.phone.ilike(like),
            )
        )
    if staff_id is not None:
        stmt = stmt.where(Appointment.staff_id == staff_id)
    if service_id is not None:
        stmt = stmt.where(Appointment.service_id == service_id)
    if appointment_status is not None:
        stmt = stmt.where(Appointment.status == appointment_status.value)
    if date_from is not None:
        stmt = stmt.where(Appointment.starts_at >= datetime.combine(date_from, time.min))
    if date_to is not None:
        stmt = stmt.where(
            Appointment.starts_at < datetime.combine(date_to + timedelta(days=1), time.min)
        )

    return list(db.execute(stmt).unique().scalars())


@router.get("/{appointment_id}", response_model=AppointmentDetail)
def read_appointment(appointment_id: int, db: Session = Depends(get_db)):
    return get_appointment(db, appointment_id)


# --------------------------------------------------------------------------
# Write
# --------------------------------------------------------------------------

@router.post("", response_model=AppointmentDetail, status_code=status.HTTP_201_CREATED)
def create_appointment(payload: AppointmentCreate, db: Session = Depends(get_db)):
    """Register an appointment, refusing overlaps with 409."""
    get_patient(db, payload.patient_id)
    staff_member = get_staff(db, payload.staff_id)
    service = get_service(db, payload.service_id)
    assert_staff_bookable(staff_member)
    assert_service_bookable(service)

    starts_at = payload.starts_at
    ends_at = compute_end(starts_at, service)

    validate_slot(
        db, staff_id=payload.staff_id, starts_at=starts_at, ends_at=ends_at
    )

    appointment = Appointment(
        patient_id=payload.patient_id,
        staff_id=payload.staff_id,
        service_id=payload.service_id,
        starts_at=starts_at,
        ends_at=ends_at,
        reason=payload.reason,
        status=AppointmentStatus.SCHEDULED.value,
    )
    db.add(appointment)
    db.flush()  # assign the id the audit row needs
    audit.record_created(db, appointment)
    db.commit()
    return get_appointment(db, appointment.id)


@router.patch("/{appointment_id}/status", response_model=AppointmentDetail)
def update_status(
    appointment_id: int,
    payload: AppointmentStatusUpdate,
    db: Session = Depends(get_db),
):
    """Move an appointment through its lifecycle, rejecting illegal moves."""
    appointment = get_appointment(db, appointment_id)
    previous = appointment.status_enum
    status_machine.assert_transition(previous, payload.status)

    appointment.status = payload.status.value
    audit.record_status_change(
        db,
        appointment,
        from_status=previous,
        to_status=payload.status,
        note=payload.note,
    )
    db.commit()
    return get_appointment(db, appointment_id)


@router.patch("/{appointment_id}/reschedule", response_model=AppointmentDetail)
def reschedule_appointment(
    appointment_id: int,
    payload: AppointmentReschedule,
    db: Session = Depends(get_db),
):
    """Move an appointment, re-running every booking rule at the new slot."""
    appointment = get_appointment(db, appointment_id)
    status_machine.assert_reschedulable(appointment.status_enum)

    staff_id = payload.staff_id if payload.staff_id is not None else appointment.staff_id
    if payload.staff_id is not None:
        assert_staff_bookable(get_staff(db, payload.staff_id))

    if payload.service_id is not None:
        service = get_service(db, payload.service_id)
        assert_service_bookable(service)
    else:
        service = appointment.service

    starts_at = payload.starts_at
    ends_at = compute_end(starts_at, service)

    validate_slot(
        db,
        staff_id=staff_id,
        starts_at=starts_at,
        ends_at=ends_at,
        exclude_appointment_id=appointment.id,
    )

    previous_start = appointment.starts_at
    previous_staff_id = appointment.staff_id

    appointment.staff_id = staff_id
    appointment.service_id = service.id
    appointment.starts_at = starts_at
    appointment.ends_at = ends_at

    audit.record_rescheduled(
        db,
        appointment,
        from_starts_at=previous_start,
        to_starts_at=starts_at,
        from_staff_id=previous_staff_id,
        to_staff_id=staff_id,
    )
    db.commit()
    return get_appointment(db, appointment_id)


@router.get("/{appointment_id}/history", response_model=list[AuditLogRead])
def appointment_history(appointment_id: int, db: Session = Depends(get_db)):
    """Everything that has happened to this appointment, oldest first."""
    get_appointment(db, appointment_id)  # 404 rather than an empty list
    return audit.history_for(db, appointment_id)
