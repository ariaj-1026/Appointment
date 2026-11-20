from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    business_hours: Mapped[list["BusinessHour"]] = relationship(  # noqa: F821
        back_populates="staff",
        cascade="all, delete-orphan",
        order_by="BusinessHour.weekday",
    )
    appointments: Mapped[list["Appointment"]] = relationship(  # noqa: F821
        back_populates="staff",
    )
