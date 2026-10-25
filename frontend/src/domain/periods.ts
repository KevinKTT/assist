import { addDays, mondayOnOrBefore } from '../format'
import type { Cycle } from '../types'

// Mirrors backend/app/periods.py.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function daysBetween(a: Date, b: Date): number {
  const ms =
    Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  return Math.round(ms / 86_400_000)
}

export function weekContaining(day: Date): [Date, Date] {
  const start = mondayOnOrBefore(day)
  return [start, addDays(start, 6)]
}

export function monthBounds(day: Date): [Date, Date] {
  const start = new Date(day.getFullYear(), day.getMonth(), 1)
  const end = new Date(day.getFullYear(), day.getMonth() + 1, 0)
  return [start, end]
}

export function periodContaining(day: Date, anchor: Date, cycle: Cycle): [Date, Date] {
  if (cycle === 'monthly') return monthBounds(day)
  const length = cycle === 'biweekly' ? 14 : 7
  const n = Math.floor(daysBetween(anchor, day) / length)
  const start = addDays(anchor, n * length)
  return [start, addDays(start, length - 1)]
}

export function previousPeriod(start: Date, anchor: Date, cycle: Cycle): [Date, Date] {
  return periodContaining(addDays(start, -1), anchor, cycle)
}

export function nextPeriod(end: Date, anchor: Date, cycle: Cycle): [Date, Date] {
  return periodContaining(addDays(end, 1), anchor, cycle)
}

export function paydayFor(end: Date, offset: number | null): Date | null {
  if (offset === null || offset === undefined) return null
  return addDays(end, offset)
}

export function iterDates(start: Date, end: Date): Date[] {
  const out: Date[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) out.push(day)
  return out
}

export function monthKey(day: Date): string {
  return `${String(day.getFullYear()).padStart(4, '0')}-${String(day.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  return `${MONTHS[Number(month) - 1]} ${year}`
}
