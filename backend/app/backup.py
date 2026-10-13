"""Database snapshots, retention, and optional off-host copies to Seafile.

The snapshot step is local and always runs. Shipping a snapshot to Seafile is
best-effort and only happens when the SEAFILE_* environment variables are set,
so a Seafile outage can never affect the app itself.
"""

import logging
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from app.db import backup_dir

log = logging.getLogger("assist.backup")

STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
PREFIX = "assist-"
SUFFIX = ".db"

DEFAULT_INTERVAL_SECONDS = 3600
DEFAULT_KEEP_HOURS = 24
DEFAULT_KEEP_DAYS = 7
REMOTE_KEEP = 30

_backup_thread: threading.Thread | None = None
_stop = threading.Event()


def _stamp(when: datetime | None = None) -> str:
    return (when or datetime.now(timezone.utc)).strftime(STAMP_FORMAT)


def _parse_stamp(name: str) -> datetime | None:
    if not (name.startswith(PREFIX) and name.endswith(SUFFIX)):
        return None
    core = name[len(PREFIX) : -len(SUFFIX)]
    try:
        return datetime.strptime(core, STAMP_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def snapshot(db_path: Path, dest_dir: Path, when: datetime | None = None) -> Path:
    """Write a consistent copy of the live database using SQLite's online backup API."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{PREFIX}{_stamp(when)}{SUFFIX}"
    source = sqlite3.connect(db_path)
    target = sqlite3.connect(dest)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return dest


def _retention_keep(
    stamps: list[tuple[datetime, str]],
    now: datetime,
    keep_hours: int,
    keep_days: int,
) -> set[str]:
    """Keep the newest snapshot per hour for keep_hours, then per day for keep_days."""
    ordered = sorted(stamps, key=lambda item: item[0], reverse=True)
    keep: set[str] = set()
    hours: set[str] = set()
    for when, name in ordered:
        if (now - when) <= timedelta(hours=keep_hours):
            key = when.strftime("%Y%m%d%H")
            if key not in hours:
                hours.add(key)
                keep.add(name)
    days: set[str] = set()
    for when, name in ordered:
        if (now - when) > timedelta(hours=keep_hours):
            key = when.strftime("%Y%m%d")
            if key not in days and len(days) < keep_days:
                days.add(key)
                keep.add(name)
    return keep


def prune(
    dest_dir: Path,
    keep_hours: int = DEFAULT_KEEP_HOURS,
    keep_days: int = DEFAULT_KEEP_DAYS,
    now: datetime | None = None,
) -> list[Path]:
    now = now or datetime.now(timezone.utc)
    stamps: list[tuple[datetime, str]] = []
    files: dict[str, Path] = {}
    for path in dest_dir.glob(f"{PREFIX}*{SUFFIX}"):
        when = _parse_stamp(path.name)
        if when is not None:
            stamps.append((when, path.name))
            files[path.name] = path
    keep = _retention_keep(stamps, now, keep_hours, keep_days)
    removed: list[Path] = []
    for name, path in files.items():
        if name in keep:
            continue
        try:
            path.unlink()
            removed.append(path)
        except OSError:
            log.warning("could not remove old backup %s", path)
    return removed


def seafile_config() -> dict[str, str] | None:
    url = os.environ.get("SEAFILE_URL", "").rstrip("/")
    token = os.environ.get("SEAFILE_TOKEN", "")
    repo = os.environ.get("SEAFILE_REPO_ID", "")
    if not (url and token and repo):
        return None
    directory = os.environ.get("SEAFILE_DIR", "/assist-backups").strip() or "/assist-backups"
    if not directory.startswith("/"):
        directory = "/" + directory
    if not directory.endswith("/"):
        directory += "/"
    return {"url": url, "token": token, "repo": repo, "dir": directory}


def _headers(cfg: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Token {cfg['token']}"}


def upload(client: httpx.Client, path: Path, cfg: dict[str, str]) -> None:
    link = client.get(
        f"{cfg['url']}/api2/repos/{cfg['repo']}/upload-link/",
        params={"p": cfg["dir"]},
        headers=_headers(cfg),
    )
    link.raise_for_status()
    with path.open("rb") as handle:
        response = client.post(
            link.json(),
            data={"parent_dir": cfg["dir"], "replace": "0"},
            files={"file": (path.name, handle, "application/octet-stream")},
        )
    response.raise_for_status()


def list_remote(client: httpx.Client, cfg: dict[str, str]) -> list[str]:
    response = client.get(
        f"{cfg['url']}/api2/repos/{cfg['repo']}/dir/",
        params={"p": cfg["dir"]},
        headers=_headers(cfg),
    )
    response.raise_for_status()
    return [entry["name"] for entry in response.json() if entry.get("type") == "file"]


def delete_remote(client: httpx.Client, cfg: dict[str, str], name: str) -> None:
    response = client.delete(
        f"{cfg['url']}/api2/repos/{cfg['repo']}/file/",
        params={"p": f"{cfg['dir']}{name}"},
        headers=_headers(cfg),
    )
    response.raise_for_status()


def prune_remote(client: httpx.Client, cfg: dict[str, str], keep: int = REMOTE_KEEP) -> None:
    names = [name for name in list_remote(client, cfg) if _parse_stamp(name) is not None]
    stamps = [(_parse_stamp(name), name) for name in names]
    ordered = sorted(stamps, key=lambda item: item[0], reverse=True)  # type: ignore[arg-type,return-value]
    for _, name in ordered[keep:]:
        try:
            delete_remote(client, cfg, name)
        except Exception:
            log.warning("could not remove old remote backup %s", name)


def run_backup(db_path: Path, interval_seconds: int = DEFAULT_INTERVAL_SECONDS) -> None:
    if not db_path.exists():
        log.warning("database %s is gone; skipping backup", db_path)
        return
    dest = backup_dir()
    try:
        snap = snapshot(db_path, dest)
    except Exception:
        log.exception("could not snapshot the database")
        return
    prune(dest)
    cfg = seafile_config()
    if not cfg:
        return
    try:
        with httpx.Client(timeout=30) as client:
            upload(client, snap, cfg)
            prune_remote(client, cfg)
    except Exception:
        log.warning("could not upload backup to Seafile", exc_info=True)


def start_backup_thread(db_path: Path, interval_seconds: int = DEFAULT_INTERVAL_SECONDS) -> None:
    global _backup_thread
    if _backup_thread is not None:
        return

    def loop() -> None:
        while True:
            try:
                run_backup(db_path, interval_seconds)
            except Exception:
                log.exception("backup cycle failed")
            if _stop.wait(interval_seconds):
                return

    _backup_thread = threading.Thread(target=loop, name="assist-backup", daemon=True)
    _backup_thread.start()
