"""Application configuration.

Values come from environment variables so tests can point at a throwaway
database without touching the development one.
"""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

APP_NAME = "Clinic Appointment Scheduling"
APP_VERSION = "0.2.0"

# Default: a SQLite file alongside the backend package.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'clinic.db'}")

# Vite dev server origins allowed to call the API.
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

# Appointments may not be booked further ahead than this.
MAX_BOOKING_DAYS_AHEAD = int(os.getenv("MAX_BOOKING_DAYS_AHEAD", "365"))

# How far into the past a new booking may start. Not zero: someone who opens
# the form at 13:58 for a 14:00 slot and submits at 14:01 is booking the
# present, not the past, and bouncing them would be baffling. Wide enough to
# absorb that and a walk-in entered shortly after it began, narrow enough that
# yesterday is still refused.
BOOKING_GRACE_MINUTES = int(os.getenv("BOOKING_GRACE_MINUTES", "15"))

# Run `alembic upgrade head` on startup. Tests build their schema directly and
# switch this off; a multi-replica deployment should too, migrating as its own
# deploy step so replicas cannot race.
AUTO_MIGRATE = os.getenv("AUTO_MIGRATE", "1") not in ("0", "false", "False")

# How far ahead the reminder sweep looks, and which sender delivers.
REMINDER_LOOKAHEAD_HOURS = int(os.getenv("REMINDER_LOOKAHEAD_HOURS", "24"))
REMINDER_SENDER = os.getenv("REMINDER_SENDER", "console")
