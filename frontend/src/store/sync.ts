import { ApiError, api } from '../api'
import type {
  ExpenseEntry,
  MileageEntry,
  Payout,
  Running,
  Settings,
  Task,
  TimeEntry,
} from '../types'
import { db } from './db'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'pending'

export type SyncState = {
  status: SyncStatus
  pending: number
  lastSync: number | null
  message: string | null
}

export type Snapshot = {
  server_time: string
  settings: Settings
  time_entries: TimeEntry[]
  mileage_entries: MileageEntry[]
  expense_entries: ExpenseEntry[]
  tasks: Task[]
  payouts: Payout[]
  running: Running | null
}

let state: SyncState = { status: 'idle', pending: 0, lastSync: null, message: null }
const listeners = new Set<() => void>()

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSyncState(): SyncState {
  return state
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

async function pushOutbox(): Promise<string | null> {
  let rejected: string | null = null
  const items = await db.outbox.orderBy('seq').toArray()
  for (const item of items) {
    try {
      await api(item.path, {
        method: item.method,
        body: item.body === undefined ? undefined : JSON.stringify(item.body),
      })
      await db.outbox.delete(item.seq!)
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // The server rejected this one for good; drop it and tell the user
        // rather than blocking the queue forever.
        await db.outbox.delete(item.seq!)
        rejected = err.message
        continue
      }
      throw err
    }
  }
  return rejected
}

async function pull(today: string): Promise<void> {
  const snapshot = await api<Snapshot>(`/api/sync?today=${encodeURIComponent(today)}`)
  await db.transaction(
    'rw',
    [db.settings, db.time_entries, db.mileage_entries, db.expense_entries, db.tasks, db.payouts, db.meta],
    async () => {
      await db.settings.put({ ...snapshot.settings, id: 1 })
      await db.time_entries.clear()
      await db.time_entries.bulkPut(snapshot.time_entries)
      await db.mileage_entries.clear()
      await db.mileage_entries.bulkPut(snapshot.mileage_entries)
      await db.expense_entries.clear()
      await db.expense_entries.bulkPut(snapshot.expense_entries)
      await db.tasks.clear()
      await db.tasks.bulkPut(snapshot.tasks)
      await db.payouts.clear()
      await db.payouts.bulkPut(snapshot.payouts)
      await db.meta.put({ key: 'running', value: snapshot.running })
      await db.meta.put({ key: 'server_time', value: snapshot.server_time })
    },
  )
}

let autoSync = true

// Tests turn this off so they can drive sync() themselves.
export function setAutoSync(enabled: boolean): void {
  autoSync = enabled
}

export function autoSyncEnabled(): boolean {
  return autoSync
}

let inFlight = false

export async function sync(today: string): Promise<void> {
  if (inFlight) return
  inFlight = true
  setState({ status: 'syncing' })
  try {
    let rejected: string | null = null
    if (await db.outbox.count()) rejected = await pushOutbox()
    const pending = await db.outbox.count()
    if (pending === 0) {
      await pull(today)
      // A write could have arrived while we were pulling; don't report idle
      // with unsent work sitting in the queue.
      const late = await db.outbox.count()
      setState({
        status: late ? 'pending' : 'idle',
        pending: late,
        lastSync: Date.now(),
        message: rejected,
      })
    } else {
      setState({ status: 'pending', pending, message: rejected })
    }
  } catch (err) {
    setState({
      status: 'offline',
      pending: await db.outbox.count(),
      message: err instanceof Error ? err.message : "Can't reach assist",
    })
  } finally {
    inFlight = false
  }
}

let started = false

export function startSyncLoop(getToday: () => string): () => void {
  if (started) return () => undefined
  started = true
  const run = () => void sync(getToday())
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', run)
  const timer = window.setInterval(run, 30_000)
  run()
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', run)
    window.clearInterval(timer)
    started = false
  }
}
