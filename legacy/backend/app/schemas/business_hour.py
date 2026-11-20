from datetime import time

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BusinessHourWrite(BaseModel):
    weekday: int = Field(ge=0, le=6, description="0 = Monday ... 6 = Sunday")
    opens_at: time
    closes_at: time

    @model_validator(mode="after")
    def _check_order(self):
        if self.opens_at >= self.closes_at:
            raise ValueError("opens_at must be earlier than closes_at")
        return self


class BusinessHourRead(BusinessHourWrite):
    model_config = ConfigDict(from_attributes=True)

    id: int
    staff_id: int
