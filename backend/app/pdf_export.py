import math
import re
from datetime import date
from pathlib import Path

from fpdf import FPDF

from app.money import duration
from app.periods import format_long

CREAM = (255, 246, 238)
BLUSH = (255, 199, 243)
ROSE = (240, 103, 165)
ROSE_DEEP = (200, 62, 120)
INK = (60, 36, 51)
MUTED = (107, 74, 88)
WHITE = (255, 252, 248)
SAGE = (62, 122, 98)
FONTS = Path(__file__).resolve().parent.parent / "fonts"
EMOJI = re.compile(r"[\U00010000-\U0010ffff]")


def pdf_text(value: str) -> str:
    return EMOJI.sub("", " ".join(value.split()))


def money(value: float) -> str:
    return f"${value:,.2f}"


def long_day(value: str) -> str:
    return format_long(date.fromisoformat(value))


class AssistPDF(FPDF):
    def __init__(self):
        super().__init__(format="A4", unit="mm")
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(16, 18, 16)
        self.add_font("Nunito", "", str(FONTS / "Nunito-Regular.ttf"))
        self.add_font("Nunito", "B", str(FONTS / "Nunito-Bold.ttf"))
        self.add_font("Nunito", "I", str(FONTS / "Nunito-Italic.ttf"))
        self.add_font("Fraunces", "", str(FONTS / "Fraunces-SemiBold.ttf"))
        self.add_font("Fraunces", "I", str(FONTS / "Fraunces-Italic.ttf"))

    def header(self):
        self.set_auto_page_break(auto=False)
        self.set_fill_color(*CREAM)
        self.rect(0, 0, 210, 297, "F")
        self.set_fill_color(*ROSE)
        self.rect(0, 0, 210, 3.2, "F")
        self.set_auto_page_break(auto=True, margin=18)
        self.set_y(self.t_margin)

    def footer(self):
        self.set_y(-12)
        self.set_font("Nunito", size=8.5)
        self.set_text_color(*MUTED)
        self.cell(88, 6, "assist")
        self.cell(88, 6, str(self.page_no()), align="R")


def need(pdf: AssistPDF, height: float) -> None:
    if pdf.get_y() + height > pdf.page_break_trigger:
        pdf.add_page()


def flower(pdf: AssistPDF, x: float, y: float, size: float) -> None:
    pdf.set_fill_color(*BLUSH)
    petal = size * 0.34
    orbit = size * 0.28
    for i in range(5):
        ang = math.radians(-90 + i * 72)
        px = x + math.cos(ang) * orbit
        py = y + math.sin(ang) * orbit
        pdf.ellipse(px - petal, py - petal, petal * 2, petal * 2, style="F")
    pdf.set_fill_color(*CREAM)
    core = size * 0.16
    pdf.ellipse(x - core, y - core, core * 2, core * 2, style="F")
    pdf.set_fill_color(*ROSE_DEEP)
    dot = size * 0.07
    pdf.ellipse(x - dot, y - dot, dot * 2, dot * 2, style="F")


def section(pdf: AssistPDF, title: str) -> None:
    need(pdf, 16)
    pdf.ln(3)
    pdf.set_font("Fraunces", size=14)
    pdf.set_text_color(*INK)
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
    y = pdf.get_y()
    pdf.set_draw_color(*BLUSH)
    pdf.set_line_width(0.45)
    pdf.line(16, y, 194, y)
    pdf.ln(3.5)


def entry(pdf: AssistPDF, when: str, amount: str, detail: str) -> None:
    need(pdf, 16)
    pdf.set_font("Nunito", "B", 10.5)
    pdf.set_text_color(*INK)
    pdf.cell(120, 6, when)
    pdf.set_font("Fraunces", size=11)
    pdf.set_text_color(*ROSE_DEEP)
    pdf.cell(58, 6, amount, align="R", new_x="LMARGIN", new_y="NEXT")
    if detail:
        pdf.set_font("Nunito", size=9.5)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(0, 5, pdf_text(detail), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)


def total_bar(pdf: AssistPDF, label: str, value: str) -> None:
    need(pdf, 14)
    y = pdf.get_y() + 1
    pdf.set_fill_color(*BLUSH)
    pdf.rect(16, y, 178, 10, style="F", round_corners=True, corner_radius=2)
    pdf.set_xy(20, y + 2)
    pdf.set_font("Nunito", "B", 10)
    pdf.set_text_color(*INK)
    pdf.cell(110, 6, label)
    pdf.set_font("Fraunces", size=11)
    pdf.cell(50, 6, value, align="R")
    pdf.set_y(y + 14)


def summary_box(pdf: AssistPDF, x: float, y: float, w: float, h: float, fill, label: str, value: str, value_color, label_color) -> None:
    pdf.set_fill_color(*fill)
    pdf.rect(x, y, w, h, style="F", round_corners=True, corner_radius=3)
    pdf.set_xy(x + 4, y + 3.5)
    pdf.set_font("Nunito", size=8.5)
    pdf.set_text_color(*label_color)
    pdf.cell(w - 8, 5, label)
    pdf.set_xy(x + 4, y + 10)
    pdf.set_font("Fraunces", size=15)
    pdf.set_text_color(*value_color)
    pdf.cell(w - 8, 8, value)


def render_pdf(report: dict) -> bytes:
    pdf = AssistPDF()
    pdf.set_title("assist report")
    pdf.set_author(pdf_text(report["name"]) or "assist")
    pdf.set_creator("assist")
    pdf.add_page()
    flower(pdf, 182, 24, 16)
    pdf.set_font("Fraunces", "I", 28)
    pdf.set_text_color(*ROSE_DEEP)
    pdf.cell(0, 12, "assist", new_x="LMARGIN", new_y="NEXT")
    if report["name"]:
        pdf.set_font("Nunito", size=12)
        pdf.set_text_color(*INK)
        pdf.cell(0, 6, pdf_text(report["name"]), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Nunito", size=11)
    pdf.set_text_color(*MUTED)
    span = f"{long_day(report['start'])}  –  {long_day(report['end'])}"
    pdf.cell(0, 6, span, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Nunito", "I", 9)
    pdf.cell(0, 5, f"Prepared {long_day(report['prepared'])}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    y = pdf.get_y()
    box_w = 86
    box_h = 24
    gap = 6
    summary_box(pdf, 16, y, box_w, box_h, BLUSH, "Hours", money(report["hours_pay"]), INK, MUTED)
    summary_box(pdf, 16 + box_w + gap, y, box_w, box_h, (255, 228, 242), "Mileage", money(report["mileage_pay"]), INK, MUTED)
    summary_box(pdf, 16, y + box_h + gap, box_w, box_h, ROSE_DEEP, "Together", money(report["combined"]), CREAM, (255, 228, 240))
    summary_box(
        pdf,
        16 + box_w + gap,
        y + box_h + gap,
        box_w,
        box_h,
        WHITE,
        "Expenses",
        money(report["expenses"]),
        INK,
        MUTED,
    )
    pdf.set_y(y + box_h * 2 + gap + 8)
    pdf.set_font("Nunito", size=10)
    pdf.set_text_color(*INK)
    pdf.cell(0, 5, f"{duration(report['hours'])}  ·  {report['miles']:.2f} mi", new_x="LMARGIN", new_y="NEXT")
    if report["tasks_open"]:
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 5, f"{report['tasks_open']} still open", new_x="LMARGIN", new_y="NEXT")

    section(pdf, "Hours")
    if not report["time_entries"]:
        pdf.set_font("Nunito", "I", 10)
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 6, "No hours in this range", new_x="LMARGIN", new_y="NEXT")
    else:
        for item in report["time_entries"]:
            bits = [duration(item["hours"]), f"{money(item['rate'])}/hr"]
            if item["note"]:
                bits.append(item["note"])
            if item["source"] == "timer":
                bits.append("clocked")
            entry(pdf, long_day(item["date"]), money(item["pay"]), "  ·  ".join(bits))
        total_bar(pdf, "Hours pay", money(report["hours_pay"]))

    section(pdf, "Miles")
    if not report["mileage_entries"]:
        pdf.set_font("Nunito", "I", 10)
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 6, "No miles in this range", new_x="LMARGIN", new_y="NEXT")
    else:
        for item in report["mileage_entries"]:
            miles = f"{item['miles']:.2f}".rstrip("0").rstrip(".")
            bits = [f"{miles} mi", f"{money(item['rate'])}/mi"]
            if item["note"]:
                bits.append(item["note"])
            entry(pdf, long_day(item["date"]), money(item["pay"]), "  ·  ".join(bits))
        total_bar(pdf, "Mileage pay", money(report["mileage_pay"]))

    section(pdf, "Expenses")
    if not report["expense_entries"]:
        pdf.set_font("Nunito", "I", 10)
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 6, "No expenses in this range", new_x="LMARGIN", new_y="NEXT")
    else:
        for item in report["expense_entries"]:
            entry(pdf, long_day(item["date"]), money(item["amount"]), item["note"])
        total_bar(pdf, "Expenses", money(report["expenses"]))

    section(pdf, "Tasks completed")
    done = [task for task in report["tasks"] if task["done"]]
    open_tasks = [task for task in report["tasks"] if not task["done"]]
    if not done:
        pdf.set_font("Nunito", "I", 10)
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 6, "No completed tasks in this range", new_x="LMARGIN", new_y="NEXT")
    else:
        for task in done:
            entry(pdf, long_day(task["date"]), "Done", task["title"])

    if open_tasks:
        section(pdf, "Still open")
        for task in open_tasks:
            entry(pdf, long_day(task["date"]), "Open", task["title"])

    section(pdf, "Received")
    if not report["payouts"]:
        pdf.set_font("Nunito", "I", 10)
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 6, "Nothing marked paid in this range", new_x="LMARGIN", new_y="NEXT")
    else:
        for payout in report["payouts"]:
            kind = {"hours": "Hours", "mileage": "Miles", "expenses": "Expenses"}.get(payout["kind"], payout["kind"])
            detail = f"{kind}  ·  {long_day(payout['period_start'])} – {long_day(payout['period_end'])}"
            if payout["note"]:
                detail += f"  ·  {payout['note']}"
            entry(pdf, long_day(payout["paid_on"]), money(payout["amount"]), detail)

    return bytes(pdf.output())
