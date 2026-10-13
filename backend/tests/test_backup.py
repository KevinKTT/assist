import os
import sqlite3
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.backup import prune, prune_remote, seafile_config, snapshot, upload
from app.db import SCHEMA_VERSION, Database, reset_db


def test_snapshot_is_a_readable_copy(tmp_path):
    db_path = tmp_path / "assist.db"
    db = Database(db_path)
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO mileage_entries (drive_date, miles, rate, note, created_at, updated_at)
            VALUES ('2026-03-03', 10, 0.7, 'school', '2026-03-03T00:00:00+00:00', '2026-03-03T00:00:00+00:00')
            """
        )
    db.close()

    copy = snapshot(db_path, tmp_path / "backups")
    assert copy.exists()
    conn = sqlite3.connect(copy)
    try:
        count = conn.execute("SELECT COUNT(*) FROM mileage_entries").fetchone()[0]
    finally:
        conn.close()
    assert count == 1


def test_prune_keeps_recent_hourly_then_daily(tmp_path):
    now = datetime(2026, 10, 13, 12, 30, tzinfo=timezone.utc)
    for hours_back in range(30):
        when = now - timedelta(hours=hours_back)
        (tmp_path / f"assist-{when.strftime('%Y%m%dT%H%M%SZ')}.db").write_bytes(b"x")
    (tmp_path / "not-a-backup.db").write_bytes(b"x")

    removed = prune(tmp_path, keep_hours=24, keep_days=7, now=now)

    remaining = sorted(p.name for p in tmp_path.glob("assist-*.db"))
    # 25 hours inside the window (inclusive of the 24h boundary), plus one
    # snapshot kept for the older day.
    assert len(remaining) == 26
    assert (tmp_path / "not-a-backup.db").exists()
    assert len(removed) == 4


def test_refuses_to_start_with_missing_database(tmp_path):
    db_path = tmp_path / "assist.db"
    Database(db_path).close()
    db_path.unlink()
    with pytest.raises(RuntimeError):
        Database(db_path)


def test_schema_version_is_recorded(tmp_path):
    db_path = tmp_path / "assist.db"
    db = Database(db_path)
    version = db.conn.execute("SELECT value FROM schema_meta WHERE key = 'version'").fetchone()[0]
    db.close()
    assert version == str(SCHEMA_VERSION)


def test_seafile_config_is_optional(monkeypatch):
    for key in ("SEAFILE_URL", "SEAFILE_TOKEN", "SEAFILE_REPO_ID", "SEAFILE_DIR"):
        monkeypatch.delenv(key, raising=False)
    assert seafile_config() is None

    monkeypatch.setenv("SEAFILE_URL", "https://seafile.example.com/")
    monkeypatch.setenv("SEAFILE_TOKEN", "tok")
    monkeypatch.setenv("SEAFILE_REPO_ID", "repo-id")
    cfg = seafile_config()
    assert cfg == {
        "url": "https://seafile.example.com",
        "token": "tok",
        "repo": "repo-id",
        "dir": "/assist-backups/",
    }


def test_upload_posts_to_the_upload_link(tmp_path):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/upload-link/"):
            return httpx.Response(200, json="https://seafile.example.com/seafhttp/upload-abc")
        return httpx.Response(200, json=[{"name": "assist-x.db", "id": "1", "size": 3}])

    cfg = {"url": "https://seafile.example.com", "token": "tok", "repo": "repo-id", "dir": "/assist-backups/"}
    snap = tmp_path / "assist-20260101T000000Z.db"
    snap.write_bytes(b"abc")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        upload(client, snap, cfg)

    link, posted = seen
    assert link.url.path == "/api2/repos/repo-id/upload-link/"
    assert link.url.params["p"] == "/assist-backups/"
    assert link.headers["authorization"] == "Token tok"
    assert str(posted.url) == "https://seafile.example.com/seafhttp/upload-abc"
    assert b"assist-20260101T000000Z.db" in posted.content
    assert b"/assist-backups/" in posted.content


def test_prune_remote_keeps_newest():
    names = [f"assist-2026010{i}T000000Z.db" for i in range(1, 6)]
    listing = [{"name": name, "type": "file"} for name in names]
    listing.append({"name": "readme.txt", "type": "file"})
    deleted: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=listing)
        deleted.append(request.url.params["p"])
        return httpx.Response(200, json="success")

    cfg = {"url": "https://seafile.example.com", "token": "tok", "repo": "repo-id", "dir": "/assist-backups/"}
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        prune_remote(client, cfg, keep=2)

    assert deleted == [
        "/assist-backups/assist-20260103T000000Z.db",
        "/assist-backups/assist-20260102T000000Z.db",
        "/assist-backups/assist-20260101T000000Z.db",
    ]


def test_backup_and_restore_round_trip(tmp_path):
    os.environ["ASSIST_DATA_DIR"] = str(tmp_path)
    reset_db()
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        client.put(
            "/api/settings",
            params={"today": "2026-03-10"},
            json={
                "display_name": "Katie",
                "hourly_rate": 20,
                "mileage_rate": 0.7,
                "cycle": "biweekly",
                "cycle_anchor": "2026-03-02",
                "payday_offset_days": None,
            },
        )
        client.post("/api/time", json={"work_date": "2026-03-03", "hours": 8, "note": "clinic"})
        backup = client.get("/api/backup.json").json()
        assert backup["format"] == "assist-backup"
        assert len(backup["tables"]["time_entries"]) == 1

        client.post("/api/time", json={"work_date": "2026-03-04", "hours": 2, "note": "extra"})
        assert len(client.get("/api/backup.json").json()["tables"]["time_entries"]) == 2

        restored = client.post("/api/restore", json=backup)
        assert restored.status_code == 200
        after = client.get("/api/backup.json").json()["tables"]["time_entries"]
        assert len(after) == 1
        assert after[0]["note"] == "clinic"


def test_restore_rejects_foreign_file(tmp_path):
    os.environ["ASSIST_DATA_DIR"] = str(tmp_path)
    reset_db()
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        bad = client.post(
            "/api/restore",
            json={"format": "something-else", "version": 1, "tables": {}},
        )
        assert bad.status_code == 400
