import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from app.periods import sunday_on_or_before

_db: "Database | None" = None
_lock_init = threading.Lock()

SCHEMA_VERSION = 2

UID_TABLES = ("time_entries", "mileage_entries", "expense_entries", "tasks", "payouts")


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


def backup_dir() -> Path:
    return Path(os.environ.get("ASSIST_BACKUP_DIR", str(data_dir() / "backups")))


def _marker_path(db_path: Path) -> Path:
    return db_path.parent / (db_path.name + ".initialized")


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._guard_existing(path)
        self.conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self._configure()
        self._check_integrity()
        self._migrate()
        _marker_path(path).touch()

    @staticmethod
    def _guard_existing(path: Path) -> None:
        """Refuse to silently start with an empty database.

        SQLite creates the file on connect, so a failed volume mount would look
        exactly like every record disappearing. If this directory was used
        before (marker present) but the file is gone or empty, stop loudly.
        """
        if not _marker_path(path).exists():
            return
        if not path.exists() or path.stat().st_size == 0:
            raise RuntimeError(
                f"Database {path} is missing or empty, but this data directory was "
                "used before. Refusing to start with a blank database. Restore a "
                "backup, or delete the marker file "
                f"{_marker_path(path)} if you really mean to start fresh."
            )

    def _configure(self) -> None:
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        # Durability over speed: this is a tiny single-user database, so we can
        # afford to fsync every commit and not lose the last write on a crash.
        self.conn.execute("PRAGMA synchronous=FULL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.execute("PRAGMA wal_autocheckpoint=1000")

    def _check_integrity(self) -> None:
        row = self.conn.execute("PRAGMA integrity_check").fetchone()
        result = row[0] if row else "unknown"
        if result != "ok":
            raise RuntimeError(f"Database integrity check failed: {result}")

    def _migrate(self) -> None:
        conn = self.conn
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        row = conn.execute("SELECT value FROM schema_meta WHERE key = 'version'").fetchone()
        version = int(row["value"]) if row else 0
        self._create_base()
        if version < 1:
            version = 1
        if version < 2:
            self._add_uids()
            version = 2
        if version != SCHEMA_VERSION:
            raise RuntimeError(
                f"Database schema is version {version}, but this build expects "
                f"{SCHEMA_VERSION}. Refusing to start with an unknown schema."
            )
        conn.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(version),),
        )
        conn.commit()

    def _add_uids(self) -> None:
        """Give every row a stable client-facing id so writes can be retried safely."""
        conn = self.conn
        for table in UID_TABLES:
            columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            if "uid" not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN uid TEXT")
        for table in UID_TABLES:
            rows = conn.execute(f"SELECT id FROM {table} WHERE uid IS NULL OR uid = ''").fetchall()
            for row in rows:
                conn.execute(f"UPDATE {table} SET uid = ? WHERE id = ?", (uuid4().hex, row["id"]))
        for table in UID_TABLES:
            conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_uid ON {table}(uid)")

    def _create_base(self) -> None:
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
            CREATE TABLE IF NOT EXISTS expense_entries (
              id INTEGER PRIMARY KEY,
              expense_date TEXT NOT NULL,
              amount REAL NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_time_date ON time_entries(work_date);
            CREATE INDEX IF NOT EXISTS idx_miles_date ON mileage_entries(drive_date);
            CREATE INDEX IF NOT EXISTS idx_expenses_date ON expense_entries(expense_date);
            CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(task_date);
            CREATE INDEX IF NOT EXISTS idx_payouts_paid ON payouts(paid_on);
            """
        )
        self.conn.execute(
            """
            INSERT INTO payouts (kind, period_start, period_end, amount, paid_on, note, created_at)
            SELECT 'expenses', h.period_start, h.period_end, 0, h.paid_on, '', h.created_at
            FROM payouts h
            INNER JOIN payouts m
              ON m.kind = 'mileage'
             AND m.period_start = h.period_start
             AND m.period_end = h.period_end
            WHERE h.kind = 'hours'
              AND NOT EXISTS (
                SELECT 1 FROM payouts e
                WHERE e.kind = 'expenses'
                  AND e.period_start = h.period_start
                  AND e.period_end = h.period_end
              )
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
