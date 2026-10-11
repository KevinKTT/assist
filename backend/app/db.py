import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from app.periods import sunday_on_or_before

_db: "Database | None" = None
_lock_init = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="That date doesn't look right") from exc


def parse_dt(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="That time doesn't look right") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def data_dir() -> Path:
    return Path(os.environ.get("ASSIST_DATA_DIR", "data"))


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._init()

    def _init(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              display_name TEXT NOT NULL DEFAULT '',
              hourly_rate REAL NOT NULL DEFAULT 0,
              mileage_rate REAL NOT NULL DEFAULT 0,
              cycle TEXT NOT NULL DEFAULT 'biweekly',
              cycle_anchor TEXT NOT NULL,
              payday_offset_days INTEGER,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS time_entries (
              id INTEGER PRIMARY KEY,
              work_date TEXT NOT NULL,
              hours REAL,
              rate REAL NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              started_at TEXT,
              ended_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mileage_entries (
              id INTEGER PRIMARY KEY,
              drive_date TEXT NOT NULL,
              miles REAL NOT NULL,
              rate REAL NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
              id INTEGER PRIMARY KEY,
              task_date TEXT NOT NULL,
              title TEXT NOT NULL,
              done INTEGER NOT NULL DEFAULT 0,
              done_at TEXT,
              sort_order INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS payouts (
              id INTEGER PRIMARY KEY,
              kind TEXT NOT NULL,
              period_start TEXT NOT NULL,
              period_end TEXT NOT NULL,
              amount REAL NOT NULL,
              paid_on TEXT NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              UNIQUE (kind, period_start, period_end)
            );
            CREATE INDEX IF NOT EXISTS idx_time_date ON time_entries(work_date);
            CREATE INDEX IF NOT EXISTS idx_miles_date ON mileage_entries(drive_date);
            CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(task_date);
            CREATE INDEX IF NOT EXISTS idx_payouts_paid ON payouts(paid_on);
            """
        )
        self.conn.commit()

    @contextmanager
    def transaction(self):
        with self.lock:
            try:
                yield self.conn
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise

    def close(self) -> None:
        self.conn.close()


def get_db() -> Database:
    global _db
    if _db is None:
        with _lock_init:
            if _db is None:
                _db = Database(data_dir() / "assist.db")
    return _db


def reset_db() -> None:
    global _db
    with _lock_init:
        if _db is not None:
            _db.close()
            _db = None


def ensure_settings(conn: sqlite3.Connection, today: date) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    if row:
        return row
    anchor = sunday_on_or_before(today).isoformat()
    conn.execute(
        """
        INSERT INTO settings (
          id, display_name, hourly_rate, mileage_rate, cycle, cycle_anchor, payday_offset_days, updated_at
        ) VALUES (1, '', 0, 0, 'biweekly', ?, NULL, ?)
        """,
        (anchor, now_iso()),
    )
    created = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    if created is None:
        raise HTTPException(status_code=500, detail="Could not save settings")
    return created


def load_settings(today: date) -> dict:
    with get_db().transaction() as conn:
        return dict(ensure_settings(conn, today))
