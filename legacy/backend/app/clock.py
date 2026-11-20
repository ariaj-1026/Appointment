"""The clinic's clock.

Every datetime this application stores is **naive local clinic time**:
appointment starts arrive from a `datetime-local` input, business hours are
written as wall-clock times ("Monday 09:00"), and nothing is converted
anywhere. For that to hold, "now" has to mean one specific wall clock, not
whatever the machine running the process happens to be set to.

So the timezone is named rather than inherited. A clone running on a laptop in
another country, a CI runner on UTC, or a host whose clock is set to UTC still
books, reports and timestamps against Philippine time. Set `CLINIC_TIMEZONE` to
move the clinic.

The values returned are deliberately **naive** — the tzinfo is attached only
long enough to resolve the correct wall-clock reading, then dropped. Mixing
aware and naive datetimes raises `TypeError` on comparison, and the columns,
the API payloads and the browser inputs are all naive. Converting the whole
system to aware UTC is the alternative, and the right one if the clinic ever
spans timezones; this is the smaller, consistent choice for one clinic.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import CLINIC_TIMEZONE

try:
    CLINIC_TZ = ZoneInfo(CLINIC_TIMEZONE)
except ZoneInfoNotFoundError as exc:  # pragma: no cover - configuration error
    raise RuntimeError(
        f"CLINIC_TIMEZONE={CLINIC_TIMEZONE!r} is not a known timezone. On "
        f"Windows the zone database is a separate package: pip install tzdata."
    ) from exc


def clinic_now() -> datetime:
    """Now on the clinic's wall clock, naive."""
    return datetime.now(CLINIC_TZ).replace(tzinfo=None)


def clinic_today() -> date:
    """Today's date at the clinic.

    Not `date.today()`: near midnight the machine's date and the clinic's date
    disagree, which would quietly shift a day's schedule or a report's default
    range onto the wrong day.
    """
    return clinic_now().date()
