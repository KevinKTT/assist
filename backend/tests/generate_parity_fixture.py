"""Generate a fixture the web client uses to prove its offline maths match the server.

Run from backend/:  uv run python tests/generate_parity_fixture.py
"""

import json
import os
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import reset_db
from app.main import app

TODAY = "2026-03-10"
OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "domain" / "__fixtures__" / "parity.json"


def build():
    tmp = tempfile.mkdtemp(prefix="assist-parity-")
    os.environ["ASSIST_DATA_DIR"] = tmp
    reset_db()
    client = TestClient(app)
    client.__enter__()
    client.put(
        "/api/settings",
        params={"today": TODAY},
        json={
            "display_name": "Test User",
            "hourly_rate": 20,
            "mileage_rate": 0.7,
            "cycle": "biweekly",
            "cycle_anchor": "2026-03-02",
            "payday_offset_days": 5,
        },
    )
    client.post("/api/time", json={"work_date": "2026-03-03", "hours": 8, "note": "clinic"})
    client.post("/api/time", json={"work_date": "2026-03-04", "hours": 1, "note": ""})
    client.post("/api/mileage", json={"drive_date": "2026-03-03", "miles": 10, "note": "school"})
    client.post("/api/expenses", json={"expense_date": "2026-03-03", "amount": 18.4, "note": "Uber back"})
    task = client.post("/api/tasks", json={"task_date": "2026-03-11", "title": "Call school"}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"done": True})
    period = client.get("/api/periods", params={"today": TODAY}).json()
    client.post(
        "/api/payouts",
        json={
            "kind": "both",
            "period_start": period["start"],
            "period_end": period["end"],
            "paid_on": "2026-03-20",
            "note": "check",
        },
    )

    inputs = client.get("/api/sync", params={"today": TODAY}).json()
    expected = {
        "period": client.get("/api/periods", params={"today": TODAY}).json(),
        "history": client.get("/api/history", params={"today": TODAY}).json(),
        "dashboard": client.get("/api/dashboard", params={"today": TODAY}).json(),
    }
    client.__exit__(None, None, None)
    return {"today": TODAY, "inputs": inputs, "expected": expected}


def main():
    fixture = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=2, sort_keys=True))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
