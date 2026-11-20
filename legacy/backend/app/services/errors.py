"""Domain errors, each mapped to an HTTP status by the exception handlers."""


class DomainError(Exception):
    """Base class for rule violations the API reports back to the caller."""

    status_code = 400
    code = "domain_error"

    def __init__(self, message: str, **detail):
        super().__init__(message)
        self.message = message
        self.detail = detail

    def as_payload(self) -> dict:
        return {"code": self.code, "message": self.message, **self.detail}


class NotFoundError(DomainError):
    status_code = 404
    code = "not_found"


class ConflictError(DomainError):
    """The requested slot overlaps an appointment that still holds it."""

    status_code = 409
    code = "slot_conflict"


class OutsideBusinessHoursError(DomainError):
    status_code = 422
    code = "outside_business_hours"


class InvalidStatusTransitionError(DomainError):
    status_code = 422
    code = "invalid_status_transition"


class ValidationError(DomainError):
    status_code = 422
    code = "validation_error"
