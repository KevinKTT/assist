import { useEffect, useState } from 'react'
import { api, downloadFile } from '../api'
import { Sheet, useApp } from '../app-context'
import { newUid } from '../uid'
import { addDays, formatDay, formatPeriod, hoursText, localDate, milesText, money, parseISODate, sundayOnOrBefore } from '../format'
import type { Dashboard, ExpenseEntry, SeriesPoint } from '../types'

type Preset = 'period' | 'week' | 'month' | 'last' | 'custom'

export function ReportsPage() {
  const { today, revision, toast, bump } = useApp()
  const [payOpen, setPayOpen] = useState(false)
  const [expenseSheet, setExpenseSheet] = useState<ExpenseSheet>(null)
  const [preset, setPreset] = useState<Preset>('period')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [data, setData] = useState<Dashboard | null>(null)
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)
  const range = bounds(preset, today, customStart, customEnd)

  useEffect(() => {
    if (preset === 'custom' && !range) return
    let live = true
    const params = new URLSearchParams({ today })
    if (range) {
      params.set('start', range.start)
      params.set('end', range.end)
    }
    api<Dashboard>(`/api/dashboard?${params}`)
      .then((next) => {
        if (live) setData(next)
      })
      .catch((err: Error) => {
        if (live) toast(err.message)
      })
    return () => {
      live = false
    }
  }, [today, revision, preset, range?.start, range?.end, toast])

  async function exportFile(ext: 'csv' | 'pdf') {
    if (!data) return
    setBusy(ext)
    try {
      const params = new URLSearchParams({ start: data.range.start, end: data.range.end, today })
      await downloadFile(`/api/export/${ext}?${params}`, `assist-${data.range.start}-to-${data.range.end}.${ext}`)
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
  if (!data) return <main className="screen"><div className="skeleton" /></main>
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
          <button key={item.id} className="entry today-entry" type="button" onClick={() => setExpenseSheet({ type: 'edit', entry: item })}>
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
          {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
        </button>
        <button className="btn ghost" type="button" disabled={busy !== null || !chartReady} onClick={() => void exportFile('csv')}>
          {busy === 'csv' ? 'Preparing…' : 'CSV'}
        </button>
      </div>
      <p className="help">Includes hours, miles, expenses, tasks, and payouts in this range.</p>
      <PaySheet
        open={payOpen}
        today={today}
        period={data.period}
        onClose={() => setPayOpen(false)}
        onDone={(message) => {
          setPayOpen(false)
          toast(message)
          bump()
        }}
      />
      <ExpenseForm
        sheet={expenseSheet}
        today={today}
        onClose={() => setExpenseSheet(null)}
        onDone={(message) => {
          setExpenseSheet(null)
          toast(message)
          bump()
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
  period: Dashboard['period']
  onClose: () => void
  onDone: (message: string) => void
}) {
  const paid = isPaid(period)
  const [paidOn, setPaidOn] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    if (!open) return
    setPaidOn(today)
    setNote('')
    setProblem('')
    setBusy(false)
  }, [open, today])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/payouts', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'both',
          period_start: period.start,
          period_end: period.end,
          paid_on: paidOn,
          note,
          uid: newUid(),
        }),
      })
      onDone('Marked paid')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  async function undo() {
    setBusy(true)
    try {
      const ids = [period.hours_payout?.id, period.mileage_payout?.id, period.expenses_payout?.id].filter((id): id is number => id != null)
      await Promise.all(ids.map((id) => api(`/api/payouts/${id}`, { method: 'DELETE' })))
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

function isPaid(period: Dashboard['period']) {
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
      const body = { expense_date: day, amount: value, note }
      if (entry) await api(`/api/expenses/${entry.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else await api('/api/expenses', { method: 'POST', body: JSON.stringify({ ...body, uid: newUid() }) })
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
      await api(`/api/expenses/${entry.id}`, { method: 'DELETE' })
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
    const start = sundayOnOrBefore(d)
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
