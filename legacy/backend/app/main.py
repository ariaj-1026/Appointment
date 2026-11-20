"""FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import APP_NAME, APP_VERSION, AUTO_MIGRATE, CORS_ORIGINS
from app.migrate import upgrade_to_head
from app.routers import appointments, patients, reminders, reports, services, staff
from app.services.errors import DomainError


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if AUTO_MIGRATE:
        upgrade_to_head()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=APP_NAME,
        version=APP_VERSION,
        lifespan=lifespan,
        description=(
            "Appointment scheduling for a clinic: register visits, refuse "
            "double-bookings, and track appointment status."
        ),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(DomainError)
    async def _domain_error_handler(_request: Request, exc: DomainError):
        """Turn rule violations into structured, displayable responses."""
        return JSONResponse(status_code=exc.status_code, content=exc.as_payload())

    app.include_router(appointments.router)
    app.include_router(patients.router)
    app.include_router(staff.router)
    app.include_router(services.router)
    app.include_router(reports.router)
    app.include_router(reminders.router)

    @app.get("/api/health", tags=["meta"])
    def health():
        return {"status": "ok", "app": APP_NAME, "version": APP_VERSION}

    return app


app = create_app()
