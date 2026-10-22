import Decimal from 'decimal.js'

// Mirrors backend/app/money.py so the app can show the same numbers offline.

export function q2(value: number): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}

export function q4(value: number): number {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber()
}

export function linePay(qty: number, rate: number): number {
  return new Decimal(qty).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}

export function nearestMinutes(value: number): number {
  return new Decimal(value).times(60).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
}

export function hoursFromMinutes(minutes: number): number {
  return new Decimal(minutes).div(60).toNumber()
}

export function hoursFromSeconds(seconds: number): number {
  const minutes = new Decimal(seconds).div(60).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
  return hoursFromMinutes(minutes)
}

export function sumAmounts(amounts: Iterable<number>): number {
  let total = new Decimal(0)
  for (const amount of amounts) total = total.plus(q2(amount))
  return total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}

export function duration(hours: number): string {
  const total = nearestMinutes(hours)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h && m) return `${h} ${h === 1 ? 'hr' : 'hrs'} ${m} min`
  if (h) return h === 1 ? '1 hr' : `${h} hrs`
  return `${m} min`
}

export function sumPay(pairs: Iterable<[number, number]>): number {
  const amounts: number[] = []
  for (const [qty, rate] of pairs) amounts.push(linePay(qty, rate))
  return sumAmounts(amounts)
}
