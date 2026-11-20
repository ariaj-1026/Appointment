"""Phase 2: rescheduling and search."""

from tests.conftest import at, next_weekday


def test_reschedule_moves_the_appointment(client, book, monday):
    appt = book(at(monday, 9)).json()
    r = client.patch(
        f"/api/appointments/{appt['id']}/reschedule",
        json={"starts_at": at(monday, 14)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["starts_at"].endswith("14:00:00")
    assert r.json()["ends_at"].endswith("14:30:00")


def test_reschedule_onto_itself_is_allowed(client, book, monday):
    """The row being moved must not count as its own conflict."""
    appt = book(at(monday, 9)).json()
    r = client.patch(
        f"/api/appointments/{appt['id']}/reschedule",
        json={"starts_at": at(monday, 9)},
    )
    assert r.status_code == 200, r.text


def test_reschedule_into_a_taken_slot_is_refused(client, book, monday, other_patient):
    first = book(at(monday, 9)).json()
    book(at(monday, 11), patient_id=other_patient["id"])
    r = client.patch(
        f"/api/appointments/{first['id']}/reschedule",
        json={"starts_at": at(monday, 11)},
    )
    assert r.status_code == 409


def test_reschedule_revalidates_business_hours(client, book, doctor, monday):
    client.put(
        f"/api/staff/{doctor['id']}/business-hours",
        json=[{"weekday": 0, "opens_at": "09:00:00", "closes_at": "17:00:00"}],
    )
    appt = book(at(monday, 10)).json()
    r = client.patch(
        f"/api/appointments/{appt['id']}/reschedule",
        json={"starts_at": at(monday, 20)},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "outside_business_hours"


def test_reschedule_can_change_staff(client, book, monday, other_doctor):
    appt = book(at(monday, 9)).json()
    r = client.patch(
        f"/api/appointments/{appt['id']}/reschedule",
        json={"starts_at": at(monday, 9), "staff_id": other_doctor["id"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["staff_id"] == other_doctor["id"]


def test_reschedule_with_new_service_recomputes_the_end(
    client, book, monday, long_service
):
    appt = book(at(monday, 9)).json()
    r = client.patch(
        f"/api/appointments/{appt['id']}/reschedule",
        json={"starts_at": at(monday, 9), "service_id": long_service["id"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["duration_minutes"] == 60


def test_cancelled_appointments_cannot_be_rescheduled(client, book, monday):
    appt = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{appt['id']}/status", json={"status": "cancelled"})
    r = client.patch(
        f"/api/appointments/{appt['id']}/reschedule",
        json={"starts_at": at(monday, 14)},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "invalid_status_transition"


# --------------------------------------------------------------------------
# Search and listing
# --------------------------------------------------------------------------

def test_list_filters_by_day(client, book, monday):
    tuesday = next_weekday(1)
    book(at(monday, 9))
    book(at(tuesday, 9))
    on_monday = client.get("/api/appointments", params={"on": monday.isoformat()})
    assert len(on_monday.json()) == 1


def test_list_filters_by_staff(client, book, monday, doctor, other_doctor):
    book(at(monday, 9))
    book(at(monday, 9), staff_id=other_doctor["id"])
    r = client.get("/api/appointments", params={"staff_id": doctor["id"]})
    assert [a["staff_id"] for a in r.json()] == [doctor["id"]]


def test_search_by_patient_name(client, book, monday, other_patient):
    book(at(monday, 9))
    book(at(monday, 11), patient_id=other_patient["id"])
    r = client.get("/api/appointments/search", params={"q": "Reyes"})
    assert len(r.json()) == 1
    assert r.json()[0]["patient"]["last_name"] == "Reyes"


def test_search_by_phone(client, book, monday):
    book(at(monday, 9))
    r = client.get("/api/appointments/search", params={"q": "555-0101"})
    assert len(r.json()) == 1


def test_search_by_status(client, book, monday, other_patient):
    a = book(at(monday, 9)).json()
    book(at(monday, 11), patient_id=other_patient["id"])
    client.patch(f"/api/appointments/{a['id']}/status", json={"status": "cancelled"})
    r = client.get("/api/appointments/search", params={"status": "cancelled"})
    assert [x["id"] for x in r.json()] == [a["id"]]


def test_search_by_date_range_is_inclusive(client, book, monday):
    tuesday = next_weekday(1)
    book(at(monday, 9))
    book(at(tuesday, 9))
    r = client.get(
        "/api/appointments/search",
        params={"date_from": monday.isoformat(), "date_to": tuesday.isoformat()},
    )
    assert len(r.json()) == 2


def test_search_combines_filters(client, book, monday, doctor, other_doctor):
    book(at(monday, 9))
    book(at(monday, 9), staff_id=other_doctor["id"])
    r = client.get(
        "/api/appointments/search",
        params={"staff_id": doctor["id"], "status": "scheduled", "q": "Ana"},
    )
    assert len(r.json()) == 1


def test_detail_includes_joined_records(client, book, monday):
    appt = book(at(monday, 9)).json()
    body = client.get(f"/api/appointments/{appt['id']}").json()
    assert body["patient"]["full_name"] == "Ana Cruz"
    assert body["staff"]["full_name"] == "Dr. Ilagan"
    assert body["service"]["name"] == "Consultation"
