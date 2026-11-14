"""Programmatic Alembic runner.

The app brings the database to head on startup, so `uvicorn` and `seed.py`
both just work with no separate migrate step. That is appropriate here: one
process, one SQLite file. A multi-process or multi-replica deployment should
drop this from the lifespan and run `alembic upgrade head` as its own
deploy step, so replicas cannot race each other to migrate.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import DATABASE_URL

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
    return cfg


def stamp(revision: str) -> None:
    """Mark the database as already at `revision` without running it."""
    command.stamp(_config(), revision)


def _adopt_pre_alembic_database() -> bool:
    """Stamp a database that predates migrations, so it can be upgraded.

    A database built by the old `create_all()` path has the phase 0-2 tables
    but no `alembic_version`, so Alembic would try to create tables that are
    already there. Recognising that state and stamping it at the baseline lets
    an existing database be adopted instead of rebuilt.
    """
    from sqlalchemy import create_engine, inspect

    engine = create_engine(DATABASE_URL)
    try:
        tables = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    if "alembic_version" in tables or "appointments" not in tables:
        return False
    stamp("0001")
    return True


def upgrade_to_head() -> None:
    _adopt_pre_alembic_database()
    command.upgrade(_config(), "head")
