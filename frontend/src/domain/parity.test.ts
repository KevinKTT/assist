import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/parity.json'
import { parseISODate } from '../format'
import type { ExpenseEntry, MileageEntry, Payout, Settings, Task, TimeEntry } from '../types'
import { dashboard, history, payoutIndex, summarize, withDays } from './summary'

// Proves the offline maths produce byte-for-byte the same numbers as the server.
// Regenerate the fixture with: backend/uv run python tests/generate_parity_fixture.py

type Inputs = {
  settings: Settings
  time_entries: TimeEntry[]
  mileage_entries: MileageEntry[]
  expense_entries: ExpenseEntry[]
  tasks: Task[]
  payouts: Payout[]
}

type Expected = {
  period: ReturnType<typeof withDays>
  history: ReturnType<typeof history>
  dashboard: ReturnType<typeof dashboard>
}

const inputs = fixture.inputs as unknown as Inputs
const expected = fixture.expected as unknown as Expected
const today = parseISODate(fixture.today)

describe('server parity', () => {
  it('period summary matches', () => {
    const payouts = payoutIndex(inputs.payouts)
    const summary = summarize(
      parseISODate(expected.period.start),
      parseISODate(expected.period.end),
      inputs.settings,
      inputs.time_entries,
      inputs.mileage_entries,
      payouts,
      today,
      inputs.expense_entries,
    )
    const period = withDays(summary, inputs.time_entries, inputs.mileage_entries, inputs.expense_entries)
    expect(period).toEqual(expected.period)
  })

  it('history matches', () => {
    const months = history(
      inputs.settings,
      inputs.time_entries,
      inputs.mileage_entries,
      inputs.payouts,
      today,
      inputs.expense_entries,
    )
    expect(months).toEqual(expected.history)
  })

  it('dashboard matches', () => {
    const built = dashboard(
      inputs.settings,
      inputs.time_entries,
      inputs.mileage_entries,
      inputs.payouts,
      inputs.tasks,
      inputs.expense_entries,
      today,
    )
    expect(built).toEqual(expected.dashboard)
  })
})
