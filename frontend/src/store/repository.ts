import { localDate } from '../format'
import { hoursFromSeconds, linePay } from '../domain/money'
import { newUid } from '../uid'
import type {
  ExpenseEntry,
  MileageEntry,
  Payout,
  Running,
  Settings,
  Task,
  TimeEntry,
} from '../types'
import { db, getRejectedUids, getRunning, getSettings, removeRejectedUid, setRunning, type OutboxOp } from './db'
import { autoSyncEnabled, sync } from './sync'

let tempCounter = -1

function tempId(): number {
  return tempCounter--
}

function kick(): void {
  if (autoSyncEnabled()) void sync(localDate())
}

async function enqueue(op: OutboxOp, notify = true): Promise<void> {
  // Collapse a burst of edits to the same record into one queued write.
  if (op.method === 'PATCH') {
    const last = await db.outbox.orderBy('seq').last()
    if (last && last.method === 'PATCH' && last.path === op.path && last.uid === op.uid) {
      await db.outbox.update(last.seq!, { body: op.body })
      if (notify) kick()
      return
    }
  }
  await db.outbox.add(op)
  if (notify) kick()
}

async function wasRejected(uid: string): Promise<boolean> {
  return (await getRejectedUids()).includes(uid)
}

// Hours -----------------------------------------------------------------

export async function createTime(input: { date: string; hours: number; note: string }): Promise<void> {
  const settings = await getSettings()
  const uid = newUid()
  const entry: TimeEntry = {
    id: tempId(),
    uid,
    date: input.date,
    hours: input.hours,
    rate: settings.hourly_rate,
    pay: linePay(input.hours, settings.hourly_rate),
    note: input.note,
    source: 'manual',
    started_at: null,
    ended_at: null,
  }
  await db.transaction('rw', db.time_entries, db.outbox, async () => {
    await db.time_entries.put(entry)
    await enqueue({
      method: 'POST',
      path: '/api/time',
      body: { work_date: input.date, hours: input.hours, note: input.note, uid },
      uid,
      label: 'hours',
    }, false)
  })
  kick()
}

export async function updateTime(uid: string, input: { date: string; hours: number; note: string }): Promise<void> {
  const existing = await db.time_entries.get(uid)
  if (!existing) return
  const rejected = await wasRejected(uid)
  await db.transaction('rw', db.time_entries, db.outbox, db.meta, async () => {
    await db.time_entries.put({
      ...existing,
      date: input.date,
      hours: input.hours,
      pay: linePay(input.hours, existing.rate),
      note: input.note,
    })
    if (rejected) await removeRejectedUid(uid)
    await enqueue(
      rejected
        ? { method: 'POST', path: '/api/time', body: { work_date: input.date, hours: input.hours, note: input.note, uid }, uid, label: 'hours' }
        : { method: 'PATCH', path: `/api/time/${uid}`, body: { work_date: input.date, hours: input.hours, note: input.note }, uid, label: 'hours' },
      false,
    )
  })
  kick()
}

export async function deleteTime(uid: string): Promise<void> {
  await db.transaction('rw', db.time_entries, db.outbox, db.meta, async () => {
    await db.time_entries.delete(uid)
    await removeRejectedUid(uid)
    await enqueue({ method: 'DELETE', path: `/api/time/${uid}`, uid, label: 'hours' }, false)
  })
  kick()
}

// Miles -----------------------------------------------------------------

export async function createMileage(input: { date: string; miles: number; note: string }): Promise<void> {
  const settings = await getSettings()
  const uid = newUid()
  const entry: MileageEntry = {
    id: tempId(),
    uid,
    date: input.date,
    miles: input.miles,
    rate: settings.mileage_rate,
    pay: linePay(input.miles, settings.mileage_rate),
    note: input.note,
  }
  await db.transaction('rw', db.mileage_entries, db.outbox, async () => {
    await db.mileage_entries.put(entry)
    await enqueue({
      method: 'POST',
      path: '/api/mileage',
      body: { drive_date: input.date, miles: input.miles, note: input.note, uid },
      uid,
      label: 'miles',
    }, false)
  })
  kick()
}

export async function updateMileage(uid: string, input: { date: string; miles: number; note: string }): Promise<void> {
  const existing = await db.mileage_entries.get(uid)
  if (!existing) return
  const rejected = await wasRejected(uid)
  await db.transaction('rw', db.mileage_entries, db.outbox, db.meta, async () => {
    await db.mileage_entries.put({
      ...existing,
      date: input.date,
      miles: input.miles,
      pay: linePay(input.miles, existing.rate),
      note: input.note,
    })
    if (rejected) await removeRejectedUid(uid)
    await enqueue(
      rejected
        ? { method: 'POST', path: '/api/mileage', body: { drive_date: input.date, miles: input.miles, note: input.note, uid }, uid, label: 'miles' }
        : { method: 'PATCH', path: `/api/mileage/${uid}`, body: { drive_date: input.date, miles: input.miles, note: input.note }, uid, label: 'miles' },
      false,
    )
  })
  kick()
}

export async function deleteMileage(uid: string): Promise<void> {
  await db.transaction('rw', db.mileage_entries, db.outbox, db.meta, async () => {
    await db.mileage_entries.delete(uid)
    await removeRejectedUid(uid)
    await enqueue({ method: 'DELETE', path: `/api/mileage/${uid}`, uid, label: 'miles' }, false)
  })
  kick()
}

// Expenses --------------------------------------------------------------

export async function createExpense(input: { date: string; amount: number; note: string }): Promise<void> {
  const uid = newUid()
  const entry: ExpenseEntry = { id: tempId(), uid, date: input.date, amount: input.amount, note: input.note }
  await db.transaction('rw', db.expense_entries, db.outbox, async () => {
    await db.expense_entries.put(entry)
    await enqueue({
      method: 'POST',
      path: '/api/expenses',
      body: { expense_date: input.date, amount: input.amount, note: input.note, uid },
      uid,
      label: 'expense',
    }, false)
  })
  kick()
}

export async function updateExpense(uid: string, input: { date: string; amount: number; note: string }): Promise<void> {
  const existing = await db.expense_entries.get(uid)
  if (!existing) return
  const rejected = await wasRejected(uid)
  await db.transaction('rw', db.expense_entries, db.outbox, db.meta, async () => {
    await db.expense_entries.put({ ...existing, date: input.date, amount: input.amount, note: input.note })
    if (rejected) await removeRejectedUid(uid)
    await enqueue(
      rejected
        ? { method: 'POST', path: '/api/expenses', body: { expense_date: input.date, amount: input.amount, note: input.note, uid }, uid, label: 'expense' }
        : { method: 'PATCH', path: `/api/expenses/${uid}`, body: { expense_date: input.date, amount: input.amount, note: input.note }, uid, label: 'expense' },
      false,
    )
  })
  kick()
}

export async function deleteExpense(uid: string): Promise<void> {
  await db.transaction('rw', db.expense_entries, db.outbox, db.meta, async () => {
    await db.expense_entries.delete(uid)
    await removeRejectedUid(uid)
    await enqueue({ method: 'DELETE', path: `/api/expenses/${uid}`, uid, label: 'expense' }, false)
  })
  kick()
}

// Tasks -----------------------------------------------------------------

export async function createTask(input: { date: string; title: string }): Promise<void> {
  const uid = newUid()
  const siblings = await db.tasks.where('date').equals(input.date).toArray()
  const sortOrder = siblings.reduce((max, task) => Math.max(max, task.sort_order), 0) + 1
  const task: Task = { id: tempId(), uid, date: input.date, title: input.title, done: false, done_at: null, sort_order: sortOrder }
  await db.transaction('rw', db.tasks, db.outbox, async () => {
    await db.tasks.put(task)
    await enqueue({
      method: 'POST',
      path: '/api/tasks',
      body: { task_date: input.date, title: input.title, uid },
      uid,
      label: 'task',
    }, false)
  })
  kick()
}

export async function updateTask(uid: string, input: { date?: string; title?: string; done?: boolean }): Promise<void> {
  const existing = await db.tasks.get(uid)
  if (!existing) return
  const next: Task = {
    ...existing,
    date: input.date ?? existing.date,
    title: input.title ?? existing.title,
    done: input.done ?? existing.done,
    done_at: input.done === undefined ? existing.done_at : input.done ? new Date().toISOString() : null,
  }
  const rejected = await wasRejected(uid)
  await db.transaction('rw', db.tasks, db.outbox, db.meta, async () => {
    await db.tasks.put(next)
    if (rejected) await removeRejectedUid(uid)
    await enqueue(
      rejected
        ? { method: 'POST', path: '/api/tasks', body: { task_date: next.date, title: next.title, uid }, uid, label: 'task' }
        : { method: 'PATCH', path: `/api/tasks/${uid}`, body: { task_date: next.date, title: next.title, done: next.done }, uid, label: 'task' },
      false,
    )
  })
  kick()
}

export async function deleteTask(uid: string): Promise<void> {
  await db.transaction('rw', db.tasks, db.outbox, db.meta, async () => {
    await db.tasks.delete(uid)
    await removeRejectedUid(uid)
    await enqueue({ method: 'DELETE', path: `/api/tasks/${uid}`, uid, label: 'task' }, false)
  })
  kick()
}

// Payouts ---------------------------------------------------------------

export type PayoutPeriod = {
  start: string
  end: string
  hours_pay: number
  mileage_pay: number
  expenses: number
}

export async function createPayout(period: PayoutPeriod, paidOn: string, note: string): Promise<void> {
  const baseUid = newUid()
  const rows: Payout[] = [
    { id: tempId(), uid: `${baseUid}-hours`, kind: 'hours', period_start: period.start, period_end: period.end, amount: period.hours_pay, paid_on: paidOn, note },
    { id: tempId(), uid: `${baseUid}-mileage`, kind: 'mileage', period_start: period.start, period_end: period.end, amount: period.mileage_pay, paid_on: paidOn, note },
    { id: tempId(), uid: `${baseUid}-expenses`, kind: 'expenses', period_start: period.start, period_end: period.end, amount: period.expenses, paid_on: paidOn, note },
  ]
  await db.transaction('rw', db.payouts, db.outbox, async () => {
    await db.payouts.bulkPut(rows)
    await enqueue({
      method: 'POST',
      path: '/api/payouts',
      body: { kind: 'both', period_start: period.start, period_end: period.end, paid_on: paidOn, note, uid: baseUid },
      uid: baseUid,
      label: 'payout',
    }, false)
  })
  kick()
}

export async function deletePayout(uid: string): Promise<void> {
  await db.transaction('rw', db.payouts, db.outbox, async () => {
    await db.payouts.delete(uid)
    await enqueue({ method: 'DELETE', path: `/api/payouts/${uid}`, uid, label: 'payout' }, false)
  })
  kick()
}

// Settings --------------------------------------------------------------

export async function saveSettings(settings: Settings): Promise<void> {
  await db.transaction('rw', db.settings, db.outbox, db.meta, async () => {
    await db.settings.put({ ...settings, id: 1 })
    await removeRejectedUid('settings')
    await enqueue({ method: 'PUT', path: '/api/settings', body: settings, uid: 'settings', label: 'settings' }, false)
  })
  kick()
}

// Timer -----------------------------------------------------------------

export async function startTimer(date: string, startedAt: string, note = ''): Promise<void> {
  const uid = newUid()
  const running: Running = { id: tempId(), uid, date, started_at: startedAt, created_at: new Date().toISOString(), note }
  await db.transaction('rw', db.meta, db.outbox, async () => {
    await setRunning(running)
    await enqueue({
      method: 'POST',
      path: '/api/time/start',
      body: { work_date: date, started_at: startedAt, note, uid },
      uid,
      label: 'timer',
    }, false)
  })
  kick()
}

export async function adjustTimer(date: string, startedAt: string): Promise<void> {
  const running = await getRunning()
  if (!running) return
  await db.transaction('rw', db.meta, db.outbox, async () => {
    await setRunning({ ...running, date, started_at: startedAt })
    await enqueue({
      method: 'PATCH',
      path: '/api/time/running',
      body: { work_date: date, started_at: startedAt },
      uid: running.uid,
      label: 'timer',
    }, false)
  })
  kick()
}

export async function stopTimer(endedAt: string): Promise<{ discarded: boolean; entry: TimeEntry | null }> {
  const running = await getRunning()
  if (!running) return { discarded: false, entry: null }
  const elapsed = Math.round((new Date(endedAt).getTime() - new Date(running.started_at).getTime()) / 1000)
  if (elapsed < 30) {
    await db.transaction('rw', db.meta, db.outbox, async () => {
      await setRunning(null)
      await enqueue({ method: 'POST', path: '/api/time/stop', body: { ended_at: endedAt }, uid: running.uid, label: 'timer' }, false)
    })
    kick()
    return { discarded: true, entry: null }
  }
  const settings = await getSettings()
  let hours = hoursFromSeconds(elapsed)
  if (hours <= 0) hours = 0.01
  const entry: TimeEntry = {
    id: running.id,
    uid: running.uid,
    date: running.date,
    hours,
    rate: settings.hourly_rate,
    pay: linePay(hours, settings.hourly_rate),
    note: running.note,
    source: 'timer',
    started_at: running.started_at,
    ended_at: endedAt,
  }
  await db.transaction('rw', db.meta, db.time_entries, db.outbox, async () => {
    await setRunning(null)
    await db.time_entries.put(entry)
    await enqueue({ method: 'POST', path: '/api/time/stop', body: { ended_at: endedAt }, uid: running.uid, label: 'timer' }, false)
  })
  kick()
  return { discarded: false, entry }
}
