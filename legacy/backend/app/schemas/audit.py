from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    appointment_id: int
    action: str
    from_status: str | None
    to_status: str | None
    from_starts_at: datetime | None
    to_starts_at: datetime | None
    from_staff_id: int | None
    to_staff_id: int | None
    note: str | None
    changed_at: datetime


class ReminderLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    appointment_id: int
    channel: str
    status: str
    recipient: str | None
    detail: str | None
    sent_at: datetime
