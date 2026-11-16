import { describe, expect, it } from 'vitest'
import { parseISODate } from '../format'
import type { Payout, Settings, TimeEntry } from '../types'
import { dashboard } from './summary'

const settings: Settings = {
  display_name: 'Ada',
  hourly_rate: 20,
  mileage_rate: 0,
  cycle: 'biweekly',
  cycle_anchor: '2026-10-12',
  payday_offset_days: null,
}

function hours(date: string, qty: number): TimeEntry {
  return {
    id: 1,
    uid: date,
    date,
    hours: qty,
    rate: 20,
    pay: qty * 20,
    note: '',
    source: 'manual',
    started_at: null,
    ended_at: null,
  }
}

function payout(kind: Payout['kind'], start: string, end: string): Payout {
  return {
    id: 1,
    uid: `${kind}-${start}`,
    kind,
    period_start: start,
    period_end: end,
    amount: 0,
    paid_on: '2026-10-27',
    note: '',
  }
}

describe('dashboard pay cycle', () => {
  const today = parseISODate('2026-10-27')
  const entries = [hours('2026-10-20', 2), hours('2026-10-27', 1)]

  function view(periodOn?: Date) {
    return dashboard(settings, entries, [], [], [], [], today, undefined, undefined, periodOn)
  }

  it('uses the cycle that contains today', () => {
    const current = view()
    expect(current.period.start).toBe('2026-10-26')
    expect(current.period.end).toBe('2026-11-08')
    expect(current.period.hours).toBe(1)
    expect(current.period.hours_pay).toBe(20)
  })

  it('can open the previous cycle without moving today', () => {
    const earlier = view(parseISODate('2026-10-20'))
    expect(earlier.period.start).toBe('2026-10-12')
    expect(earlier.period.end).toBe('2026-10-25')
    expect(earlier.period.hours).toBe(2)
    expect(earlier.period.hours_pay).toBe(40)
    expect(earlier.period.days_worked).toBe(1)
    expect(earlier.range.start).toBe('2026-10-12')
    expect(earlier.range.end).toBe('2026-10-25')
    expect(earlier.today.date).toBe('2026-10-27')
    expect(earlier.today.hours).toBe(1)
  })

  it('does not open a cycle that has not started', () => {
    const future = view(parseISODate('2026-12-01'))
    expect(future.period.start).toBe('2026-10-26')
    expect(future.period.hours).toBe(1)
  })

  it('does not carry an earlier cycle payout into the current cycle', () => {
    const payouts = [
      payout('hours', '2026-10-12', '2026-10-25'),
      payout('mileage', '2026-10-12', '2026-10-25'),
      payout('expenses', '2026-10-12', '2026-10-25'),
    ]
    const earlier = dashboard(
      settings,
      entries,
      [],
      payouts,
      [],
      [],
      today,
      undefined,
      undefined,
      parseISODate('2026-10-20'),
    )
    expect(earlier.period.hours_payout).not.toBeNull()
    expect(earlier.period.mileage_payout).not.toBeNull()
    expect(earlier.period.expenses_payout).not.toBeNull()

    const current = dashboard(settings, entries, [], payouts, [], [], today)
    expect(current.period.start).toBe('2026-10-26')
    expect(current.period.hours).toBe(1)
    expect(current.period.hours_pay).toBe(20)
    expect(current.period.hours_payout).toBeNull()
    expect(current.period.mileage_payout).toBeNull()
    expect(current.period.expenses_payout).toBeNull()
  })
})
