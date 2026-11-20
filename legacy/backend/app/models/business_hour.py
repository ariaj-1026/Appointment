from datetime import time

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

WEEKDAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


class BusinessHour(Base):
    """One open window for one staff member on one weekday.

    A weekday with no row is closed. A staff member with no rows at all is
    treated as unrestricted, so hours are opt-in rather than a setup chore.
    Multiple rows per weekday are allowed, which is how split shifts (e.g. a
    lunch break) are expressed.
    """

    __tablename__ = "business_hours"

    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(
        ForeignKey("staff.id", ondelete="CASCADE"), index=True
    )
    # 0 = Monday ... 6 = Sunday, matching datetime.weekday()
    weekday: Mapped[int] = mapped_column(Integer)
    opens_at: Mapped[time] = mapped_column(Time)
    closes_at: Mapped[time] = mapped_column(Time)

    staff: Mapped["Staff"] = relationship(back_populates="business_hours")  # noqa: F821

    __table_args__ = (
        UniqueConstraint(
            "staff_id", "weekday", "opens_at", name="uq_business_hours_slot"
        ),
        CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_business_hours_weekday"),
        CheckConstraint("opens_at < closes_at", name="ck_business_hours_order"),
    )

    @property
    def weekday_name(self) -> str:
        return WEEKDAY_NAMES[self.weekday]
