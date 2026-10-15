import Dexie, { type Table } from 'dexie'
import type {
  ExpenseEntry,
  MileageEntry,
  Payout,
  Running,
  Settings,
  Task,
  TimeEntry,
} from '../types'

export type StoredSettings = Settings & { id: number }

// A queued write. The client applies changes locally first, then drains this
// queue in order whenever it can reach the server.
export type OutboxOp = {
  seq?: number
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  uid: string
  label: string
}

export type MetaRow = { key: string; value: unknown }

export class AssistDB extends Dexie {
  settings!: Table<StoredSettings, number>
  time_entries!: Table<TimeEntry, string>
  mileage_entries!: Table<MileageEntry, string>
  expense_entries!: Table<ExpenseEntry, string>
  tasks!: Table<Task, string>
  payouts!: Table<Payout, string>
  outbox!: Table<OutboxOp, number>
  meta!: Table<MetaRow, string>

  constructor(name = 'assist') {
    super(name)
    this.version(1).stores({
      settings: 'id',
      time_entries: 'uid, date',
      mileage_entries: 'uid, date',
      expense_entries: 'uid, date',
      tasks: 'uid, date',
      payouts: 'uid',
      outbox: '++seq, uid',
      meta: 'key',
    })
  }
}

export const db = new AssistDB()

export async function getRunning(): Promise<Running | null> {
  const row = await db.meta.get('running')
  return (row?.value as Running | null) ?? null
}

export async function setRunning(running: Running | null): Promise<void> {
  await db.meta.put({ key: 'running', value: running })
}

export const DEFAULT_SETTINGS: Settings = {
  display_name: '',
  hourly_rate: 0,
  mileage_rate: 0,
  cycle: 'biweekly',
  cycle_anchor: '2024-01-07',
  payday_offset_days: null,
}

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get(1)
  return row ?? DEFAULT_SETTINGS
}

const REJECTED_KEY = 'rejected_uids'

export async function getRejectedUids(): Promise<string[]> {
  const row = await db.meta.get(REJECTED_KEY)
  return Array.isArray(row?.value) ? (row.value as string[]) : []
}

export async function addRejectedUid(uid: string): Promise<void> {
  const current = await getRejectedUids()
  if (!current.includes(uid)) await db.meta.put({ key: REJECTED_KEY, value: [...current, uid] })
}

export async function removeRejectedUid(uid: string): Promise<void> {
  const current = await getRejectedUids()
  if (current.includes(uid)) await db.meta.put({ key: REJECTED_KEY, value: current.filter((item) => item !== uid) })
}
