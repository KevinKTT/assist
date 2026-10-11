import csv
from io import StringIO

from app.money import duration


def csv_safe(value: str) -> str:
    if value and value[0] in "=+-@":
        return "'" + value
    return value


def render_csv(report: dict) -> bytes:
    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["assist"])
    writer.writerow(["Name", csv_safe(report["name"])])
    writer.writerow(["From", report["start"]])
    writer.writerow(["To", report["end"]])
    writer.writerow(["Prepared", report["prepared"]])
    writer.writerow(["Hours", duration(report["hours"])])
    writer.writerow(["Hours pay", f"{report['hours_pay']:.2f}"])
    writer.writerow(["Miles", f"{report['miles']:.2f}"])
    writer.writerow(["Mileage pay", f"{report['mileage_pay']:.2f}"])
    writer.writerow(["Combined", f"{report['combined']:.2f}"])
    writer.writerow(["Tasks completed", report["tasks_done"]])
    writer.writerow(["Tasks open", report["tasks_open"]])
    writer.writerow([])
    writer.writerow(["Hours"])
    writer.writerow(["Date", "Time", "Hours", "Rate", "Pay", "Note", "Source"])
    for entry in report["time_entries"]:
        writer.writerow([
            entry["date"],
            duration(entry["hours"]),
            f"{entry['hours']:.2f}",
            f"{entry['rate']:.2f}",
            f"{entry['pay']:.2f}",
            csv_safe(entry["note"]),
            entry["source"],
        ])
    writer.writerow([])
    writer.writerow(["Miles"])
    writer.writerow(["Date", "Miles", "Rate", "Pay", "Note"])
    for entry in report["mileage_entries"]:
        writer.writerow([
            entry["date"],
            f"{entry['miles']:.2f}",
            f"{entry['rate']:.4f}".rstrip("0").rstrip("."),
            f"{entry['pay']:.2f}",
            csv_safe(entry["note"]),
        ])
    writer.writerow([])
    writer.writerow(["Tasks"])
    writer.writerow(["Date", "Title", "Status", "Completed at"])
    for task in report["tasks"]:
        writer.writerow([
            task["date"],
            csv_safe(task["title"]),
            "done" if task["done"] else "open",
            task["done_at"] or "",
        ])
    writer.writerow([])
    writer.writerow(["Received"])
    writer.writerow(["Paid on", "Kind", "Period start", "Period end", "Amount", "Note"])
    for payout in report["payouts"]:
        writer.writerow([
            payout["paid_on"],
            payout["kind"],
            payout["period_start"],
            payout["period_end"],
            f"{payout['amount']:.2f}",
            csv_safe(payout["note"]),
        ])
    return buffer.getvalue().encode("utf-8-sig")
