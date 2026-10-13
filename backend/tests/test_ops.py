import os

from fastapi.testclient import TestClient

from app.db import reset_db
from app.heartbeat import heartbeat_seconds, heartbeat_url
from app.main import app


def make_client(tmp_path):
    os.environ["ASSIST_DATA_DIR"] = str(tmp_path)
    reset_db()
    return TestClient(app)


def test_health_and_readiness(tmp_path):
    with make_client(tmp_path) as client:
        assert client.get("/api/health").json() == {"ok": True}
        ready = client.get("/api/ready")
        assert ready.status_code == 200
        assert ready.json() == {"database": True, "backups": True, "ok": True}


def test_readiness_fails_when_backups_are_not_writable(tmp_path, monkeypatch):
    blocker = tmp_path / "blocked"
    blocker.write_text("not a directory")
    monkeypatch.setenv("ASSIST_BACKUP_DIR", str(blocker / "nested"))
    with make_client(tmp_path) as client:
        ready = client.get("/api/ready")
        assert ready.status_code == 503
        body = ready.json()
        assert body["backups"] is False
        assert body["ok"] is False


def test_heartbeat_configuration(monkeypatch):
    monkeypatch.delenv("ASSIST_HEARTBEAT_URL", raising=False)
    assert heartbeat_url() is None

    monkeypatch.setenv("ASSIST_HEARTBEAT_URL", "  https://hc-ping.com/abc  ")
    assert heartbeat_url() == "https://hc-ping.com/abc"

    monkeypatch.setenv("ASSIST_HEARTBEAT_SECONDS", "5")
    assert heartbeat_seconds() == 15

    monkeypatch.setenv("ASSIST_HEARTBEAT_SECONDS", "nonsense")
    assert heartbeat_seconds() == 60
