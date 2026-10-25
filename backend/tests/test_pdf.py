from app.pdf_export import render_pdf


def report() -> dict:
    return {
        "name": "Test User",
        "start": "2026-03-02",
        "end": "2026-03-15",
        "prepared": "2026-03-10",
        "hours": 9,
        "hours_pay": 190,
        "miles": 10,
        "mileage_pay": 7,
        "expenses": 18.4,
        "combined": 215.4,
        "tasks_done": 1,
        "tasks_open": 0,
        "time_entries": [],
        "mileage_entries": [],
        "expense_entries": [],
        "tasks": [],
        "payouts": [],
    }


def test_pdf_places_the_bow_instead_of_a_drawn_flower():
    data = render_pdf(report())
    assert data.startswith(b"%PDF")
    # The bow is the app logo, embedded as an image with its transparent edge.
    assert b"/Subtype /Image" in data
    assert b"/SMask" in data
    assert len(data) > 50_000
