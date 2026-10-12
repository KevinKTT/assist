import math
import mimetypes
import os
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from starlette.middleware.gzip import GZipMiddleware

from app.csv_export import render_csv
from app.db import ensure_settings, get_db, load_settings, now_iso, parse_day, parse_dt
from app.money import hours_from_minutes, hours_from_seconds, line_pay, nearest_minutes, q2, q4, sum_amounts, sum_pay
from app.pdf_export import render_pdf
from app.periods import (
    CYCLES,
    iter_dates,
    month_bounds,
    month_label,
    next_period,
    payday_for,
    period_containing,
    previous_period,
    week_containing,
)

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_db()
    yield


app = FastAPI(title="assist", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=500)


class SettingsIn(BaseModel):
    display_name: str = ""
    hourly_rate: float
    mileage_rate: float
    cycle: str
    cycle_anchor: str
    payday_offset_days: int | None = None


class TimeIn(BaseModel):
    work_date: str
    hours: float
    note: str = ""


class TimePatch(BaseModel):
    work_date: str | None = None
    hours: float | None = None
    note: str | None = None


class TimerStart(BaseModel):
    work_date: str
    started_at: str
    note: str = ""


class TimerStop(BaseModel):
    ended_at: str


class TimerAdjust(BaseModel):
    work_date: str
    started_at: str


class MileageIn(BaseModel):
    drive_date: str
    miles: float
    note: str = ""


class MileagePatch(BaseModel):
    drive_date: str | None = None
    miles: float | None = None
    note: str | None = None


class ExpenseIn(BaseModel):
    expense_date: str
    amount: float
    note: str


class ExpensePatch(BaseModel):
    expense_date: str | None = None
    amount: float | None = None
    note: str | None = None


class TaskIn(BaseModel):
    task_date: str
    title: str


class TaskPatch(BaseModel):
    task_date: str | None = None
    title: str | None = None
    done: bool | None = None


class PayoutIn(BaseModel):
    kind: str
    period_start: str
    period_end: str
    paid_on: str
    note: str = ""


def resolve_today(today: str | None) -> date:
    if not today:
        return date.today()
    day = parse_day(today)
    check_sane(day)
    return day


def check_sane(day: date) -> None:
    if day.year < 2000 or day.year > date.today().year + 2:
        raise HTTPException(status_code=400, detail="That date is too far away")


def check_past(day: date) -> None:
    if day > date.today() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="That day hasn't happened yet")


def clean_note(value: str) -> str:
    note = " ".join(value.split())
    if len(note) > 280:
        raise HTTPException(status_code=400, detail="That note is a bit long")
    return note


def clean_title(value: str) -> str:
    title = " ".join(value.split())
    if not title:
        raise HTTPException(status_code=400, detail="Add a task first")
    if len(title) > 120:
        raise HTTPException(status_code=400, detail="That task is a bit long")
    return title


def clean_name(value: str) -> str:
    name = " ".join(value.split())
    if len(name) > 80:
        raise HTTPException(status_code=400, detail="That name is a bit long")
    return name


def check_rate(value: float) -> float:
    if not math.isfinite(value) or value < 0 or value > 10000:
        raise HTTPException(status_code=400, detail="Enter a rate that looks right")
    return q4(value)


def check_hours(value: float) -> float:
    if not math.isfinite(value) or value <= 0 or value > 24:
        raise HTTPException(status_code=400, detail="Enter hours between 0 and 24")
    minutes = nearest_minutes(value)
    if minutes <= 0 or minutes > 24 * 60:
        raise HTTPException(status_code=400, detail="Enter hours between 0 and 24")
    return hours_from_minutes(minutes)


def check_miles(value: float) -> float:
    if not math.isfinite(value) or value <= 0 or value > 2000:
        raise HTTPException(status_code=400, detail="Enter the miles for that drive")
    rounded = q2(value)
    if rounded <= 0:
        raise HTTPException(status_code=400, detail="Enter the miles for that drive")
    return rounded


def check_amount(value: float) -> float:
    if not math.isfinite(value) or value <= 0 or value > 10000:
        raise HTTPException(status_code=400, detail="Enter the amount for that expense")
    rounded = q2(value)
    if rounded <= 0:
        raise HTTPException(status_code=400, detail="Enter the amount for that expense")
    return rounded


def clean_expense_note(value: str) -> str:
    note = clean_note(value)
    if not note:
        raise HTTPException(status_code=400, detail="Say what it was")
    return note


def settings_out(row: dict) -> dict:
    return {
        "display_name": row["display_name"],
        "hourly_rate": row["hourly_rate"],
        "mileage_rate": row["mileage_rate"],
        "cycle": row["cycle"],
        "cycle_anchor": row["cycle_anchor"],
        "payday_offset_days": row["payday_offset_days"],
    }


def payout_out(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "kind": row["kind"],
        "period_start": row["period_start"],
        "period_end": row["period_end"],
        "amount": row["amount"],
        "paid_on": row["paid_on"],
        "note": row["note"],
    }


def time_out(row: dict) -> dict:
    hours = row["hours"]
    return {
        "id": row["id"],
        "date": row["work_date"],
        "hours": hours,
        "rate": row["rate"],
        "pay": line_pay(hours, row["rate"]) if hours is not None else 0,
        "note": row["note"],
        "source": "timer" if row["started_at"] else "manual",
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
    }


def mile_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "date": row["drive_date"],
        "miles": row["miles"],
        "rate": row["rate"],
        "pay": line_pay(row["miles"], row["rate"]),
        "note": row["note"],
    }


def expense_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "date": row["expense_date"],
        "amount": row["amount"],
        "note": row["note"],
    }


def task_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "date": row["task_date"],
        "title": row["title"],
        "done": bool(row["done"]),
        "done_at": row["done_at"],
        "sort_order": row["sort_order"],
    }


def running_out(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "date": row["work_date"],
        "started_at": row["started_at"],
        "created_at": row["created_at"],
        "note": row["note"],
    }


def between(rows: list[dict], key: str, start: date, end: date) -> list[dict]:
    a, b = start.isoformat(), end.isoformat()
    return [row for row in rows if a <= row[key] <= b]


def totals(rows: list[dict], qty_key: str) -> tuple[float, float]:
    qty = 0.0
    pairs: list[tuple[float, float]] = []
    for row in rows:
        qty += row[qty_key]
        pairs.append((row[qty_key], row["rate"]))
    return q2(qty), sum_pay(pairs)


def combined(*parts: float) -> float:
    return sum_amounts(parts)


def payout_index(rows: list[dict]) -> dict[tuple[str, str, str], dict]:
    return {(row["kind"], row["period_start"], row["period_end"]): row for row in rows}


def load_logs(conn) -> tuple[list[dict], list[dict], list[dict], list[dict], list[dict]]:
    time_rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT * FROM time_entries
            WHERE hours IS NOT NULL
            ORDER BY work_date, COALESCE(started_at, created_at), id
            """
        )
    ]
    mile_rows = [
        dict(row)
        for row in conn.execute(
            "SELECT * FROM mileage_entries ORDER BY drive_date, created_at, id"
        )
    ]
    expense_rows = [
        dict(row)
        for row in conn.execute(
            "SELECT * FROM expense_entries ORDER BY expense_date, created_at, id"
        )
    ]
    payout_rows = [dict(row) for row in conn.execute("SELECT * FROM payouts ORDER BY paid_on, id")]
    task_rows = [
        dict(row)
        for row in conn.execute("SELECT * FROM tasks ORDER BY task_date, sort_order, id")
    ]
    return time_rows, mile_rows, payout_rows, task_rows, expense_rows


def period_bounds(start: date, end: date, settings: dict, today: date) -> dict:
    anchor = parse_day(settings["cycle_anchor"])
    cycle = settings["cycle"]
    current_start, _current_end = period_containing(today, anchor, cycle)
    prev_start, _prev_end = previous_period(start, anchor, cycle)
    is_current = start == current_start and end == period_containing(today, anchor, cycle)[1]
    next_start = None
    if not is_current:
        nxt, _nxt_end = next_period(end, anchor, cycle)
        if nxt <= current_start:
            next_start = nxt.isoformat()
    payday = payday_for(end, settings["payday_offset_days"])
    snapped_start, snapped_end = period_containing(start, anchor, cycle)
    return {
        "cycle": cycle,
        "is_current": is_current,
        "prev_start": prev_start.isoformat(),
        "next_start": next_start,
        "payday": payday.isoformat() if payday else None,
        "recorded_only": (start, end) != (snapped_start, snapped_end),
    }


def summarize(start: date, end: date, settings: dict, time_rows, mile_rows, payouts, today: date, expense_rows) -> dict:
    timed = between(time_rows, "work_date", start, end)
    driven = between(mile_rows, "drive_date", start, end)
    spent = between(expense_rows, "expense_date", start, end)
    hours, hours_pay = totals(timed, "hours")
    miles, mileage_pay = totals(driven, "miles")
    expenses = sum_amounts(row["amount"] for row in spent)
    start_iso, end_iso = start.isoformat(), end.isoformat()
    meta = period_bounds(start, end, settings, today)
    return {
        "start": start_iso,
        "end": end_iso,
        "hours": hours,
        "hours_pay": hours_pay,
        "miles": miles,
        "mileage_pay": mileage_pay,
        "expenses": expenses,
        "combined": combined(hours_pay, mileage_pay, expenses),
        "mixed_hour_rates": len({row["rate"] for row in timed}) > 1,
        "mixed_mile_rates": len({row["rate"] for row in driven}) > 1,
        "hours_payout": payout_out(payouts.get(("hours", start_iso, end_iso))),
        "mileage_payout": payout_out(payouts.get(("mileage", start_iso, end_iso))),
        "expenses_payout": payout_out(payouts.get(("expenses", start_iso, end_iso))),
        **meta,
    }


def with_days(summary: dict, time_rows, mile_rows) -> dict:
    start = parse_day(summary["start"])
    end = parse_day(summary["end"])
    days = []
    for day in iter_dates(start, end):
        iso = day.isoformat()
        timed = [row for row in time_rows if row["work_date"] == iso]
        driven = [row for row in mile_rows if row["drive_date"] == iso]
        hours, hours_pay = totals(timed, "hours")
        miles, mileage_pay = totals(driven, "miles")
        days.append({
            "date": iso,
            "hours": hours,
            "hours_pay": hours_pay,
            "miles": miles,
            "mileage_pay": mileage_pay,
            "time_entries": [time_out(row) for row in timed],
            "mileage_entries": [mile_out(row) for row in driven],
        })
    summary["days"] = days
    return summary


def parse_range(start: str, end: str) -> tuple[date, date]:
    first = parse_day(start)
    last = parse_day(end)
    check_sane(first)
    check_sane(last)
    if first > last:
        raise HTTPException(status_code=400, detail="The start date is after the end date")
    if (last - first).days > 366:
        raise HTTPException(status_code=400, detail="Pick a range of a year or less")
    return first, last


def build_report(settings, time_rows, mile_rows, payout_rows, task_rows, expense_rows, start: date, end: date, today: date) -> dict:
    timed = between(time_rows, "work_date", start, end)
    driven = between(mile_rows, "drive_date", start, end)
    spent = between(expense_rows, "expense_date", start, end)
    hours, hours_pay = totals(timed, "hours")
    miles, mileage_pay = totals(driven, "miles")
    expenses = sum_amounts(row["amount"] for row in spent)
    tasks = [task_out(row) for row in task_rows if start.isoformat() <= row["task_date"] <= end.isoformat()]
    payouts = [
        payout_out(row)
        for row in payout_rows
        if start.isoformat() <= row["paid_on"] <= end.isoformat()
    ]
    return {
        "name": settings["display_name"],
        "start": start.isoformat(),
        "end": end.isoformat(),
        "prepared": today.isoformat(),
        "hours": hours,
        "hours_pay": hours_pay,
        "miles": miles,
        "mileage_pay": mileage_pay,
        "expenses": expenses,
        "combined": combined(hours_pay, mileage_pay, expenses),
        "tasks_done": sum(1 for task in tasks if task["done"]),
        "tasks_open": sum(1 for task in tasks if not task["done"]),
        "time_entries": [time_out(row) for row in timed],
        "mileage_entries": [mile_out(row) for row in driven],
        "expense_entries": [expense_out(row) for row in spent],
        "tasks": tasks,
        "payouts": payouts,
    }


def filename(start: date, end: date, ext: str) -> str:
    return f"assist-{start.isoformat()}-to-{end.isoformat()}.{ext}"


@app.get("/api/health")
def health():
    get_db()
    return {"ok": True}


@app.get("/api/settings")
def get_settings(today: str | None = None):
    return settings_out(load_settings(resolve_today(today)))


@app.put("/api/settings")
def put_settings(body: SettingsIn, today: str | None = None):
    day = resolve_today(today)
    name = clean_name(body.display_name)
    hourly = check_rate(body.hourly_rate)
    mileage = check_rate(body.mileage_rate)
    if body.cycle not in CYCLES:
        raise HTTPException(status_code=400, detail="Pick a weekly, biweekly, or monthly cycle")
    anchor = parse_day(body.cycle_anchor)
    check_sane(anchor)
    offset = body.payday_offset_days
    if offset is not None and (offset < 0 or offset > 60):
        raise HTTPException(status_code=400, detail="Payday delay should be between 0 and 60 days")
    with get_db().transaction() as conn:
        ensure_settings(conn, day)
        conn.execute(
            """
            UPDATE settings
            SET display_name = ?, hourly_rate = ?, mileage_rate = ?, cycle = ?, cycle_anchor = ?,
                payday_offset_days = ?, updated_at = ?
            WHERE id = 1
            """,
            (name, hourly, mileage, body.cycle, anchor.isoformat(), offset, now_iso()),
        )
        row = dict(conn.execute("SELECT * FROM settings WHERE id = 1").fetchone())
    return settings_out(row)


@app.get("/api/periods")
def get_period(today: str | None = None, start: str | None = None, end: str | None = None):
    day = resolve_today(today)
    with get_db().transaction() as conn:
        settings = dict(ensure_settings(conn, day))
        time_rows, mile_rows, payout_rows, _tasks, expense_rows = load_logs(conn)
    anchor = parse_day(settings["cycle_anchor"])
    if start and end:
        period_start, period_end = parse_range(start, end)
        if (period_end - period_start).days > 62:
            raise HTTPException(status_code=400, detail="That pay period doesn't look right")
    elif start:
        requested = parse_day(start)
        check_sane(requested)
        period_start, period_end = period_containing(requested, anchor, settings["cycle"])
    else:
        period_start, period_end = period_containing(day, anchor, settings["cycle"])
    summary = summarize(period_start, period_end, settings, time_rows, mile_rows, payout_index(payout_rows), day, expense_rows)
    return with_days(summary, time_rows, mile_rows)


@app.get("/api/history")
def get_history(today: str | None = None):
    day = resolve_today(today)
    with get_db().transaction() as conn:
        settings = dict(ensure_settings(conn, day))
        time_rows, mile_rows, payout_rows, _tasks, expense_rows = load_logs(conn)
    anchor = parse_day(settings["cycle_anchor"])
    cycle = settings["cycle"]
    dates = [day - timedelta(days=60)]
    dates.extend(parse_day(row["work_date"]) for row in time_rows)
    dates.extend(parse_day(row["drive_date"]) for row in mile_rows)
    dates.extend(parse_day(row["expense_date"]) for row in expense_rows)
    dates.extend(parse_day(row["period_start"]) for row in payout_rows)
    dates.extend(parse_day(row["paid_on"]) for row in payout_rows)
    earliest = min(dates)
    payouts = payout_index(payout_rows)
    generated: list[tuple[date, date]] = []
    seen: set[tuple[str, str]] = set()
    start, end = period_containing(day, anchor, cycle)
    for _ in range(80):
        generated.append((start, end))
        seen.add((start.isoformat(), end.isoformat()))
        if start <= earliest:
            break
        start, end = previous_period(start, anchor, cycle)
    extras: list[tuple[date, date]] = []
    for row in payout_rows:
        key = (row["period_start"], row["period_end"])
        if key not in seen:
            extras.append((parse_day(row["period_start"]), parse_day(row["period_end"])))
            seen.add(key)
    periods = []
    for start, end in generated:
        item = summarize(start, end, settings, time_rows, mile_rows, payouts, day, expense_rows)
        item["recorded_only"] = False
        periods.append(item)
    for start, end in extras:
        item = summarize(start, end, settings, time_rows, mile_rows, payouts, day, expense_rows)
        item["recorded_only"] = True
        periods.append(item)
    received: dict[str, float] = {}
    for row in payout_rows:
        key = row["paid_on"][:7]
        received[key] = q2(received.get(key, 0) + row["amount"])
    grouped: dict[str, list[dict]] = {}
    for item in periods:
        grouped.setdefault(item["end"][:7], []).append(item)
    for key in received:
        grouped.setdefault(key, [])
    months = []
    for key in sorted(grouped, reverse=True):
        months.append({
            "month": key,
            "label": month_label(key),
            "received": received.get(key, 0),
            "periods": sorted(grouped[key], key=lambda item: item["start"], reverse=True),
        })
    return months


@app.get("/api/time/running")
def get_running():
    with get_db().transaction() as conn:
        row = conn.execute("SELECT * FROM time_entries WHERE hours IS NULL ORDER BY id DESC LIMIT 1").fetchone()
    return {"running": running_out(dict(row) if row else None)}


@app.post("/api/time")
def create_time(body: TimeIn):
    work_date = parse_day(body.work_date)
    check_sane(work_date)
    check_past(work_date)
    hours = check_hours(body.hours)
    note = clean_note(body.note)
    with get_db().transaction() as conn:
        settings = dict(ensure_settings(conn, date.today()))
        stamp = now_iso()
        cur = conn.execute(
            """
            INSERT INTO time_entries (work_date, hours, rate, note, started_at, ended_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
            """,
            (work_date.isoformat(), hours, settings["hourly_rate"], note, stamp, stamp),
        )
        row = dict(conn.execute("SELECT * FROM time_entries WHERE id = ?", (cur.lastrowid,)).fetchone())
    return time_out(row)


@app.patch("/api/time/running")
def adjust_timer(body: TimerAdjust):
    work_date = parse_day(body.work_date)
    check_sane(work_date)
    check_past(work_date)
    started = parse_dt(body.started_at)
    now = parse_dt(now_iso())
    if started > now + timedelta(minutes=2):
        raise HTTPException(status_code=400, detail="That start is still in the future")
    if abs((work_date - started.date()).days) > 2:
        raise HTTPException(status_code=400, detail="That day doesn't match the start")
    with get_db().transaction() as conn:
        row = conn.execute("SELECT * FROM time_entries WHERE hours IS NULL ORDER BY id DESC LIMIT 1").fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="No timer is running")
        current = dict(row)
        created = parse_dt(current["created_at"])
        if started < created - timedelta(hours=24, minutes=1):
            raise HTTPException(status_code=400, detail="That's too far back")
        conn.execute(
            "UPDATE time_entries SET work_date = ?, started_at = ?, updated_at = ? WHERE id = ?",
            (work_date.isoformat(), started.isoformat(), now_iso(), current["id"]),
        )
        updated = dict(conn.execute("SELECT * FROM time_entries WHERE id = ?", (current["id"],)).fetchone())
    return running_out(updated)


@app.patch("/api/time/{entry_id}")
def patch_time(entry_id: int, body: TimePatch):
    with get_db().transaction() as conn:
        row = conn.execute("SELECT * FROM time_entries WHERE id = ?", (entry_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="That entry isn't there anymore")
        current = dict(row)
        if current["hours"] is None and body.hours is not None:
            raise HTTPException(status_code=400, detail="Stop the timer first")
        work_date = current["work_date"]
        if body.work_date is not None:
            day = parse_day(body.work_date)
            check_sane(day)
            check_past(day)
            work_date = day.isoformat()
        hours = current["hours"] if body.hours is None else check_hours(body.hours)
        note = current["note"] if body.note is None else clean_note(body.note)
        conn.execute(
            "UPDATE time_entries SET work_date = ?, hours = ?, note = ?, updated_at = ? WHERE id = ?",
            (work_date, hours, note, now_iso(), entry_id),
        )
        updated = dict(conn.execute("SELECT * FROM time_entries WHERE id = ?", (entry_id,)).fetchone())
    return time_out(updated)


@app.delete("/api/time/{entry_id}")
def delete_time(entry_id: int):
    with get_db().transaction() as conn:
        cur = conn.execute("DELETE FROM time_entries WHERE id = ?", (entry_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="That entry isn't there anymore")
    return {"ok": True}


@app.post("/api/time/start")
def start_timer(body: TimerStart):
    work_date = parse_day(body.work_date)
    check_sane(work_date)
    check_past(work_date)
    started = parse_dt(body.started_at)
    note = clean_note(body.note)
    with get_db().transaction() as conn:
        existing = conn.execute("SELECT id FROM time_entries WHERE hours IS NULL").fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="A timer is already running")
        settings = dict(ensure_settings(conn, date.today()))
        stamp = now_iso()
        cur = conn.execute(
            """
            INSERT INTO time_entries (work_date, hours, rate, note, started_at, ended_at, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, NULL, ?, ?)
            """,
            (work_date.isoformat(), settings["hourly_rate"], note, started.isoformat(), stamp, stamp),
        )
        row = dict(conn.execute("SELECT * FROM time_entries WHERE id = ?", (cur.lastrowid,)).fetchone())
    return running_out(row)


@app.post("/api/time/stop")
def stop_timer(body: TimerStop):
    ended = parse_dt(body.ended_at)
    now = parse_dt(now_iso())
    if ended > now + timedelta(minutes=2):
        ended = now
    with get_db().transaction() as conn:
        row = conn.execute("SELECT * FROM time_entries WHERE hours IS NULL ORDER BY id DESC LIMIT 1").fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="No timer is running")
        current = dict(row)
        started = parse_dt(current["started_at"])
        if ended < started:
            raise HTTPException(status_code=400, detail="That end time is before the start")
        elapsed = int((ended - started).total_seconds())
        if elapsed < 30:
            conn.execute("DELETE FROM time_entries WHERE id = ?", (current["id"],))
            return {"discarded": True, "entry": None}
        settings = dict(ensure_settings(conn, date.today()))
        hours = hours_from_seconds(elapsed)
        if hours <= 0:
            hours = 0.01
        conn.execute(
            """
            UPDATE time_entries
            SET hours = ?, rate = ?, ended_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (hours, settings["hourly_rate"], ended.isoformat(), now_iso(), current["id"]),
        )
        updated = dict(conn.execute("SELECT * FROM time_entries WHERE id = ?", (current["id"],)).fetchone())
    return {"discarded": False, "entry": time_out(updated)}


@app.post("/api/mileage")
def create_mileage(body: MileageIn):
    drive_date = parse_day(body.drive_date)
    check_sane(drive_date)
    check_past(drive_date)
    miles = check_miles(body.miles)
    note = clean_note(body.note)
    with get_db().transaction() as conn:
        settings = dict(ensure_settings(conn, date.today()))
        stamp = now_iso()
        cur = conn.execute(
            """
            INSERT INTO mileage_entries (drive_date, miles, rate, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (drive_date.isoformat(), miles, settings["mileage_rate"], note, stamp, stamp),
        )
        row = dict(conn.execute("SELECT * FROM mileage_entries WHERE id = ?", (cur.lastrowid,)).fetchone())
    return mile_out(row)


@app.patch("/api/mileage/{entry_id}")
def patch_mileage(entry_id: int, body: MileagePatch):
    with get_db().transaction() as conn:
        row = conn.execute("SELECT * FROM mileage_entries WHERE id = ?", (entry_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="That drive isn't there anymore")
        current = dict(row)
        drive_date = current["drive_date"]
        if body.drive_date is not None:
            day = parse_day(body.drive_date)
            check_sane(day)
            check_past(day)
            drive_date = day.isoformat()
        miles = current["miles"] if body.miles is None else check_miles(body.miles)
        note = current["note"] if body.note is None else clean_note(body.note)
        conn.execute(
            "UPDATE mileage_entries SET drive_date = ?, miles = ?, note = ?, updated_at = ? WHERE id = ?",
            (drive_date, miles, note, now_iso(), entry_id),
        )
        updated = dict(conn.execute("SELECT * FROM mileage_entries WHERE id = ?", (entry_id,)).fetchone())
    return mile_out(updated)


@app.delete("/api/mileage/{entry_id}")
def delete_mileage(entry_id: int):
    with get_db().transaction() as conn:
        cur = conn.execute("DELETE FROM mileage_entries WHERE id = ?", (entry_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="That drive isn't there anymore")
    return {"ok": True}


@app.post("/api/expenses")
def create_expense(body: ExpenseIn):
    expense_date = parse_day(body.expense_date)
    check_sane(expense_date)
    check_past(expense_date)
    amount = check_amount(body.amount)
    note = clean_expense_note(body.note)
    with get_db().transaction() as conn:
        stamp = now_iso()
        cur = conn.execute(
            """
            INSERT INTO expense_entries (expense_date, amount, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (expense_date.isoformat(), amount, note, stamp, stamp),
        )
        row = dict(conn.execute("SELECT * FROM expense_entries WHERE id = ?", (cur.lastrowid,)).fetchone())
    return expense_out(row)


@app.patch("/api/expenses/{entry_id}")
def patch_expense(entry_id: int, body: ExpensePatch):
    with get_db().transaction() as conn:
        row = conn.execute("SELECT * FROM expense_entries WHERE id = ?", (entry_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="That expense isn't there anymore")
        current = dict(row)
        expense_date = current["expense_date"]
        if body.expense_date is not None:
            day = parse_day(body.expense_date)
            check_sane(day)
            check_past(day)
            expense_date = day.isoformat()
        amount = current["amount"] if body.amount is None else check_amount(body.amount)
        note = current["note"] if body.note is None else clean_expense_note(body.note)
        conn.execute(
            "UPDATE expense_entries SET expense_date = ?, amount = ?, note = ?, updated_at = ? WHERE id = ?",
            (expense_date, amount, note, now_iso(), entry_id),
        )
        updated = dict(conn.execute("SELECT * FROM expense_entries WHERE id = ?", (entry_id,)).fetchone())
    return expense_out(updated)


@app.delete("/api/expenses/{entry_id}")
def delete_expense(entry_id: int):
    with get_db().transaction() as conn:
        cur = conn.execute("DELETE FROM expense_entries WHERE id = ?", (entry_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="That expense isn't there anymore")
    return {"ok": True}


@app.get("/api/tasks")
def get_tasks(start: str = Query(...), end: str = Query(...)):
    first, last = parse_range(start, end)
    with get_db().transaction() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE task_date BETWEEN ? AND ? ORDER BY task_date, sort_order, id",
            (first.isoformat(), last.isoformat()),
        ).fetchall()
    return [task_out(dict(row)) for row in rows]


@app.post("/api/tasks")
def create_task(body: TaskIn):
    task_date = parse_day(body.task_date)
    check_sane(task_date)
    title = clean_title(body.title)
    with get_db().transaction() as conn:
        current = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM tasks WHERE task_date = ?",
            (task_date.isoformat(),),
        ).fetchone()[0]
        stamp = now_iso()
        cur = conn.execute(
            """
            INSERT INTO tasks (task_date, title, done, done_at, sort_order, created_at, updated_at)
            VALUES (?, ?, 0, NULL, ?, ?, ?)
            """,
            (task_date.isoformat(), title, current + 1, stamp, stamp),
        )
        row = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone())
    return task_out(row)


@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: int, body: TaskPatch):
    with get_db().transaction() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="That task isn't there anymore")
        current = dict(row)
        task_date = current["task_date"]
        if body.task_date is not None:
            day = parse_day(body.task_date)
            check_sane(day)
            task_date = day.isoformat()
        title = current["title"] if body.title is None else clean_title(body.title)
        done = current["done"] if body.done is None else int(body.done)
        done_at = current["done_at"]
        if body.done is not None:
            done_at = now_iso() if body.done else None
        conn.execute(
            """
            UPDATE tasks
            SET task_date = ?, title = ?, done = ?, done_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (task_date, title, done, done_at, now_iso(), task_id),
        )
        updated = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
    return task_out(updated)


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    with get_db().transaction() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="That task isn't there anymore")
    return {"ok": True}


@app.post("/api/payouts")
def create_payout(body: PayoutIn):
    if body.kind not in ("hours", "mileage", "expenses", "both"):
        raise HTTPException(status_code=400, detail="Pick hours, miles, or expenses")
    start = parse_day(body.period_start)
    end = parse_day(body.period_end)
    paid_on = parse_day(body.paid_on)
    check_sane(start)
    check_sane(end)
    check_sane(paid_on)
    check_past(paid_on)
    if start > end or (end - start).days > 62:
        raise HTTPException(status_code=400, detail="That pay period doesn't look right")
    note = clean_note(body.note)
    kinds = ("hours", "mileage", "expenses") if body.kind == "both" else (body.kind,)
    saved: dict[str, dict] = {}
    created = 0
    with get_db().transaction() as conn:
        for kind in kinds:
            existing = conn.execute(
                "SELECT * FROM payouts WHERE kind = ? AND period_start = ? AND period_end = ?",
                (kind, start.isoformat(), end.isoformat()),
            ).fetchone()
            if existing:
                saved[kind] = payout_out(dict(existing))
                continue
            if kind == "hours":
                rows = conn.execute(
                    """
                    SELECT hours, rate FROM time_entries
                    WHERE work_date BETWEEN ? AND ? AND hours IS NOT NULL
                    """,
                    (start.isoformat(), end.isoformat()),
                ).fetchall()
                amount = sum_pay([(row["hours"], row["rate"]) for row in rows])
            elif kind == "mileage":
                rows = conn.execute(
                    "SELECT miles, rate FROM mileage_entries WHERE drive_date BETWEEN ? AND ?",
                    (start.isoformat(), end.isoformat()),
                ).fetchall()
                amount = sum_pay([(row["miles"], row["rate"]) for row in rows])
            else:
                rows = conn.execute(
                    "SELECT amount FROM expense_entries WHERE expense_date BETWEEN ? AND ?",
                    (start.isoformat(), end.isoformat()),
                ).fetchall()
                amount = sum_amounts(row["amount"] for row in rows)
            cur = conn.execute(
                """
                INSERT INTO payouts (kind, period_start, period_end, amount, paid_on, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (kind, start.isoformat(), end.isoformat(), amount, paid_on.isoformat(), note, now_iso()),
            )
            row = dict(conn.execute("SELECT * FROM payouts WHERE id = ?", (cur.lastrowid,)).fetchone())
            saved[kind] = payout_out(row)
            created += 1
    if created == 0:
        raise HTTPException(status_code=409, detail="This period is already marked paid")
    if body.kind == "both":
        return saved
    return saved[body.kind]


@app.delete("/api/payouts/{payout_id}")
def delete_payout(payout_id: int):
    with get_db().transaction() as conn:
        cur = conn.execute("DELETE FROM payouts WHERE id = ?", (payout_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="That payout isn't there anymore")
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard(today: str | None = None, start: str | None = None, end: str | None = None):
    day = resolve_today(today)
    with get_db().transaction() as conn:
        settings = dict(ensure_settings(conn, day))
        time_rows, mile_rows, payout_rows, task_rows, expense_rows = load_logs(conn)
    anchor = parse_day(settings["cycle_anchor"])
    period_start, period_end = period_containing(day, anchor, settings["cycle"])
    if start and end:
        range_start, range_end = parse_range(start, end)
    elif start or end:
        raise HTTPException(status_code=400, detail="Pick both a start and an end")
    else:
        range_start, range_end = period_start, period_end
    payouts = payout_index(payout_rows)
    period = summarize(period_start, period_end, settings, time_rows, mile_rows, payouts, day, expense_rows)
    worked = {
        row["work_date"]
        for row in between(time_rows, "work_date", period_start, period_end)
        if row["hours"] > 0
    }
    week_start, week_end = week_containing(day)
    week_tasks = [row for row in task_rows if week_start.isoformat() <= row["task_date"] <= week_end.isoformat()]
    today_iso = day.isoformat()
    today_hours, _today_pay = totals([row for row in time_rows if row["work_date"] == today_iso], "hours")
    today_miles, _today_mile_pay = totals([row for row in mile_rows if row["drive_date"] == today_iso], "miles")
    month_start, month_end = month_bounds(day)
    received = 0.0
    for row in payout_rows:
        if month_start.isoformat() <= row["paid_on"] <= month_end.isoformat():
            received = q2(received + row["amount"])
    report = build_report(settings, time_rows, mile_rows, payout_rows, task_rows, expense_rows, range_start, range_end, day)
    series = []
    hours_by_day: dict[str, float] = {}
    miles_by_day: dict[str, float] = {}
    for row in between(time_rows, "work_date", range_start, range_end):
        hours_by_day[row["work_date"]] = q2(hours_by_day.get(row["work_date"], 0) + row["hours"])
    for row in between(mile_rows, "drive_date", range_start, range_end):
        miles_by_day[row["drive_date"]] = q2(miles_by_day.get(row["drive_date"], 0) + row["miles"])
    for point in iter_dates(range_start, range_end):
        iso = point.isoformat()
        series.append({"date": iso, "hours": hours_by_day.get(iso, 0), "miles": miles_by_day.get(iso, 0)})
    return {
        "period": {
            "start": period["start"],
            "end": period["end"],
            "hours": period["hours"],
            "hours_pay": period["hours_pay"],
            "miles": period["miles"],
            "mileage_pay": period["mileage_pay"],
            "expenses": period["expenses"],
            "combined": period["combined"],
            "days_worked": len(worked),
            "hours_payout": period["hours_payout"],
            "mileage_payout": period["mileage_payout"],
            "expenses_payout": period["expenses_payout"],
            "payday": period["payday"],
        },
        "week": {
            "start": week_start.isoformat(),
            "end": week_end.isoformat(),
            "tasks_done": sum(1 for row in week_tasks if row["done"]),
            "tasks_open": sum(1 for row in week_tasks if not row["done"]),
        },
        "today": {
            "date": today_iso,
            "hours": today_hours,
            "miles": today_miles,
            "tasks_open": sum(1 for row in task_rows if row["task_date"] == today_iso and not row["done"]),
        },
        "month_received": received,
        "range": {
            "start": report["start"],
            "end": report["end"],
            "hours": report["hours"],
            "hours_pay": report["hours_pay"],
            "miles": report["miles"],
            "mileage_pay": report["mileage_pay"],
            "expenses": report["expenses"],
            "combined": report["combined"],
            "tasks_done": report["tasks_done"],
            "tasks_open": report["tasks_open"],
            "expense_entries": report["expense_entries"],
            "series": series,
        },
    }


@app.get("/api/export/csv")
def export_csv(start: str, end: str, today: str | None = None):
    day = resolve_today(today)
    first, last = parse_range(start, end)
    with get_db().transaction() as conn:
        settings = dict(ensure_settings(conn, day))
        time_rows, mile_rows, payout_rows, task_rows, expense_rows = load_logs(conn)
    report = build_report(settings, time_rows, mile_rows, payout_rows, task_rows, expense_rows, first, last, day)
    return Response(
        content=render_csv(report),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename(first, last, "csv")}"'},
    )


@app.get("/api/export/pdf")
def export_pdf(start: str, end: str, today: str | None = None):
    day = resolve_today(today)
    first, last = parse_range(start, end)
    with get_db().transaction() as conn:
        settings = dict(ensure_settings(conn, day))
        time_rows, mile_rows, payout_rows, task_rows, expense_rows = load_logs(conn)
    report = build_report(settings, time_rows, mile_rows, payout_rows, task_rows, expense_rows, first, last, day)
    return Response(
        content=render_pdf(report),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename(first, last, "pdf")}"'},
    )


def mount_static() -> None:
    raw = os.environ.get("ASSIST_STATIC_DIR")
    if not raw:
        return
    static = Path(raw).resolve()
    if not static.is_dir():
        return

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (static / full_path).resolve()
        if not str(candidate).startswith(str(static)):
            raise HTTPException(status_code=404, detail="Not found")
        if candidate.is_file():
            return FileResponse(candidate)
        if "." in Path(full_path).name:
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(static / "index.html")


mount_static()
