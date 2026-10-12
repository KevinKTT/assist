import os
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import reset_db
from app.main import app
from app.money import nearest_minutes


def make_client(tmp_path):
    os.environ["ASSIST_DATA_DIR"] = str(tmp_path)
    reset_db()
    return TestClient(app)


def test_pay_miles_tasks_and_exports(tmp_path):
    with make_client(tmp_path) as client:
        today = "2026-03-10"
        settings = client.get("/api/settings", params={"today": today}).json()
        settings.update({
            "display_name": "Katie",
            "hourly_rate": 20,
            "mileage_rate": 0.7,
            "cycle": "biweekly",
            "cycle_anchor": "2026-03-02",
            "payday_offset_days": 5,
        })
        saved = client.put("/api/settings", params={"today": today}, json=settings)
        assert saved.status_code == 200

        created = client.post("/api/time", json={"work_date": "2026-03-03", "hours": 8, "note": "clinic"})
        assert created.status_code == 200
        assert created.json()["pay"] == 160
        assert created.json()["rate"] == 20

        miles = client.post("/api/mileage", json={"drive_date": "2026-03-03", "miles": 10, "note": "school"})
        assert miles.status_code == 200
        assert miles.json()["pay"] == 7

        period = client.get("/api/periods", params={"today": today}).json()
        assert period["start"] == "2026-03-02"
        assert period["end"] == "2026-03-15"
        assert period["hours"] == 8
        assert period["hours_pay"] == 160
        assert period["miles"] == 10
        assert period["mileage_pay"] == 7
        assert period["combined"] == 167
        assert period["payday"] == "2026-03-20"
        assert period["prev_start"] == "2026-02-16"
        assert len(period["days"]) == 14

        paid = client.post("/api/payouts", json={
            "kind": "hours",
            "period_start": period["start"],
            "period_end": period["end"],
            "paid_on": "2026-03-20",
            "note": "check",
        })
        assert paid.status_code == 200
        assert paid.json()["amount"] == 160

        history = client.get("/api/history", params={"today": today}).json()
        march = next(month for month in history if month["month"] == "2026-03")
        assert march["received"] == 160
        current = next(item for item in march["periods"] if item["start"] == "2026-03-02")
        assert current["hours_payout"]["amount"] == 160
        assert current["mileage_pay"] == 7

        raised = client.put("/api/settings", params={"today": today}, json={**settings, "hourly_rate": 30})
        assert raised.status_code == 200
        again = client.get("/api/periods", params={"today": today}).json()
        assert again["hours_pay"] == 160
        later = client.post("/api/time", json={"work_date": "2026-03-04", "hours": 1, "note": ""})
        assert later.json()["rate"] == 30
        assert later.json()["pay"] == 30

        task = client.post("/api/tasks", json={"task_date": "2026-03-11", "title": "Call school"})
        assert task.status_code == 200
        done = client.patch(f"/api/tasks/{task.json()['id']}", json={"done": True})
        assert done.json()["done"] is True
        week = client.get("/api/tasks", params={"start": "2026-03-08", "end": "2026-03-14"})
        assert week.status_code == 200
        assert week.json()[0]["title"] == "Call school"

        empty = client.post("/api/tasks", json={"task_date": "2026-03-12", "title": "   "})
        assert empty.status_code == 400

        csv = client.get("/api/export/csv", params={"start": "2026-03-02", "end": "2026-03-15", "today": today})
        assert csv.status_code == 200
        assert "Call school" in csv.text
        assert "clinic" in csv.text
        pdf = client.get("/api/export/pdf", params={"start": "2026-03-02", "end": "2026-03-15", "today": today})
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")

        dash = client.get("/api/dashboard", params={"today": today}).json()
        assert dash["period"]["hours"] == 9
        assert dash["period"]["combined"] == 197
        assert dash["month_received"] == 160
        assert len(dash["range"]["series"]) == 14


def test_mark_paid_covers_hours_and_miles(tmp_path):
    with make_client(tmp_path) as client:
        client.put("/api/settings", json={
            "display_name": "",
            "hourly_rate": 20,
            "mileage_rate": 0.5,
            "cycle": "weekly",
            "cycle_anchor": "2026-03-08",
            "payday_offset_days": None,
        })
        client.post("/api/time", json={"work_date": "2026-03-10", "hours": 2, "note": ""})
        client.post("/api/mileage", json={"drive_date": "2026-03-10", "miles": 10, "note": ""})
        period = client.get("/api/periods", params={"today": "2026-03-10"}).json()
        paid = client.post("/api/payouts", json={
            "kind": "both",
            "period_start": period["start"],
            "period_end": period["end"],
            "paid_on": "2026-03-12",
            "note": "",
        })
        assert paid.status_code == 200
        assert paid.json()["hours"]["amount"] == 40
        assert paid.json()["mileage"]["amount"] == 5
        assert paid.json()["expenses"]["amount"] == 0


def test_expenses_roll_into_pay_and_exports(tmp_path):
    with make_client(tmp_path) as client:
        today = "2026-03-10"
        client.put("/api/settings", params={"today": today}, json={
            "display_name": "Katie",
            "hourly_rate": 20,
            "mileage_rate": 0.7,
            "cycle": "biweekly",
            "cycle_anchor": "2026-03-02",
            "payday_offset_days": None,
        })
        client.post("/api/time", json={"work_date": "2026-03-03", "hours": 8, "note": ""})
        blank = client.post("/api/expenses", json={"expense_date": "2026-03-03", "amount": 18.4, "note": "   "})
        assert blank.status_code == 400
        uber = client.post("/api/expenses", json={"expense_date": "2026-03-03", "amount": 18.4, "note": "Uber back"})
        assert uber.status_code == 200
        assert uber.json()["amount"] == 18.4
        period = client.get("/api/periods", params={"today": today}).json()
        assert period["expenses"] == 18.4
        assert period["combined"] == 178.4
        dash = client.get("/api/dashboard", params={"today": today}).json()
        assert dash["range"]["expense_entries"][0]["note"] == "Uber back"
        assert dash["period"]["expenses_payout"] is None
        paid = client.post("/api/payouts", json={
            "kind": "both",
            "period_start": period["start"],
            "period_end": period["end"],
            "paid_on": "2026-03-10",
            "note": "",
        })
        assert paid.status_code == 200
        assert paid.json()["expenses"]["amount"] == 18.4
        again = client.get("/api/periods", params={"today": today}).json()
        assert again["expenses_payout"]["amount"] == 18.4
        csv = client.get("/api/export/csv", params={"start": period["start"], "end": period["end"], "today": today})
        assert "Uber back" in csv.text
        assert "18.40" in csv.text
        patched = client.patch(f"/api/expenses/{uber.json()['id']}", json={"amount": 20, "note": "Uber and tip"})
        assert patched.status_code == 200
        assert patched.json()["note"] == "Uber and tip"
        removed = client.delete(f"/api/expenses/{uber.json()['id']}")
        assert removed.status_code == 200


def test_paid_periods_gain_an_expenses_payout(tmp_path):
    with make_client(tmp_path) as client:
        today = "2026-03-10"
        client.put("/api/settings", params={"today": today}, json={
            "display_name": "",
            "hourly_rate": 20,
            "mileage_rate": 0.5,
            "cycle": "weekly",
            "cycle_anchor": "2026-03-08",
            "payday_offset_days": None,
        })
        period = client.get("/api/periods", params={"today": today}).json()
        body = {
            "period_start": period["start"],
            "period_end": period["end"],
            "paid_on": "2026-03-12",
            "note": "",
        }
        assert client.post("/api/payouts", json={**body, "kind": "hours"}).status_code == 200
        assert client.post("/api/payouts", json={**body, "kind": "mileage"}).status_code == 200
        reset_db()
        reopened = client.get("/api/periods", params={"today": today}).json()
        assert reopened["hours_payout"]["amount"] == 0
        assert reopened["mileage_payout"]["amount"] == 0
        assert reopened["expenses_payout"]["amount"] == 0


def test_manual_hours_and_minutes(tmp_path):
    with make_client(tmp_path) as client:
        saved = client.post("/api/time", json={"work_date": "2026-03-03", "hours": 1 + 25 / 60, "note": ""})
        assert saved.status_code == 200
        assert abs(saved.json()["hours"] * 60 - 85) < 0.01


def test_timer_and_short_discard(tmp_path):
    with make_client(tmp_path) as client:
        client.put("/api/settings", json={
            "display_name": "",
            "hourly_rate": 20,
            "mileage_rate": 0,
            "cycle": "weekly",
            "cycle_anchor": "2026-03-08",
            "payday_offset_days": None,
        })
        started = client.post("/api/time/start", json={
            "work_date": "2026-03-10",
            "started_at": "2026-03-10T15:00:00+00:00",
        })
        assert started.status_code == 200
        again = client.post("/api/time/start", json={
            "work_date": "2026-03-10",
            "started_at": "2026-03-10T16:00:00+00:00",
        })
        assert again.status_code == 409
        stopped = client.post("/api/time/stop", json={"ended_at": "2026-03-10T17:30:00+00:00"})
        assert stopped.status_code == 200
        assert stopped.json()["discarded"] is False
        assert stopped.json()["entry"]["hours"] == 2.5
        assert stopped.json()["entry"]["pay"] == 50
        assert stopped.json()["entry"]["source"] == "timer"

        client.post("/api/time/start", json={
            "work_date": "2026-03-10",
            "started_at": "2026-03-10T18:00:00+00:00",
        })
        short = client.post("/api/time/stop", json={"ended_at": "2026-03-10T18:00:10+00:00"})
        assert short.json()["discarded"] is True
        assert client.get("/api/time/running").json()["running"] is None


def test_adjust_running_start(tmp_path):
    with make_client(tmp_path) as client:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        started_at = now - timedelta(minutes=10)
        opened = client.post("/api/time/start", json={
            "work_date": started_at.date().isoformat(),
            "started_at": started_at.isoformat(),
        })
        assert opened.status_code == 200
        earlier = now - timedelta(minutes=25)
        adjusted = client.patch("/api/time/running", json={
            "work_date": earlier.date().isoformat(),
            "started_at": earlier.isoformat(),
        })
        assert adjusted.status_code == 200
        saved = datetime.fromisoformat(adjusted.json()["started_at"])
        assert abs((saved - earlier).total_seconds()) < 1
        future = client.patch("/api/time/running", json={
            "work_date": now.date().isoformat(),
            "started_at": (now + timedelta(hours=1)).isoformat(),
        })
        assert future.status_code == 400
        far = now - timedelta(hours=25)
        too_far = client.patch("/api/time/running", json={
            "work_date": far.date().isoformat(),
            "started_at": far.isoformat(),
        })
        assert too_far.status_code == 400
        stopped = client.post("/api/time/stop", json={"ended_at": now.isoformat()})
        assert stopped.status_code == 200
        assert nearest_minutes(stopped.json()["entry"]["hours"]) == 25
        missing = client.patch("/api/time/running", json={
            "work_date": now.date().isoformat(),
            "started_at": now.isoformat(),
        })
        assert missing.status_code == 404
