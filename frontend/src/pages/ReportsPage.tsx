import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { downloadFile } from '../api'
import { Sheet, useApp } from '../app-context'
import { addDays, formatDay, formatPeriod, hoursText, localDate, milesText, mondayOnOrBefore, money, parseISODate, workdayAverage } from '../format'
import { downloadCsv, renderCsv } from '../domain/csv'
import { buildReport, dashboard as buildDashboard } from '../domain/summary'
import { db } from '../store/db'
import { createExpense, createPayout, deleteExpense, deletePayout, updateExpense } from '../store/repository'
import type { ExpenseEntry, SeriesPoint } from '../types'

type Preset = 'period' | 'week' | 'month' | 'last' | 'custom'

export function ReportsPage() {
  const { today, settings, toast } = useApp()
  const [payOpen, setPayOpen] = useState(false)
  const [expenseSheet, setExpenseSheet] = useState<ExpenseSheet>(null)
  const [preset, setPreset] = useState<Preset>('period')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [busy, setBusy] = useState<'csv' | 'pdf' | 'summary' | null>(null)
  const range = bounds(preset, today, customStart, customEnd)

  const timeEntries = useLiveQuery(() => db.time_entries.toArray(), [], [])
  const mileEntries = useLiveQuery(() => db.mileage_entries.toArray(), [], [])
  const expenseEntries = useLiveQuery(() => db.expense_entries.toArray(), [], [])
  const taskRows = useLiveQuery(() => db.tasks.toArray(), [], [])
  const payoutRows = useLiveQuery(() => db.payouts.toArray(), [], [])

  const data = useMemo(() => {
    // An unfinished custom range must not blank the page. The chart and
    // export buttons wait until both dates are present and in order.
    const todayDate = parseISODate(today)
    return buildDashboard(
      settings,
      timeEntries,
      mileEntries,
      payoutRows,
      taskRows,
      expenseEntries,
      todayDate,
      range ? parseISODate(range.start) : undefined,
      range ? parseISODate(range.end) : undefined,
    )
  }, [settings, today, range?.start, range?.end, timeEntries, mileEntries, payoutRows, taskRows, expenseEntries])

  function report() {
    if (!data) return null
    return buildReport(
      settings,
      timeEntries,
      mileEntries,
      payoutRows,
      taskRows,
      expenseEntries,
      parseISODate(data.range.start),
      parseISODate(data.range.end),
      parseISODate(today),
    )
  }

  async function exportFile(ext: 'csv' | 'pdf' | 'summary') {
    if (!data) return
    setBusy(ext)
    try {
      if (ext === 'csv') {
        const built = report()
        if (built) downloadCsv(renderCsv(built), `assist-${data.range.start}-to-${data.range.end}.csv`)
      } else {
        const params = new URLSearchParams({ start: data.range.start, end: data.range.end, today })
        const summary = ext === 'summary'
        if (summary) params.set('tasks', 'count')
        const name = summary
          ? `assist-${data.range.start}-to-${data.range.end}-summary.pdf`
          : `assist-${data.range.start}-to-${data.range.end}.pdf`
        await downloadFile(`/api/export/pdf?${params}`, name)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not export')
    } finally {
      setBusy(null)
    }
  }

  const expected = preset === 'period'
    ? (data ? { start: data.period.start, end: data.period.end } : null)
    : range
  const chartReady = Boolean(data && expected && data.range.start === expected.start && data.range.end === expected.end)
  const weekTotal = data.week.tasks_done + data.week.tasks_open
  const cols = chartColumns(data.range.series)
  const maxHours = Math.max(...cols.map((col) => col.hours), 0)
  const maxMiles = Math.max(...cols.map((col) => col.miles), 0)
  const emptyChart = maxHours === 0 && maxMiles === 0

  return (
    <main className="screen">
      <h1>Reports</h1>
      <section className="hero">
        <p className="eyebrow">This pay period</p>
        <div className="money">{money(data.period.combined)}</div>
        <p>{formatPeriod(data.period.start, data.period.end)}</p>
        <p className="sub">
          {hoursText(data.period.hours)} · {milesText(data.period.miles)} · {money(data.period.expenses)} expenses
        </p>
        <p className="sub">
          {isPaid(data.period) ? 'Paid' : 'Not paid yet'}
        </p>
        <div className="card-actions">
          <button className="btn primary" type="button" onClick={() => setPayOpen(true)}>
            {isPaid(data.period) ? 'Paid' : 'Mark paid'}
          </button>
        </div>
      </section>
      <div className="stat-grid">
        <Stat label="Hours pay" value={money(data.period.hours_pay)} />
        <Stat label="Mileage pay" value={money(data.period.mileage_pay)} />
        <Stat label="Expenses" value={money(data.period.expenses)} />
        <Stat label="Hours" value={hoursText(data.period.hours)} />
        <Stat label="Avg per workday" value={workdayAverage(data.period.hours, data.period.days_worked)} />
        <Stat label="Miles" value={milesText(data.period.miles)} />
        <Stat label="Tasks this week" value={weekTotal ? `${data.week.tasks_done} of ${weekTotal}` : 'None yet'} />
        <Stat label="Open today" value={String(data.today.tasks_open)} />
        <Stat label="Received this month" value={money(data.month_received)} />
        <Stat label="Days worked" value={String(data.period.days_worked)} />
      </div>
      <div className="presets">
        {([
          ['period', 'Period'],
          ['week', 'Week'],
          ['month', 'Month'],
          ['last', 'Last month'],
          ['custom', 'Custom'],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" className={preset === value ? 'on' : ''} onClick={() => setPreset(value)}>{label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="stat-grid">
          <label className="field">
            <span>From</span>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </label>
        </div>
      )}
      <section className="expenses">
        <div className="month-head">
          <h2>Expenses</h2>
          <button className="text-btn" type="button" onClick={() => setExpenseSheet({ type: 'add' })}>Add</button>
        </div>
        {!chartReady && preset === 'custom' && <p className="quiet">Pick a start and end.</p>}
        {!chartReady && preset !== 'custom' && <div className="skeleton" />}
        {chartReady && data.range.expense_entries.length === 0 && (
          <p className="quiet">Nothing to reimburse in this range yet.</p>
        )}
        {chartReady && data.range.expense_entries.map((item) => (
          <button key={item.uid} className="entry today-entry" type="button" onClick={() => setExpenseSheet({ type: 'edit', entry: item })}>
            <span className="entry-note">{formatDay(item.date)} · {item.note}</span>
            <span className="entry-pay">{money(item.amount)}</span>
          </button>
        ))}
      </section>
      <section className="chart">
        {!chartReady && preset === 'custom' && <p className="quiet">Pick a start and end.</p>}
        {!chartReady && preset !== 'custom' && <div className="skeleton" />}
        {chartReady && (
          <>
        <p className="eyebrow">{formatPeriod(data.range.start, data.range.end)}</p>
        <p className="sub">{hoursText(data.range.hours)} · {milesText(data.range.miles)} · {money(data.range.expenses)} expenses · {money(data.range.combined)}</p>
        {emptyChart ? <p className="quiet">Nothing logged in this range yet.</p> : (
          <div className="bars" aria-hidden="true">
            {cols.map((col) => (
              <div key={col.key} className="col">
                <div className="pair-bars">
                  <div className="bar" style={{ height: barHeight(col.hours, maxHours) }} />
                  <div className="bar miles" style={{ height: barHeight(col.miles, maxMiles) }} />
                </div>
                <span>{col.label}</span>
              </div>
            ))}
          </div>
        )}
        <div className="legend">
          <span><i className="swatch" /> Hours</span>
          <span><i className="swatch miles" /> Miles</span>
        </div>
          </>
        )}
      </section>
      <div className="export-row">
        <button className="btn primary" type="button" disabled={busy !== null || !chartReady} onClick={() => void exportFile('pdf')}>
          {busy === 'pdf' ? 'Preparing…' : 'PDF with tasks'}
        </button>
        <button className="btn ghost" type="button" disabled={busy !== null || !chartReady} onClick={() => void exportFile('summary')}>
          {busy === 'summary' ? 'Preparing…' : 'PDF, task count'}
        </button>
        <button className="btn ghost" type="button" disabled={busy !== null || !chartReady} onClick={() => void exportFile('csv')}>
          {busy === 'csv' ? 'Preparing…' : 'CSV'}
        </button>
      </div>
      <p className="help">Both PDFs include hours, miles, expenses, and payouts. PDF with tasks names each task. PDF, task count only says how many were completed. CSV works offline; PDF needs the server.</p>
      <PaySheet
        open={payOpen}
        today={today}
        period={data.period}
        onClose={() => setPayOpen(false)}
        onDone={(message) => {
          setPayOpen(false)
          toast(message)
        }}
      />
      <ExpenseForm
        sheet={expenseSheet}
        today={today}
        onClose={() => setExpenseSheet(null)}
        onDone={(message) => {
          setExpenseSheet(null)
          toast(message)
        }}
      />
    </main>
  )
}

function PaySheet({
  open,
  today,
  period,
  onClose,
  onDone,
}: {
  open: boolean
  today: string
  period: ReturnType<typeof buildDashboard>['period']
  onClose: () => void
  onDone: (message: string) => void
}) {
  const paid = isPaid(period)
  const [paidOn, setPaidOn] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await createPayout(period, paidOn, note)
      onDone('Marked paid')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  async function undo() {
    setBusy(true)
    try {
      const uids = [period.hours_payout?.uid, period.mileage_payout?.uid, period.expenses_payout?.uid].filter((uid): uid is string => Boolean(uid))
      for (const uid of uids) await deletePayout(uid)
      onDone('Undone')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not undo')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={paid ? 'Paid' : 'Mark paid'} onClose={onClose}>
      {paid ? (
        <div>
          <p className="money">{money(period.combined)}</p>
          <p>Hours, miles, and expenses, paid {formatDay(period.hours_payout?.paid_on || period.mileage_payout?.paid_on || period.expenses_payout?.paid_on || today)}</p>
          {problem && <p className="mismatch">{problem}</p>}
          <button className="danger" type="button" disabled={busy} onClick={() => void undo()}>Undo paid</button>
        </div>
      ) : (
        <form onSubmit={save}>
          <p>This saves {money(period.hours_pay)} in hours, {money(period.mileage_pay)} in miles, and {money(period.expenses)} in expenses.</p>
          <label className="field">
            <span>Paid on</span>
            <input type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} required />
          </label>
          <label className="field">
            <span>Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
          {problem && <p className="mismatch">{problem}</p>}
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save payout'}</button>
        </form>
      )}
    </Sheet>
  )
}

type ExpenseSheet = null | { type: 'add' } | { type: 'edit'; entry: ExpenseEntry }

function isPaid(period: { hours_payout: unknown; mileage_payout: unknown; expenses_payout: unknown }) {
  return Boolean(period.hours_payout && period.mileage_payout && period.expenses_payout)
}

function ExpenseForm({
  sheet,
  today,
  onClose,
  onDone,
}: {
  sheet: ExpenseSheet
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const entry = sheet?.type === 'edit' ? sheet.entry : null
  const [day, setDay] = useState(today)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!sheet) return
    setDay(entry?.date ?? today)
    setAmount(entry ? String(entry.amount) : '')
    setNote(entry?.note ?? '')
    setBusy(false)
    setProblem('')
    setArmed(false)
  }, [sheet, entry, today])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const value = Number(amount)
    if (!note.trim()) {
      setProblem('Say what it was')
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setProblem('Enter the amount')
      return
    }
    setBusy(true)
    setProblem('')
    try {
      if (entry) await updateExpense(entry.uid, { date: day, amount: value, note })
      else await createExpense({ date: day, amount: value, note })
      onDone('Saved')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  async function remove() {
    if (!entry) return
    if (!armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    try {
      await deleteExpense(entry.uid)
      onDone('Deleted')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not delete')
      setBusy(false)
    }
  }

  return (
    <Sheet open={sheet !== null} title={entry ? 'Edit expense' : 'Add expense'} onClose={onClose}>
      <form onSubmit={save}>
        <label className="field">
          <span>Day</span>
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} required />
        </label>
        <label className="field">
          <span>Amount</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
        </label>
        <label className="field">
          <span>What was it?</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Uber back" required />
        </label>
        {problem && <p className="mismatch">{problem}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {entry && (
          <button className="danger" type="button" disabled={busy} onClick={() => void remove()}>{armed ? 'Tap again to delete' : 'Delete'}</button>
        )}
      </form>
    </Sheet>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  )
}

function bounds(preset: Preset, today: string, customStart: string, customEnd: string) {
  const d = parseISODate(today)
  if (preset === 'week') {
    const start = mondayOnOrBefore(d)
    return { start: localDate(start), end: localDate(addDays(start, 6)) }
  }
  if (preset === 'month') {
    return {
      start: localDate(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: localDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    }
  }
  if (preset === 'last') {
    return {
      start: localDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
      end: localDate(new Date(d.getFullYear(), d.getMonth(), 0)),
    }
  }
  if (preset === 'custom') {
    if (!customStart || !customEnd || customStart > customEnd) return null
    return { start: customStart, end: customEnd }
  }
  return null
}

function chartColumns(series: SeriesPoint[]) {
  const size = series.length <= 16 ? 1 : Math.ceil(series.length / 16)
  const cols = []
  for (let i = 0; i < series.length; i += size) {
    const slice = series.slice(i, i + size)
    cols.push({
      key: slice[0].date,
      label: String(parseISODate(slice[0].date).getDate()),
      hours: slice.reduce((sum, point) => sum + point.hours, 0),
      miles: slice.reduce((sum, point) => sum + point.miles, 0),
    })
  }
  return cols
}

function barHeight(value: number, max: number) {
  if (max <= 0 || value <= 0) return '3px'
  return `${Math.max(8, (value / max) * 96)}px`
}
