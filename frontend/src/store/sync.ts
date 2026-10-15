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
import { addRejectedUid, db, getRejectedUids } from './db'

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
        // The server rejected this one for good. Drop the queued op so it
        // cannot block the queue forever, but keep the local record: record
        // its uid as rejected so pull() never deletes it, and surface the
        // reason. Editing the record re-sends it as a create (repository).
        await db.outbox.delete(item.seq!)
        if (item.method !== 'DELETE' && ['hours', 'miles', 'expense', 'task', 'settings'].includes(item.label)) {
          await addRejectedUid(item.uid)
        }
        rejected = err.message
        continue
      }
      throw err
    }
  }
  return rejected
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isProtected(uid: string, protectedUids: Set<string>): boolean {
  for (const p of protectedUids) {
    if (uid === p || uid.startsWith(`${p}-`)) return true
  }
  return false
}

async function reconcileTable<T extends { uid: string }>(
  table: { toArray: () => Promise<T[]>; bulkPut: (rows: T[]) => Promise<unknown>; bulkDelete: (keys: string[]) => Promise<unknown> },
  serverRows: T[],
  protectedUids: Set<string>,
): Promise<void> {
  const local = await table.toArray()
  const localByUid = new Map(local.map((row) => [row.uid, row]))
  const serverUids = new Set(serverRows.map((row) => row.uid))
  const toPut = serverRows.filter((row) => !same(localByUid.get(row.uid), row))
  const toDelete = local
    .filter((row) => !serverUids.has(row.uid) && !isProtected(row.uid, protectedUids))
    .map((row) => row.uid)
  if (toDelete.length) await table.bulkDelete(toDelete)
  if (toPut.length) await table.bulkPut(toPut)
}

async function pull(today: string): Promise<void> {
  const snapshot = await api<Snapshot>(`/api/sync?today=${encodeURIComponent(today)}`)
  // Anything still queued or previously rejected exists only locally; a
  // snapshot must never delete it. This is what made a just-saved entry
  // vanish when a save landed while a sync was already in flight.
  const ops = await db.outbox.toArray()
  const protectedUids = new Set<string>([...ops.map((op) => op.uid), ...(await getRejectedUids())])
  const hasPendingTimer = ops.some((op) => op.label === 'timer')
  await db.transaction(
    'rw',
    [db.settings, db.time_entries, db.mileage_entries, db.expense_entries, db.tasks, db.payouts, db.meta],
    async () => {
      const nextSettings = { ...snapshot.settings, id: 1 }
      const currentSettings = await db.settings.get(1)
      if (!protectedUids.has('settings') && !same(currentSettings, nextSettings)) await db.settings.put(nextSettings)
      await reconcileTable(db.time_entries, snapshot.time_entries, protectedUids)
      await reconcileTable(db.mileage_entries, snapshot.mileage_entries, protectedUids)
      await reconcileTable(db.expense_entries, snapshot.expense_entries, protectedUids)
      await reconcileTable(db.tasks, snapshot.tasks, protectedUids)
      await reconcileTable(db.payouts, snapshot.payouts, protectedUids)
      if (!hasPendingTimer) {
        const currentRunning = await db.meta.get('running')
        if (!same(currentRunning?.value ?? null, snapshot.running)) {
          await db.meta.put({ key: 'running', value: snapshot.running })
        }
      }
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

async function syncOnce(today: string): Promise<void> {
  setState({ status: 'syncing' })
  try {
    let rejected: string | null = null
    // Loop push -> pull until the outbox is genuinely empty at pull time.
    // A write that arrives mid-sync stays local (protected in pull) and is
    // pushed by the next iteration instead of being wiped by the snapshot.
    for (let round = 0; round < 10; round++) {
      if (await db.outbox.count()) {
        const result = await pushOutbox()
        if (result) rejected = result
      }
      const pending = await db.outbox.count()
      if (pending > 0) {
        // pushOutbox only leaves items behind when it throws, which is
        // handled by the outer catch; reaching here means new writes
        // arrived while pushing. Push those too before pulling.
        continue
      }
      await pull(today)
      const late = await db.outbox.count()
      if (late === 0) {
        const rejectedUids = await getRejectedUids()
        setState({
          status: rejectedUids.length ? 'pending' : 'idle',
          pending: rejectedUids.length,
          lastSync: Date.now(),
          message: rejected ?? (rejectedUids.length ? state.message : null),
        })
        return
      }
      // Writes arrived while pulling; go around again and push them.
    }
    setState({ status: 'pending', pending: await db.outbox.count(), message: rejected })
  } catch (err) {
    setState({
      status: 'offline',
      pending: await db.outbox.count(),
      message: err instanceof Error ? err.message : "Can't reach assist",
    })
  }
}

let inFlight = false
let rerunToday: string | null = null

export async function sync(today: string): Promise<void> {
  if (inFlight) {
    // Never drop a sync request (that lost saves): remember it and run
    // again as soon as the current sync finishes.
    rerunToday = today
    return
  }
  inFlight = true
  try {
    let current = today
    do {
      rerunToday = null
      await syncOnce(current)
      if (rerunToday) current = rerunToday
    } while (rerunToday)
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
