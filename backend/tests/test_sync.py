import os

from fastapi.testclient import TestClient

from app.db import SCHEMA_VERSION, Database, reset_db
from app.main import app


def make_client(tmp_path):
    os.environ["ASSIST_DATA_DIR"] = str(tmp_path)
    reset_db()
    return TestClient(app)


def test_create_is_idempotent_with_uid(tmp_path):
    with make_client(tmp_path) as client:
        body = {"work_date": "2026-03-03", "hours": 8, "note": "clinic", "uid": "abc12345"}
        first = client.post("/api/time", json=body)
        second = client.post("/api/time", json=body)
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]
        assert first.json()["uid"] == "abc12345"
        rows = client.get("/api/periods", params={"today": "2026-03-03"}).json()["days"]
        logged = [entry for day in rows for entry in day["time_entries"]]
        assert len(logged) == 1


def test_each_kind_is_idempotent(tmp_path):
    with make_client(tmp_path) as client:
        client.post("/api/mileage", json={"drive_date": "2026-03-03", "miles": 10, "uid": "mile-0001"})
        client.post("/api/mileage", json={"drive_date": "2026-03-03", "miles": 10, "uid": "mile-0001"})
        client.post("/api/expenses", json={"expense_date": "2026-03-03", "amount": 5, "note": "bus", "uid": "exp-00001"})
        client.post("/api/expenses", json={"expense_date": "2026-03-03", "amount": 5, "note": "bus", "uid": "exp-00001"})
        client.post("/api/tasks", json={"task_date": "2026-03-03", "title": "Call", "uid": "task-0001"})
        client.post("/api/tasks", json={"task_date": "2026-03-03", "title": "Call", "uid": "task-0001"})
        state = client.get("/api/sync").json()
        assert len(state["mileage_entries"]) == 1
        assert len(state["expense_entries"]) == 1
        assert len(state["tasks"]) == 1


def test_patch_and_delete_by_uid(tmp_path):
    with make_client(tmp_path) as client:
        created = client.post(
            "/api/time", json={"work_date": "2026-03-03", "hours": 8, "note": "", "uid": "edit-0001"}
        ).json()
        patched = client.patch("/api/time/edit-0001", json={"hours": 6, "note": "short"})
        assert patched.status_code == 200
        assert patched.json()["hours"] == 6
        assert patched.json()["uid"] == "edit-0001"
        assert client.delete("/api/time/edit-0001").status_code == 200
        # Deleting again (a retry) is not an error.
        assert client.delete("/api/time/edit-0001").status_code == 200
        assert client.get("/api/sync").json()["time_entries"] == []
        assert created["uid"] == "edit-0001"


def test_timer_start_is_idempotent(tmp_path):
    with make_client(tmp_path) as client:
        body = {"work_date": "2026-03-10", "started_at": "2026-03-10T15:00:00+00:00", "uid": "timer-001"}
        first = client.post("/api/time/start", json=body)
        second = client.post("/api/time/start", json=body)
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]
        # A different uid while one is running is still a conflict.
        other = client.post("/api/time/start", json={**body, "uid": "timer-002"})
        assert other.status_code == 409


def test_stop_without_a_running_timer_is_not_an_error(tmp_path):
    with make_client(tmp_path) as client:
        stopped = client.post("/api/time/stop", json={"ended_at": "2026-03-10T17:00:00+00:00"})
        assert stopped.status_code == 200
        assert stopped.json() == {"discarded": False, "entry": None}


def test_sync_returns_all_state(tmp_path):
    with make_client(tmp_path) as client:
        client.put(
            "/api/settings",
            json={
                "display_name": "Katie",
                "hourly_rate": 20,
                "mileage_rate": 0.7,
                "cycle": "weekly",
                "cycle_anchor": "2026-03-08",
                "payday_offset_days": None,
            },
        )
        client.post("/api/time", json={"work_date": "2026-03-10", "hours": 8, "uid": "sync-0001"})
        state = client.get("/api/sync").json()
        assert state["settings"]["display_name"] == "Katie"
        assert state["server_time"]
        assert state["running"] is None
        assert len(state["time_entries"]) == 1
        assert state["time_entries"][0]["uid"] == "sync-0001"
        assert set(state) == {
            "server_time",
            "settings",
            "time_entries",
            "mileage_entries",
            "expense_entries",
            "tasks",
            "payouts",
            "running",
        }


def test_migration_backfills_uids(tmp_path):
    db_path = tmp_path / "assist.db"
    db = Database(db_path)
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO time_entries (work_date, hours, rate, note, created_at, updated_at, uid)
            VALUES ('2026-03-03', 8, 20, '', '2026-03-03T00:00:00+00:00', '2026-03-03T00:00:00+00:00', NULL)
            """
        )
        conn.execute("UPDATE schema_meta SET value = '1' WHERE key = 'version'")
    db.close()

    reopened = Database(db_path)
    row = reopened.conn.execute("SELECT uid FROM time_entries").fetchone()
    version = reopened.conn.execute("SELECT value FROM schema_meta WHERE key = 'version'").fetchone()[0]
    reopened.close()
    assert row["uid"]
    assert version == str(SCHEMA_VERSION)
