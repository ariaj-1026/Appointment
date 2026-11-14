from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BusinessHour, Staff
from app.schemas import (
    BusinessHourRead,
    BusinessHourWrite,
    StaffCreate,
    StaffRead,
    StaffUpdate,
)
from app.services.errors import ValidationError
from app.services.scheduling import get_staff

router = APIRouter(prefix="/api/staff", tags=["staff"])


@router.get("", response_model=list[StaffRead])
def list_staff(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    stmt = select(Staff).order_by(Staff.full_name)
    if not include_inactive:
        stmt = stmt.where(Staff.is_active.is_(True))
    return list(db.execute(stmt).scalars())


@router.post("", response_model=StaffRead, status_code=status.HTTP_201_CREATED)
def create_staff(payload: StaffCreate, db: Session = Depends(get_db)):
    member = Staff(**payload.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.get("/{staff_id}", response_model=StaffRead)
def read_staff(staff_id: int, db: Session = Depends(get_db)):
    return get_staff(db, staff_id)


@router.patch("/{staff_id}", response_model=StaffRead)
def update_staff(staff_id: int, payload: StaffUpdate, db: Session = Depends(get_db)):
    member = get_staff(db, staff_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(member, field, value)
    db.commit()
    db.refresh(member)
    return member


# --------------------------------------------------------------------------
# Business hours
# --------------------------------------------------------------------------

@router.get("/{staff_id}/business-hours", response_model=list[BusinessHourRead])
def list_business_hours(staff_id: int, db: Session = Depends(get_db)):
    get_staff(db, staff_id)
    stmt = (
        select(BusinessHour)
        .where(BusinessHour.staff_id == staff_id)
        .order_by(BusinessHour.weekday, BusinessHour.opens_at)
    )
    return list(db.execute(stmt).scalars())


@router.put("/{staff_id}/business-hours", response_model=list[BusinessHourRead])
def replace_business_hours(
    staff_id: int,
    payload: list[BusinessHourWrite],
    db: Session = Depends(get_db),
):
    """Replace a staff member's whole weekly schedule.

    Whole-week replacement rather than per-row edits: the UI edits the grid as
    one unit, and it makes removing a day the same operation as changing one.
    Existing appointments are not revalidated — moving them is a deliberate
    act, not a side effect of editing hours.
    """
    get_staff(db, staff_id)

    seen: set[tuple[int, object]] = set()
    for window in payload:
        key = (window.weekday, window.opens_at)
        if key in seen:
            raise ValidationError(
                f"Duplicate opening time {window.opens_at:%H:%M} for weekday "
                f"{window.weekday}.",
                weekday=window.weekday,
            )
        seen.add(key)

    # Reject overlapping windows on the same day, which would make "which
    # window applies" ambiguous.
    by_day: dict[int, list[BusinessHourWrite]] = {}
    for window in payload:
        by_day.setdefault(window.weekday, []).append(window)
    for weekday, windows in by_day.items():
        windows.sort(key=lambda w: w.opens_at)
        for earlier, later in zip(windows, windows[1:]):
            if later.opens_at < earlier.closes_at:
                raise ValidationError(
                    f"Overlapping hours on weekday {weekday}: "
                    f"{earlier.opens_at:%H:%M}-{earlier.closes_at:%H:%M} and "
                    f"{later.opens_at:%H:%M}-{later.closes_at:%H:%M}.",
                    weekday=weekday,
                )

    db.execute(
        BusinessHour.__table__.delete().where(BusinessHour.staff_id == staff_id)
    )
    db.add_all(
        BusinessHour(staff_id=staff_id, **window.model_dump()) for window in payload
    )
    db.commit()

    return list_business_hours(staff_id, db)
