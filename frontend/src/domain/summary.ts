import { localDate, parseISODate } from '../format'
import type {
  ExpenseEntry,
  MileageEntry,
  Payout,
  PeriodDay,
  PeriodDetail,
  Settings,
  Task,
  TimeEntry,
} from '../types'
import { q2, sumAmounts, sumPay } from './money'
import {
  iterDates,
  monthBounds,
  monthKey,
  monthLabel,
  nextPeriod,
  paydayFor,
  periodContaining,
  previousPeriod,
  weekContaining,
} from './periods'

// Mirrors the reporting maths in backend/app/main.py so the app can show the
// same numbers when it is offline. Kept in one place so it can be tested
// against the server output.

export type PayoutMap = Map<string, Payout>

export function payoutIndex(payouts: Payout[]): PayoutMap {
  const map: PayoutMap = new Map()
  for (const payout of payouts) {
    map.set(`${payout.kind}|${payout.period_start}|${payout.period_end}`, payout)
  }
  return map
}

function between<T>(rows: T[], key: keyof T, start: Date, end: Date): T[] {
  const a = localDate(start)
  const b = localDate(end)
  return rows.filter((row) => a <= String(row[key]) && String(row[key]) <= b)
}

function totals(rows: { rate: number }[], qtyKey: 'hours' | 'miles'): [number, number] {
  let qty = 0
  const pairs: [number, number][] = []
  for (const row of rows as unknown as Record<string, number>[]) {
    qty += row[qtyKey]
    pairs.push([row[qtyKey], row.rate])
  }
  return [q2(qty), sumPay(pairs)]
}

function periodBounds(start: Date, end: Date, settings: Settings, today: Date) {
  const anchor = parseISODate(settings.cycle_anchor)
  const cycle = settings.cycle
  const [currentStart, currentEnd] = periodContaining(today, anchor, cycle)
  const [prevStart] = previousPeriod(start, anchor, cycle)
  const isCurrent = localDate(start) === localDate(currentStart) && localDate(end) === localDate(currentEnd)
  let nextStart: string | null = null
  if (!isCurrent) {
    const [nxt] = nextPeriod(end, anchor, cycle)
    if (nxt <= currentStart) nextStart = localDate(nxt)
  }
  const payday = paydayFor(end, settings.payday_offset_days)
  const [snappedStart, snappedEnd] = periodContaining(start, anchor, cycle)
  return {
    cycle,
    is_current: isCurrent,
    prev_start: localDate(prevStart),
    next_start: nextStart,
    payday: payday ? localDate(payday) : null,
    recorded_only:
      localDate(start) !== localDate(snappedStart) || localDate(end) !== localDate(snappedEnd),
  }
}

export function summarize(
  start: Date,
  end: Date,
  settings: Settings,
  timeEntries: TimeEntry[],
  mileEntries: MileageEntry[],
  payouts: PayoutMap,
  today: Date,
  expenseEntries: ExpenseEntry[],
) {
  const timed = between(timeEntries, 'date', start, end)
  const driven = between(mileEntries, 'date', start, end)
  const spent = between(expenseEntries, 'date', start, end)
  const [hours, hoursPay] = totals(timed, 'hours')
  const [miles, mileagePay] = totals(driven, 'miles')
  const expenses = sumAmounts(spent.map((row) => row.amount))
  const startIso = localDate(start)
  const endIso = localDate(end)
  return {
    start: startIso,
    end: endIso,
    hours,
    hours_pay: hoursPay,
    miles,
    mileage_pay: mileagePay,
    expenses,
    combined: sumAmounts([hoursPay, mileagePay, expenses]),
    mixed_hour_rates: new Set(timed.map((row) => row.rate)).size > 1,
    mixed_mile_rates: new Set(driven.map((row) => row.rate)).size > 1,
    hours_payout: payouts.get(`hours|${startIso}|${endIso}`) ?? null,
    mileage_payout: payouts.get(`mileage|${startIso}|${endIso}`) ?? null,
    expenses_payout: payouts.get(`expenses|${startIso}|${endIso}`) ?? null,
    ...periodBounds(start, end, settings, today),
  }
}

export type Summary = ReturnType<typeof summarize>

export function withDays(
  summary: Summary,
  timeEntries: TimeEntry[],
  mileEntries: MileageEntry[],
  expenseEntries: ExpenseEntry[],
): PeriodDetail {
  const start = parseISODate(summary.start)
  const end = parseISODate(summary.end)
  const days: PeriodDay[] = []
  for (const day of iterDates(start, end)) {
    const iso = localDate(day)
    const timed = timeEntries.filter((row) => row.date === iso)
    const driven = mileEntries.filter((row) => row.date === iso)
    const spent = expenseEntries.filter((row) => row.date === iso)
    const [hours, hoursPay] = totals(timed, 'hours')
    const [miles, mileagePay] = totals(driven, 'miles')
    days.push({
      date: iso,
      hours,
      hours_pay: hoursPay,
      miles,
      mileage_pay: mileagePay,
      expenses: sumAmounts(spent.map((row) => row.amount)),
      time_entries: timed,
      mileage_entries: driven,
      expense_entries: spent,
    })
  }
  return { ...summary, days }
}

export function buildReport(
  settings: Settings,
  timeEntries: TimeEntry[],
  mileEntries: MileageEntry[],
  payouts: Payout[],
  taskRows: Task[],
  expenseEntries: ExpenseEntry[],
  start: Date,
  end: Date,
  today: Date,
) {
  const timed = between(timeEntries, 'date', start, end)
  const driven = between(mileEntries, 'date', start, end)
  const spent = between(expenseEntries, 'date', start, end)
  const [hours, hoursPay] = totals(timed, 'hours')
  const [miles, mileagePay] = totals(driven, 'miles')
  const expenses = sumAmounts(spent.map((row) => row.amount))
  const a = localDate(start)
  const b = localDate(end)
  const tasks = taskRows.filter((row) => a <= row.date && row.date <= b)
  const inRange = payouts.filter((row) => a <= row.paid_on && row.paid_on <= b)
  return {
    name: settings.display_name,
    start: a,
    end: b,
    prepared: localDate(today),
    hours,
    hours_pay: hoursPay,
    miles,
    mileage_pay: mileagePay,
    expenses,
    combined: sumAmounts([hoursPay, mileagePay, expenses]),
    tasks_done: tasks.filter((task) => task.done).length,
    tasks_open: tasks.filter((task) => !task.done).length,
    time_entries: timed,
    mileage_entries: driven,
    expense_entries: spent,
    tasks,
    payouts: inRange,
  }
}

export function dashboard(
  settings: Settings,
  timeEntries: TimeEntry[],
  mileEntries: MileageEntry[],
  payoutRows: Payout[],
  taskRows: Task[],
  expenseEntries: ExpenseEntry[],
  today: Date,
  rangeStart?: Date,
  rangeEnd?: Date,
) {
  const anchor = parseISODate(settings.cycle_anchor)
  const [periodStart, periodEnd] = periodContaining(today, anchor, settings.cycle)
  const start = rangeStart ?? periodStart
  const end = rangeEnd ?? periodEnd
  const payouts = payoutIndex(payoutRows)
  const period = summarize(periodStart, periodEnd, settings, timeEntries, mileEntries, payouts, today, expenseEntries)
  const worked = new Set(
    between(timeEntries, 'date', periodStart, periodEnd)
      .filter((row) => row.hours > 0)
      .map((row) => row.date),
  )
  const [weekStart, weekEnd] = weekContaining(today)
  const weekTasks = taskRows.filter(
    (row) => localDate(weekStart) <= row.date && row.date <= localDate(weekEnd),
  )
  const todayIso = localDate(today)
  const [todayHours] = totals(
    timeEntries.filter((row) => row.date === todayIso),
    'hours',
  )
  const [todayMiles] = totals(
    mileEntries.filter((row) => row.date === todayIso),
    'miles',
  )
  const [monthStart, monthEnd] = monthBounds(today)
  let received = 0
  for (const row of payoutRows) {
    if (localDate(monthStart) <= row.paid_on && row.paid_on <= localDate(monthEnd)) {
      received = q2(received + row.amount)
    }
  }
  const report = buildReport(
    settings,
    timeEntries,
    mileEntries,
    payoutRows,
    taskRows,
    expenseEntries,
    start,
    end,
    today,
  )
  const hoursByDay = new Map<string, number>()
  const milesByDay = new Map<string, number>()
  for (const row of between(timeEntries, 'date', start, end)) {
    hoursByDay.set(row.date, q2((hoursByDay.get(row.date) ?? 0) + row.hours))
  }
  for (const row of between(mileEntries, 'date', start, end)) {
    milesByDay.set(row.date, q2((milesByDay.get(row.date) ?? 0) + row.miles))
  }
  const series = iterDates(start, end).map((point) => {
    const iso = localDate(point)
    return { date: iso, hours: hoursByDay.get(iso) ?? 0, miles: milesByDay.get(iso) ?? 0 }
  })
  return {
    period: {
      start: period.start,
      end: period.end,
      hours: period.hours,
      hours_pay: period.hours_pay,
      miles: period.miles,
      mileage_pay: period.mileage_pay,
      expenses: period.expenses,
      combined: period.combined,
      days_worked: worked.size,
      hours_payout: period.hours_payout,
      mileage_payout: period.mileage_payout,
      expenses_payout: period.expenses_payout,
      payday: period.payday,
    },
    week: {
      start: localDate(weekStart),
      end: localDate(weekEnd),
      tasks_done: weekTasks.filter((task) => task.done).length,
      tasks_open: weekTasks.filter((task) => !task.done).length,
    },
    today: {
      date: todayIso,
      hours: todayHours,
      miles: todayMiles,
      tasks_open: taskRows.filter((row) => row.date === todayIso && !row.done).length,
    },
    month_received: received,
    range: {
      start: report.start,
      end: report.end,
      hours: report.hours,
      hours_pay: report.hours_pay,
      miles: report.miles,
      mileage_pay: report.mileage_pay,
      expenses: report.expenses,
      combined: report.combined,
      tasks_done: report.tasks_done,
      tasks_open: report.tasks_open,
      expense_entries: report.expense_entries,
      series,
    },
  }
}

export function history(
  settings: Settings,
  timeEntries: TimeEntry[],
  mileEntries: MileageEntry[],
  payoutRows: Payout[],
  today: Date,
  expenseEntries: ExpenseEntry[],
) {
  const anchor = parseISODate(settings.cycle_anchor)
  const cycle = settings.cycle
  const earliest = [
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 60),
    ...timeEntries.map((row) => parseISODate(row.date)),
    ...mileEntries.map((row) => parseISODate(row.date)),
    ...payoutRows.map((row) => parseISODate(row.period_start)),
    ...payoutRows.map((row) => parseISODate(row.paid_on)),
  ].reduce((min, day) => (day < min ? day : min))
  const payouts = payoutIndex(payoutRows)
  const generated: [Date, Date][] = []
  const seen = new Set<string>()
  let [start, end] = periodContaining(today, anchor, cycle)
  for (let i = 0; i < 80; i++) {
    generated.push([start, end])
    seen.add(`${localDate(start)}|${localDate(end)}`)
    if (start <= earliest) break
    ;[start, end] = previousPeriod(start, anchor, cycle)
  }
  const extras: [Date, Date][] = []
  for (const row of payoutRows) {
    const key = `${row.period_start}|${row.period_end}`
    if (!seen.has(key)) {
      extras.push([parseISODate(row.period_start), parseISODate(row.period_end)])
      seen.add(key)
    }
  }
  const periods = []
  for (const [periodStart, periodEnd] of generated) {
    periods.push({
      ...summarize(periodStart, periodEnd, settings, timeEntries, mileEntries, payouts, today, expenseEntries),
      recorded_only: false,
    })
  }
  for (const [periodStart, periodEnd] of extras) {
    periods.push({
      ...summarize(periodStart, periodEnd, settings, timeEntries, mileEntries, payouts, today, expenseEntries),
      recorded_only: true,
    })
  }
  const received = new Map<string, number>()
  for (const row of payoutRows) {
    const key = row.paid_on.slice(0, 7)
    received.set(key, q2((received.get(key) ?? 0) + row.amount))
  }
  const grouped = new Map<string, typeof periods>()
  for (const item of periods) {
    const key = item.end.slice(0, 7)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(item)
  }
  for (const key of received.keys()) if (!grouped.has(key)) grouped.set(key, [])
  return [...grouped.keys()]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({
      month: key,
      label: monthLabel(key),
      received: received.get(key) ?? 0,
      periods: grouped.get(key)!.slice().sort((a, b) => (a.start < b.start ? 1 : -1)),
    }))
}

export { monthKey }
