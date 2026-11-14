from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import reports
from app.services.errors import ValidationError
from app.services.scheduling import get_staff

router = APIRouter(prefix="/api/reports", tags=["reports"])

MAX_RANGE_DAYS = 366


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
    day: date = Query(default_factory=date.today, alias="date"),
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

    Defaults to the last 30 days when no range is given.
    """
    date_to = date_to or date.today()
    date_from = date_from or date_to - timedelta(days=29)
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
    date_to = date_to or date.today()
    date_from = date_from or date_to - timedelta(days=29)
    _validate_range(date_from, date_to)
    if staff_id is not None:
        get_staff(db, staff_id)
    return reports.cancellations(
        db, date_from=date_from, date_to=date_to, staff_id=staff_id
    )
