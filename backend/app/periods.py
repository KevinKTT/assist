from datetime import date, timedelta

CYCLES = ("weekly", "biweekly", "monthly")
MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def sunday_on_or_before(day: date) -> date:
    return day - timedelta(days=(day.weekday() + 1) % 7)


def monday_on_or_before(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_containing(day: date) -> tuple[date, date]:
    start = monday_on_or_before(day)
    return start, start + timedelta(days=6)


def month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    if day.month == 12:
        end = date(day.year, 12, 31)
    else:
        end = date(day.year, day.month + 1, 1) - timedelta(days=1)
    return start, end


def period_containing(day: date, anchor: date, cycle: str) -> tuple[date, date]:
    if cycle == "monthly":
        return month_bounds(day)
    length = 14 if cycle == "biweekly" else 7
    n = (day - anchor).days // length
    start = anchor + timedelta(days=n * length)
    return start, start + timedelta(days=length - 1)


def previous_period(start: date, anchor: date, cycle: str) -> tuple[date, date]:
    return period_containing(start - timedelta(days=1), anchor, cycle)


def next_period(end: date, anchor: date, cycle: str) -> tuple[date, date]:
    return period_containing(end + timedelta(days=1), anchor, cycle)


def payday_for(end: date, offset: int | None) -> date | None:
    if offset is None:
        return None
    return end + timedelta(days=offset)


def iter_dates(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def month_label(key: str) -> str:
    year, month = key.split("-")
    return f"{MONTHS[int(month) - 1]} {year}"


def format_long(day: date) -> str:
    return f"{MONTHS[day.month - 1]} {day.day}, {day.year}"
