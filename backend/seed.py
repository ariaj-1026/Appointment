"""Populate the database with demo clinic data.

    python seed.py          # add demo data, keeping anything already there
    python seed.py --reset  # drop every table first

Safe to re-run: it skips records whose name already exists.
"""

import argparse
import sys
from datetime import date, datetime, time, timedelta

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.migrate import upgrade_to_head
from app.models import Appointment, AuditLog, BusinessHour, Patient, Service, Staff
from app.models.appointment import AppointmentStatus
from app.models.audit import AuditAction
from app.services.scheduling import compute_end

STAFF = [
    ("Dr. Maria Ilagan", "General Physician"),
    ("Dr. Jose Santos", "Dentist"),
    ("Dr. Liza Reyes", "Pediatrician"),
]

SERVICES = [
    ("General Consultation", 30, "Routine check-up and assessment"),
    ("Dental Cleaning", 45, "Scaling and polishing"),
    ("Vaccination", 15, "Single-dose immunisation"),
    ("Minor Procedure", 60, "Outpatient procedure under local anaesthetic"),
    ("Follow-up Visit", 20, "Review of an ongoing treatment"),
]

PATIENTS = [
    ("Ana", "Cruz", "0917-555-0101", "ana.cruz@example.com", date(1991, 4, 12)),
    ("Ben", "Reyes", "0917-555-0202", "ben.reyes@example.com", date(1985, 9, 30)),
    ("Carla", "Mendoza", "0917-555-0303", None, date(2016, 1, 8)),
    ("Diego", "Torres", "0917-555-0404", "diego.t@example.com", date(1978, 6, 21)),
    ("Elena", "Villanueva", "0917-555-0505", None, date(2002, 11, 3)),
    ("Francis", "Bautista", "0917-555-0606", "fbautista@example.com", date(1969, 2, 17)),
]


def _next_monday() -> date:
    today = date.today()
    return today + timedelta(days=(0 - today.weekday()) % 7 or 7)


def seed(reset: bool = False) -> None:
    if reset:
        print("Dropping all tables...")
        Base.metadata.drop_all(bind=engine)
        # drop_all leaves alembic_version behind, which would make Alembic
        # think the (now empty) database is already migrated.
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
    upgrade_to_head()

    db = SessionLocal()
    try:
        # ---- Staff, with Mon-Fri hours and a lunch break ----
        staff_rows: list[Staff] = []
        for full_name, role in STAFF:
            member = db.execute(
                select(Staff).where(Staff.full_name == full_name)
            ).scalar_one_or_none()
            if member is None:
                member = Staff(full_name=full_name, role=role)
                db.add(member)
                db.flush()
                for weekday in range(5):
                    db.add_all(
                        [
                            BusinessHour(
                                staff_id=member.id,
                                weekday=weekday,
                                opens_at=time(9, 0),
                                closes_at=time(12, 0),
                            ),
                            BusinessHour(
                                staff_id=member.id,
                                weekday=weekday,
                                opens_at=time(13, 0),
                                closes_at=time(17, 0),
                            ),
                        ]
                    )
            staff_rows.append(member)

        # ---- Services ----
        service_rows: list[Service] = []
        for name, minutes, description in SERVICES:
            service = db.execute(
                select(Service).where(Service.name == name)
            ).scalar_one_or_none()
            if service is None:
                service = Service(
                    name=name, duration_minutes=minutes, description=description
                )
                db.add(service)
                db.flush()
            service_rows.append(service)

        # ---- Patients ----
        patient_rows: list[Patient] = []
        for first, last, phone, email, dob in PATIENTS:
            patient = db.execute(
                select(Patient).where(Patient.phone == phone)
            ).scalar_one_or_none()
            if patient is None:
                patient = Patient(
                    first_name=first,
                    last_name=last,
                    phone=phone,
                    email=email,
                    date_of_birth=dob,
                )
                db.add(patient)
                db.flush()
            patient_rows.append(patient)

        db.commit()

        # ---- Appointments across next week ----
        existing = db.execute(select(Appointment).limit(1)).scalar_one_or_none()
        if existing is not None:
            print("Appointments already present - skipping appointment seeding.")
        else:
            monday = _next_monday()
            plan = [
                # (day offset, hour, minute, staff idx, service idx, patient idx, status)
                (0, 9, 0, 0, 0, 0, AppointmentStatus.CONFIRMED),
                (0, 9, 30, 0, 4, 1, AppointmentStatus.SCHEDULED),
                (0, 10, 0, 0, 0, 2, AppointmentStatus.SCHEDULED),
                (0, 9, 0, 1, 1, 3, AppointmentStatus.CONFIRMED),
                (0, 13, 0, 1, 1, 4, AppointmentStatus.SCHEDULED),
                (0, 11, 0, 2, 2, 2, AppointmentStatus.COMPLETED),
                (1, 9, 0, 0, 3, 5, AppointmentStatus.SCHEDULED),
                (1, 10, 30, 0, 0, 0, AppointmentStatus.CANCELLED),
                (1, 14, 0, 1, 1, 1, AppointmentStatus.SCHEDULED),
                (2, 9, 30, 2, 2, 2, AppointmentStatus.SCHEDULED),
                (2, 13, 30, 0, 4, 3, AppointmentStatus.NO_SHOW),
                (3, 10, 0, 0, 0, 4, AppointmentStatus.SCHEDULED),
                (3, 15, 0, 1, 1, 5, AppointmentStatus.SCHEDULED),
                (4, 9, 0, 2, 0, 0, AppointmentStatus.SCHEDULED),
            ]
            cancel_notes = {
                AppointmentStatus.CANCELLED: "Patient called to cancel",
                AppointmentStatus.NO_SHOW: "Did not arrive",
            }

            for offset, hour, minute, s_idx, sv_idx, p_idx, appt_status in plan:
                service = service_rows[sv_idx]
                starts_at = datetime.combine(
                    monday + timedelta(days=offset), time(hour, minute)
                )
                appointment = Appointment(
                    patient_id=patient_rows[p_idx].id,
                    staff_id=staff_rows[s_idx].id,
                    service_id=service.id,
                    starts_at=starts_at,
                    ends_at=compute_end(starts_at, service),
                    status=appt_status.value,
                    reason=None,
                )
                db.add(appointment)
                db.flush()

                # Give each appointment the history it would have accumulated
                # had it been booked through the API, so the history view and
                # the reports have something real to show.
                db.add(
                    AuditLog(
                        appointment_id=appointment.id,
                        action=AuditAction.CREATED.value,
                        to_status=AppointmentStatus.SCHEDULED.value,
                        to_starts_at=starts_at,
                        to_staff_id=appointment.staff_id,
                    )
                )
                if appt_status is not AppointmentStatus.SCHEDULED:
                    # Anything past 'scheduled' was confirmed on the way there,
                    # except a straight cancellation.
                    trail = []
                    if appt_status in (
                        AppointmentStatus.CONFIRMED,
                        AppointmentStatus.COMPLETED,
                    ):
                        trail.append(AppointmentStatus.CONFIRMED)
                    if appt_status is not AppointmentStatus.CONFIRMED:
                        trail.append(appt_status)

                    previous = AppointmentStatus.SCHEDULED
                    for step in trail:
                        db.add(
                            AuditLog(
                                appointment_id=appointment.id,
                                action=AuditAction.STATUS_CHANGED.value,
                                from_status=previous.value,
                                to_status=step.value,
                                note=cancel_notes.get(step),
                            )
                        )
                        previous = step

            db.commit()
            print(f"Seeded {len(plan)} appointments starting {monday:%d %b %Y}.")

        print(
            f"Done: {db.query(Staff).count()} staff, "
            f"{db.query(Service).count()} services, "
            f"{db.query(Patient).count()} patients, "
            f"{db.query(Appointment).count()} appointments, "
            f"{db.query(AuditLog).count()} history entries."
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reset", action="store_true", help="drop all tables before seeding"
    )
    args = parser.parse_args()
    if args.reset:
        confirm = input("This deletes all existing data. Type 'yes' to continue: ")
        if confirm.strip().lower() != "yes":
            print("Aborted.")
            sys.exit(1)
    seed(reset=args.reset)
