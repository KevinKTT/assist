import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { createTask, createTime, reorderTasks, updateTask, updateTime } from './repository'
import { getSyncState, setAutoSync, sync, type Snapshot } from './sync'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const emptySnapshot: Snapshot = {
  server_time: '2026-03-03T00:00:00+00:00',
  settings: {
    display_name: '',
    hourly_rate: 20,
    mileage_rate: 0.7,
    cycle: 'weekly',
    cycle_anchor: '2026-03-01',
    payday_offset_days: null,
  },
  time_entries: [],
  mileage_entries: [],
  expense_entries: [],
  tasks: [],
  payouts: [],
  running: null,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  setAutoSync(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('offline outbox', () => {
  it('keeps a write locally when offline and flushes it later', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    await createTime({ date: '2026-03-03', hours: 8, note: 'clinic' })
    expect(await db.time_entries.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)

    await sync('2026-03-03')
    expect(getSyncState().status).toBe('offline')
    expect(await db.outbox.count()).toBe(1)
    expect((await db.time_entries.toArray())[0].note).toBe('clinic')

    const created = (await db.time_entries.toArray())[0]
    const snapshot: Snapshot = { ...emptySnapshot, time_entries: [created] }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(String(input).startsWith('/api/sync') ? json(snapshot) : json({ ok: true })),
      ),
    )

    await sync('2026-03-03')
    expect(await db.outbox.count()).toBe(0)
    expect(getSyncState().status).toBe('idle')
    expect((await db.time_entries.toArray())[0].note).toBe('clinic')
  })

  it('drops a write the server rejects and surfaces the reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).startsWith('/api/sync')
            ? json(emptySnapshot)
            : json({ detail: 'That note is a bit long' }, 400),
        ),
      ),
    )
    await createTime({ date: '2026-03-03', hours: 8, note: 'x' })
    await sync('2026-03-03')
    expect(await db.outbox.count()).toBe(0)
    expect(getSyncState().message).toBe('That note is a bit long')
  })

  it('coalesces repeated edits to the same record', async () => {
    await createTime({ date: '2026-03-03', hours: 8, note: '' })
    const uid = (await db.time_entries.toArray())[0].uid
    await updateTime(uid, { date: '2026-03-03', hours: 7, note: 'a' })
    await updateTime(uid, { date: '2026-03-03', hours: 6, note: 'b' })
    const ops = await db.outbox.toArray()
    expect(ops.filter((op) => op.method === 'POST')).toHaveLength(1)
    expect(ops.filter((op) => op.method === 'PATCH')).toHaveLength(1)
  })

  it('keeps a save made while a sync pull is in flight', async () => {
    let resolvePull: ((res: Response) => void) | null = null
    let pulls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith('/api/sync')) {
          pulls += 1
          if (pulls === 1) return new Promise<Response>((resolve) => { resolvePull = resolve })
          // After the queued POST succeeds the server would return it.
          return json({ ...emptySnapshot, time_entries: await db.time_entries.toArray() })
        }
        return json({ ok: true })
      }),
    )
    const pulling = sync('2026-03-03')
    // Let sync reach the pending pull before saving.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await createTime({ date: '2026-03-03', hours: 8, note: 'during sync' })
    expect(await db.time_entries.count()).toBe(1)
    resolvePull!(json(emptySnapshot))
    await pulling
    // The first snapshot did not contain the new entry, but its queued
    // POST protects it from being wiped, and the same sync then pushes it.
    expect(await db.time_entries.count()).toBe(1)
    expect(await db.outbox.count()).toBe(0)

    const created = (await db.time_entries.toArray())[0]
    const snapshot: Snapshot = { ...emptySnapshot, time_entries: [created] }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(String(input).startsWith('/api/sync') ? json(snapshot) : json({ ok: true })),
      ),
    )
    await sync('2026-03-03')
    expect(await db.outbox.count()).toBe(0)
    expect((await db.time_entries.toArray())[0].note).toBe('during sync')
  })

  it('keeps the local record when the server rejects a write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).startsWith('/api/sync')
            ? json(emptySnapshot)
            : json({ detail: 'That note is a bit long' }, 400),
        ),
      ),
    )
    await createTime({ date: '2026-03-03', hours: 8, note: 'x' })
    await sync('2026-03-03')
    expect(await db.outbox.count()).toBe(0)
    expect(getSyncState().message).toBe('That note is a bit long')
    // Not silently deleted: still visible locally so it can be fixed.
    expect(await db.time_entries.count()).toBe(1)
  })

  it('replaces local state with the server snapshot after a clean push', async () => {
    const remote = {
      ...emptySnapshot.time_entries,
    }
    void remote
    const snapshot: Snapshot = {
      ...emptySnapshot,
      settings: { ...emptySnapshot.settings, display_name: 'Test User' },
      mileage_entries: [
        { id: 1, uid: 'm1', date: '2026-03-02', miles: 5, rate: 0.7, pay: 3.5, note: 'school' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(snapshot))))
    await sync('2026-03-03')
    expect((await db.settings.get(1))?.display_name).toBe('Test User')
    expect(await db.mileage_entries.count()).toBe(1)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('task order', () => {
  it('folds a reorder into tasks that have not synced yet', async () => {
    await createTask({ date: '2026-03-11', title: 'Call school' })
    await createTask({ date: '2026-03-11', title: 'Pack lunch' })
    const created = (await db.tasks.toArray()).sort((a, b) => a.sort_order - b.sort_order)
    await reorderTasks('2026-03-11', [created[1].uid, created[0].uid])

    const tasks = (await db.tasks.toArray()).sort((a, b) => a.sort_order - b.sort_order)
    expect(tasks.map((task) => task.title)).toEqual(['Pack lunch', 'Call school'])
    const ops = await db.outbox.orderBy('seq').toArray()
    expect(ops.map((op) => op.method)).toEqual(['POST', 'POST'])
    const body = new Map(ops.map((op) => [op.uid, op.body as { sort_order: number }]))
    expect(body.get(created[1].uid)?.sort_order).toBe(1)
    expect(body.get(created[0].uid)?.sort_order).toBe(2)
  })

  it('patches saved tasks once, and a later reorder updates those patches', async () => {
    await createTask({ date: '2026-03-11', title: 'Call school' })
    await createTask({ date: '2026-03-11', title: 'Pack lunch' })
    await createTask({ date: '2026-03-12', title: 'Already there' })
    await db.outbox.clear()
    const [first, second] = (await db.tasks.where('date').equals('2026-03-11').toArray()).sort((a, b) => a.sort_order - b.sort_order)

    await reorderTasks('2026-03-11', [second.uid, first.uid])
    await reorderTasks('2026-03-11', [first.uid, second.uid])
    const ops = await db.outbox.orderBy('seq').toArray()
    expect(ops).toHaveLength(2)
    expect(ops.every((op) => op.method === 'PATCH')).toBe(true)
    const body = new Map(ops.map((op) => [op.uid, op.body as { sort_order: number; title: string }]))
    expect(body.get(first.uid)?.sort_order).toBe(1)
    expect(body.get(second.uid)?.sort_order).toBe(2)

    await updateTask(first.uid, { date: '2026-03-12' })
    const moved = await db.tasks.get(first.uid)
    expect(moved?.sort_order).toBe(2)
    const movedOp = (await db.outbox.where('uid').equals(first.uid).toArray()).find((op) => op.method === 'PATCH')
    expect(movedOp?.body).toMatchObject({ task_date: '2026-03-12', sort_order: 2, title: 'Call school' })
  })
})
