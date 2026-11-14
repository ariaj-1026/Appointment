from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.clock import clinic_today
from app.database import get_db
from app.services import reports
from app.services.errors import ValidationError
from app.services.scheduling import get_staff

router = APIRouter(prefix="/api/reports", tags=["reports"])

MAX_RANGE_DAYS = 366

# The window a report covers when the caller names no range: last week through
# the next four weeks. A clinic's appointments sit mostly in the future, so a
# retrospective default reports zero for everyone on a freshly seeded database
# while the appointments plainly exist.
DEFAULT_DAYS_BACK = 7
DEFAULT_DAYS_AHEAD = 28


def _default_range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    """Fill in whichever end of the range the caller left out."""
    today = clinic_today()
    if date_from is None and date_to is None:
        return today - timedelta(days=DEFAULT_DAYS_BACK), today + timedelta(
            days=DEFAULT_DAYS_AHEAD
        )
    if date_from is None:
        return date_to - timedelta(days=DEFAULT_DAYS_BACK + DEFAULT_DAYS_AHEAD), date_to
    if date_to is None:
        return date_from, date_from + timedelta(
            days=DEFAULT_DAYS_BACK + DEFAULT_DAYS_AHEAD
        )
    return date_from, date_to


def _validate_range(date_from: date, date_to: date) -> None:
    if date_to < date_from:
        raise ValidationError(
            "The end of the range is before its start.",
            date_from=date_from.isoformat(),
            date_to=date_to.isoformat(),
        )
    span = (date_to - date_from).days + 1
    if span > MAX_RANGE_DAYS:
        raise ValidationError(
            f"Range covers {span} days; the maximum is {MAX_RANGE_DAYS}.",
            days=span,
        )


@router.get("/daily-summary")
def daily_summary(
    day: date = Query(default_factory=clinic_today, alias="date"),
    staff_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Appointments and booked time for one day, per staff member."""
    if staff_id is not None:
        get_staff(db, staff_id)
    return reports.daily_summary(db, day=day, staff_id=staff_id)


@router.get("/utilisation")
def utilisation(
    date_from: date | None = None,
    date_to: date | None = None,
    staff_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Booked minutes against available minutes, per staff member.

    Defaults to the last week through the next four weeks.
    """
    date_from, date_to = _default_range(date_from, date_to)
    _validate_range(date_from, date_to)
    if staff_id is not None:
        get_staff(db, staff_id)
    return reports.utilisation(
        db, date_from=date_from, date_to=date_to, staff_id=staff_id
    )


# US spelling kept as an alias so either works.
@router.get("/utilization", include_in_schema=False)
def utilization_alias(
    date_from: date | None = None,
    date_to: date | None = None,
    staff_id: int | None = None,
    db: Session = Depends(get_db),
):
    return utilisation(date_from, date_to, staff_id, db)


@router.get("/cancellations")
def cancellations(
    date_from: date | None = None,
    date_to: date | None = None,
    staff_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Cancellation and no-show rates, and the time they cost."""
    date_from, date_to = _default_range(date_from, date_to)
    _validate_range(date_from, date_to)
    if staff_id is not None:
        get_staff(db, staff_id)
    return reports.cancellations(
        db, date_from=date_from, date_to=date_to, staff_id=staff_id
    )
