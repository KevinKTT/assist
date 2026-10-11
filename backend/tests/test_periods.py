from datetime import date

from app.periods import month_bounds, period_containing, previous_period, sunday_on_or_before, week_containing


def test_biweekly_from_anchor():
    anchor = date(2026, 3, 2)
    start, end = period_containing(date(2026, 3, 10), anchor, "biweekly")
    assert start == date(2026, 3, 2)
    assert end == date(2026, 3, 15)


def test_biweekly_next_boundary():
    anchor = date(2026, 3, 2)
    start, end = period_containing(date(2026, 3, 16), anchor, "biweekly")
    assert start == date(2026, 3, 16)
    assert end == date(2026, 3, 29)


def test_period_before_anchor():
    anchor = date(2026, 3, 1)
    start, end = period_containing(date(2026, 2, 28), anchor, "weekly")
    assert start == date(2026, 2, 22)
    assert end == date(2026, 2, 28)


def test_monthly_ignores_anchor_and_handles_leap_and_december():
    assert month_bounds(date(2024, 2, 10)) == (date(2024, 2, 1), date(2024, 2, 29))
    assert period_containing(date(2026, 3, 10), date(2026, 3, 15), "monthly") == (
        date(2026, 3, 1),
        date(2026, 3, 31),
    )
    assert period_containing(date(2026, 12, 15), date(2026, 1, 1), "monthly")[1] == date(2026, 12, 31)


def test_previous_month():
    start, end = previous_period(date(2026, 3, 1), date(2026, 1, 1), "monthly")
    assert start == date(2026, 2, 1)
    assert end == date(2026, 2, 28)


def test_week_starts_sunday():
    assert sunday_on_or_before(date(2026, 3, 10)) == date(2026, 3, 8)
    assert week_containing(date(2026, 3, 8)) == (date(2026, 3, 8), date(2026, 3, 14))
