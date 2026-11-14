"""Phase 3: schedule summaries, utilisation and cancellation reporting."""

from datetime import timedelta

from tests.conftest import at, next_weekday

HOURS_9_TO_5 = [
    {"weekday": d, "opens_at": "09:00:00", "closes_at": "17:00:00"} for d in range(5)
]


def set_hours(client, staff_id, windows=None):
    r = client.put(
        f"/api/staff/{staff_id}/business-hours",
        json=HOURS_9_TO_5 if windows is None else windows,
    )
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------
# Daily summary
# --------------------------------------------------------------------------

def test_daily_summary_counts_by_status(client, book, monday, doctor, other_patient):
    a = book(at(monday, 9)).json()
    book(at(monday, 10), patient_id=other_patient["id"])
    client.patch(f"/api/appointments/{a['id']}/status", json={"status": "cancelled"})

    body = client.get("/api/reports/daily-summary", params={"date": monday}).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["total"] == 2
    assert row["counts"]["scheduled"] == 1
    assert row["counts"]["cancelled"] == 1


def test_booked_minutes_exclude_released_slots(client, book, monday, doctor):
    """Cancelled time was given back, so it is not booked time."""
    a = book(at(monday, 9)).json()
    body = client.get("/api/reports/daily-summary", params={"date": monday}).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["booked_minutes"] == 30

    client.patch(f"/api/appointments/{a['id']}/status", json={"status": "cancelled"})
    body = client.get("/api/reports/daily-summary", params={"date": monday}).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["booked_minutes"] == 0


def test_completed_still_counts_as_booked(client, book, monday, doctor):
    a = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{a['id']}/status", json={"status": "completed"})
    body = client.get("/api/reports/daily-summary", params={"date": monday}).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["booked_minutes"] == 30


def test_utilisation_against_configured_hours(client, book, monday, doctor):
    set_hours(client, doctor["id"])  # 8h = 480 min
    book(at(monday, 9))
    book(at(monday, 10))  # 2 x 30 min = 60 min
    body = client.get("/api/reports/daily-summary", params={"date": monday}).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["available_minutes"] == 480
    assert row["booked_minutes"] == 60
    assert row["utilisation_pct"] == 12.5
    assert row["free_minutes"] == 420


def test_utilisation_is_null_without_configured_hours(client, book, monday, doctor):
    """Unrestricted capacity has no denominator, so no percentage is invented."""
    book(at(monday, 9))
    body = client.get("/api/reports/daily-summary", params={"date": monday}).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["available_minutes"] is None
    assert row["utilisation_pct"] is None
    assert row["booked_minutes"] == 30


def test_totals_flag_partial_capacity(client, book, monday, doctor, other_doctor):
    set_hours(client, doctor["id"])
    book(at(monday, 9))
    body = client.get("/api/reports/daily-summary", params={"date": monday}).json()
    # other_doctor has no hours, so the clinic-wide denominator is incomplete.
    assert body["totals"]["partial_capacity"] is True


def test_closed_day_has_no_capacity(client, doctor):
    set_hours(client, doctor["id"])  # Mon-Fri only
    saturday = next_weekday(5)
    body = client.get("/api/reports/daily-summary", params={"date": saturday}).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["available_minutes"] == 0
    assert row["utilisation_pct"] is None, "0 capacity must not divide by zero"


def test_daily_summary_can_filter_to_one_staff_member(client, book, monday, doctor):
    book(at(monday, 9))
    body = client.get(
        "/api/reports/daily-summary", params={"date": monday, "staff_id": doctor["id"]}
    ).json()
    assert len(body["staff"]) == 1


# --------------------------------------------------------------------------
# Utilisation over a range
# --------------------------------------------------------------------------

def test_utilisation_range_sums_working_days(client, book, doctor, monday):
    set_hours(client, doctor["id"])  # 480 min on each of Mon-Fri
    tuesday = next_weekday(1)
    book(at(monday, 9))
    book(at(tuesday, 9))
    body = client.get(
        "/api/reports/utilisation",
        params={"date_from": monday, "date_to": tuesday},
    ).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert body["days"] == 2
    assert row["available_minutes"] == 960
    assert row["booked_minutes"] == 60
    assert row["utilisation_pct"] == 6.2


def test_utilisation_range_skips_closed_weekends(client, doctor, monday):
    set_hours(client, doctor["id"])
    # The Sunday after this Saturday, not next_weekday(6): when today is a
    # Saturday those two land in different weeks and the range runs backwards.
    saturday = next_weekday(5)
    sunday = saturday + timedelta(days=1)
    body = client.get(
        "/api/reports/utilisation",
        params={"date_from": saturday, "date_to": sunday},
    ).json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["available_minutes"] == 0


def test_utilisation_rejects_backwards_range(client, monday):
    r = client.get(
        "/api/reports/utilisation",
        params={"date_from": next_weekday(1), "date_to": monday},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"


def test_utilization_us_spelling_alias_works(client, monday):
    assert client.get("/api/reports/utilization").status_code == 200


def test_default_range_counts_upcoming_appointments(client, book, doctor, monday):
    """The no-range default must not hide appointments that are still ahead.

    A retrospective default (today-29 → today) reported zero for every staff
    member on a clinic whose appointments were all in the coming week, while
    Find — which applies no date filter — listed them all. The two screens
    looked like they disagreed about the same data.
    """
    set_hours(client, doctor["id"])
    book(at(monday, 9))  # `monday` is the next one, i.e. in the future

    body = client.get("/api/reports/utilisation").json()
    row = next(r for r in body["staff"] if r["staff_id"] == doctor["id"])
    assert row["appointments"] == 1
    assert body["totals"]["appointments"] == 1

    assert client.get("/api/reports/cancellations").json()["totals"]["total"] == 1


def test_default_range_fills_in_only_the_missing_end(client):
    """Giving one end of the range keeps it; only the absent end is defaulted."""
    body = client.get(
        "/api/reports/utilisation", params={"date_from": "2026-03-01"}
    ).json()
    assert body["date_from"] == "2026-03-01"
    assert body["date_to"] > body["date_from"]

    body = client.get(
        "/api/reports/utilisation", params={"date_to": "2026-03-31"}
    ).json()
    assert body["date_to"] == "2026-03-31"
    assert body["date_from"] < body["date_to"]


# --------------------------------------------------------------------------
# Cancellations
# --------------------------------------------------------------------------

def test_cancellation_rates(client, book, monday, other_patient):
    a = book(at(monday, 9)).json()
    b = book(at(monday, 10), patient_id=other_patient["id"]).json()
    book(at(monday, 11))
    client.patch(f"/api/appointments/{a['id']}/status", json={"status": "cancelled"})
    client.patch(f"/api/appointments/{b['id']}/status", json={"status": "no_show"})

    body = client.get(
        "/api/reports/cancellations",
        params={"date_from": monday, "date_to": monday},
    ).json()
    t = body["totals"]
    assert t["total"] == 3
    assert t["cancelled"] == 1 and t["no_show"] == 1
    assert t["combined_rate_pct"] == 66.7
    assert t["lost_minutes"] == 60


def test_cancellations_empty_range_has_null_rate(client, monday):
    """No appointments means no rate, rather than a misleading 0%."""
    body = client.get(
        "/api/reports/cancellations",
        params={"date_from": monday, "date_to": monday},
    ).json()
    assert body["totals"]["total"] == 0
    assert body["totals"]["combined_rate_pct"] is None


def test_cancellations_break_down_by_staff_and_service(
    client, book, monday, consult, long_service
):
    a = book(at(monday, 9)).json()
    client.patch(f"/api/appointments/{a['id']}/status", json={"status": "cancelled"})
    body = client.get(
        "/api/reports/cancellations",
        params={"date_from": monday, "date_to": monday},
    ).json()
    assert body["by_staff"][0]["cancelled"] == 1
    assert body["by_service"][0]["service_name"] == consult["name"]


def test_cancellations_list_recent_with_reason(client, book, monday):
    a = book(at(monday, 9)).json()
    client.patch(
        f"/api/appointments/{a['id']}/status",
        json={"status": "cancelled", "note": "rescheduled by phone"},
    )
    body = client.get(
        "/api/reports/cancellations",
        params={"date_from": monday, "date_to": monday},
    ).json()
    assert body["recent"][0]["patient_name"] == "Ana Cruz"
    assert body["recent"][0]["status"] == "cancelled"
