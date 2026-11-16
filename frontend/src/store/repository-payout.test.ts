import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createPayout } from './repository'
import { setAutoSync } from './sync'

beforeEach(async () => {
  await db.delete()
  await db.open()
  setAutoSync(false)
})

describe('payouts for an earlier period', () => {
  it('queues only the viewed period and leaves the current one alone', async () => {
    const period = {
      start: '2026-03-02',
      end: '2026-03-15',
      hours_pay: 160,
      mileage_pay: 7,
      expenses: 18.4,
    }

    await createPayout(period, '2026-03-20', 'late pay')

    const rows = await db.payouts.toArray()
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.kind).sort()).toEqual(['expenses', 'hours', 'mileage'])
    expect(rows.every((row) => row.period_start === period.start && row.period_end === period.end)).toBe(true)
    expect(rows.some((row) => row.period_start === '2026-03-16')).toBe(false)

    const outbox = await db.outbox.toArray()
    expect(outbox).toHaveLength(1)
    expect(outbox[0].path).toBe('/api/payouts')
    expect(outbox[0].body).toMatchObject({
      kind: 'both',
      period_start: period.start,
      period_end: period.end,
    })
  })
})
