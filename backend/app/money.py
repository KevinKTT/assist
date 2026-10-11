from decimal import Decimal, ROUND_HALF_UP


def q2(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def q4(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def line_pay(qty: float, rate: float) -> float:
    amount = Decimal(str(qty)) * Decimal(str(rate))
    return float(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def duration(hours: float) -> str:
    h, m = divmod(nearest_minutes(hours), 60)
    if h and m:
        unit = "hr" if h == 1 else "hrs"
        return f"{h} {unit} {m} min"
    if h:
        return "1 hr" if h == 1 else f"{h} hrs"
    return f"{m} min"


def hours_from_minutes(minutes: int) -> float:
    return float(Decimal(minutes) / Decimal(60))


def nearest_minutes(value: float) -> int:
    return int((Decimal(str(value)) * 60).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def hours_from_seconds(seconds: int) -> float:
    minutes = int((Decimal(seconds) / Decimal(60)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return hours_from_minutes(minutes)


def sum_pay(pairs: list[tuple[float, float]]) -> float:
    total = Decimal("0")
    for qty, rate in pairs:
        total += Decimal(str(line_pay(qty, rate)))
    return float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
