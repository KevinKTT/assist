import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Sheet, useApp } from '../app-context'
import { clock, clockFace, clockRange, dayNumber, formatDay, formatPeriod, hoursText, localDate, milesText, money, parseISODate, rateText, splitHours, weekday, weekdayShort } from '../format'
import { periodContaining } from '../domain/periods'
import { history, payoutIndex, summarize, withDays } from '../domain/summary'
import { db, getRunning } from '../store/db'
import {
  createExpense,
  createMileage,
  createTime,
  deleteExpense,
  deleteMileage,
  deleteTime,
  adjustTimer as persistTimer,
  startTimer as beginTimer,
  stopTimer as endTimer,
  updateExpense,
  updateMileage,
  updateTime,
} from '../store/repository'
import type { ExpenseEntry, HistoryPeriod, Kind, MileageEntry, PeriodDay, PeriodDetail, Running, Settings, TimeEntry } from '../types'

type LogEntry = TimeEntry | MileageEntry | ExpenseEntry

type SheetState =
  | null
  | { type: 'add'; date: string }
  | { type: 'time'; entry: TimeEntry }
  | { type: 'mile'; entry: MileageEntry }
  | { type: 'expense'; entry: ExpenseEntry }

export function HoursPage() {
  return <LogPage kind="hours" />
}

export function MilesPage() {
  return <LogPage kind="mileage" />
}

export function ExpensesPage() {
  return <LogPage kind="expenses" />
}

function LogPage({ kind }: { kind: Kind }) {
  const { today, settings, toast, openSettings } = useApp()
  const [start, setStart] = useState<string | null>(null)
  const [view, setView] = useState<'today' | 'period' | 'history'>('today')
  const [drill, setDrill] = useState<{ start: string; end: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState<SheetState>(null)

  const timeEntries = useLiveQuery(() => db.time_entries.toArray(), [], [] as TimeEntry[])
  const mileEntries = useLiveQuery(() => db.mileage_entries.toArray(), [], [] as MileageEntry[])
  const expenseEntries = useLiveQuery(() => db.expense_entries.toArray(), [], [] as ExpenseEntry[])
  const payoutRows = useLiveQuery(() => db.payouts.toArray(), [], [])
  const running = useLiveQuery(() => getRunning(), [], null as Running | null)

  const period = useMemo(() => {
    const anchor = parseISODate(settings.cycle_anchor)
    const todayDate = parseISODate(today)
    const [periodStart, periodEnd] = start
      ? periodContaining(parseISODate(start), anchor, settings.cycle)
      : periodContaining(todayDate, anchor, settings.cycle)
    const payouts = payoutIndex(payoutRows)
    return withDays(
      summarize(periodStart, periodEnd, settings, timeEntries, mileEntries, payouts, todayDate, expenseEntries),
      timeEntries,
      mileEntries,
      expenseEntries,
    )
  }, [settings, today, start, timeEntries, mileEntries, expenseEntries, payoutRows])

  const drillPeriod = useMemo(() => {
    if (!drill) return null
    const payouts = payoutIndex(payoutRows)
    return withDays(
      summarize(parseISODate(drill.start), parseISODate(drill.end), settings, timeEntries, mileEntries, payouts, parseISODate(today), expenseEntries),
      timeEntries,
      mileEntries,
      expenseEntries,
    )
  }, [drill, settings, today, timeEntries, mileEntries, expenseEntries, payoutRows])

  const historyMonths = useMemo(
    () => (view === 'history' ? history(settings, timeEntries, mileEntries, payoutRows, parseISODate(today), expenseEntries) : null),
    [view, settings, today, timeEntries, mileEntries, payoutRows, expenseEntries],
  )

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  async function startTimer() {
    try {
      await beginTimer(today, new Date().toISOString())
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start')
    }
  }

  async function stopTimer() {
    try {
      const result = await endTimer(new Date().toISOString())
      if (result.discarded) toast('That was too short to save')
      else if (result.entry && result.entry.hours > 16) toast('That was a long clock-in. Tap it if the hours need a fix.')
      else toast('Hours saved')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not stop')
    }
  }

  const shown = view === 'history' && drillPeriod ? drillPeriod : period
  const title = pageTitle(kind)

  function openEntry(entry: LogEntry) {
    if ('hours' in entry) setSheet({ type: 'time', entry })
    else if ('miles' in entry) setSheet({ type: 'mile', entry })
    else setSheet({ type: 'expense', entry })
  }

  return (
    <main className="screen">
      <h1>{title}</h1>
      {kind === 'hours' && settings.hourly_rate <= 0 && (
        <button className="nudge" type="button" onClick={openSettings}>Add an hourly rate to see what this period will pay.</button>
      )}
      {kind === 'mileage' && settings.mileage_rate <= 0 && (
        <button className="nudge" type="button" onClick={openSettings}>Add a per-mile rate to see the reimbursement.</button>
      )}
      {kind === 'hours' && running && (
        <RunningTimer
          running={running}
          now={now}
          today={today}
          onStop={() => void stopTimer()}
          onAdjust={persistTimer}
          toast={toast}
        />
      )}
      <div className="segment thirds">
        <button type="button" className={view === 'today' ? 'on' : ''} onClick={() => { setView('today'); setDrill(null); setStart(null) }}>Today</button>
        <button type="button" className={view === 'period' ? 'on' : ''} onClick={() => { setView('period'); setDrill(null); setStart(null) }}>This period</button>
        <button type="button" className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>History</button>
      </div>
      {view === 'history' && !drill && (
        <HistoryList months={historyMonths} kind={kind} onOpen={(item) => setDrill({ start: item.start, end: item.end })} />
      )}
      {view === 'history' && drill && (
        <button className="back" type="button" onClick={() => setDrill(null)}>Back to history</button>
      )}
      {view === 'today' && (
        <TodayCard
          period={period}
          kind={kind}
          today={today}
          showTimer={kind === 'hours' && !running}
          onAdd={() => setSheet({ type: 'add', date: today })}
          onStart={() => void startTimer()}
          onEdit={openEntry}
        />
      )}
      {view === 'period' && (
        <>
          <PeriodCard period={period} kind={kind} settings={settings} />
          <DayList
            period={period}
            kind={kind}
            today={today}
            onAdd={(date) => setSheet({ type: 'add', date: date > today ? today : date })}
            onEdit={openEntry}
          />
        </>
      )}
      {view === 'history' && drill && shown && (
        <>
          <PeriodCard period={shown} kind={kind} settings={settings} />
          <DayList
            period={shown}
            kind={kind}
            today={today}
            onAdd={(date) => setSheet({ type: 'add', date })}
            onEdit={openEntry}
          />
        </>
      )}
      <EntrySheet
        sheet={sheet}
        kind={kind}
        today={today}
        onClose={() => setSheet(null)}
        onDone={(message) => {
          setSheet(null)
          toast(message)
        }}
      />
    </main>
  )
}

const WHEEL_MINUTES = 24 * 60
const WHEEL_ITEM = 40
const WHEEL_BACK = Array.from({ length: WHEEL_MINUTES + 1 }, (_, i) => i)

function minutesBack(createdIso: string, startedIso: string) {
  const back = Math.round((new Date(createdIso).getTime() - new Date(startedIso).getTime()) / 60_000)
  return Math.max(0, Math.min(WHEEL_MINUTES, back))
}

function earlierText(mins: number) {
  if (mins === 0) return 'Roll back to start earlier'
  const hours = Math.floor(mins / 60)
  const minutes = mins % 60
  if (hours === 0) return `${minutes} min earlier`
  if (minutes === 0) return hours === 1 ? '1 hour earlier' : `${hours} hours earlier`
  return `${hours === 1 ? '1 hr' : `${hours} hrs`} ${minutes} min earlier`
}

function RunningTimer({
  running,
  now,
  today,
  onStop,
  onAdjust,
  toast,
}: {
  running: Running
  now: number
  today: string
  onStop: () => void
  onAdjust: (date: string, startedAt: string) => Promise<void>
  toast: (message: string) => void
}) {
  const [localStart, setLocalStart] = useState(running.started_at)
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState(() => minutesBack(running.created_at, running.started_at))
  const startRef = useRef(running.started_at)
  const pickedRef = useRef(picked)
  const createdRef = useRef(running.created_at)
  const wheelRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | null>(null)
  const tail = useRef<Promise<void>>(Promise.resolve())
  createdRef.current = running.created_at

  const created = new Date(running.created_at)
  const tapDay = localDate(created)
  const rows = editing
    ? WHEEL_BACK.map((mins) => {
        const when = new Date(created.getTime() - mins * 60_000)
        const day = localDate(when)
        const face = clockFace(when)
        return day === tapDay ? face : `${weekdayShort(day)} ${face}`
      })
    : []

  useLayoutEffect(() => {
    const mins = minutesBack(running.created_at, startRef.current)
    pickedRef.current = mins
    setPicked(mins)
    if (wheelRef.current) wheelRef.current.scrollTop = mins * WHEEL_ITEM
  }, [running.id, running.created_at])

  useLayoutEffect(() => {
    if (!editing || !wheelRef.current) return
    wheelRef.current.scrollTop = pickedRef.current * WHEEL_ITEM
  }, [editing])

  useEffect(() => {
    return () => {
      if (!saveTimer.current) return
      window.clearTimeout(saveTimer.current)
      const iso = startRef.current
      void onAdjust(localDate(new Date(iso)), iso)
    }
  }, [])

  function persist(iso: string) {
    const run = tail.current.then(async () => {
      try {
        await onAdjust(localDate(new Date(iso)), iso)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not update the start')
      }
    })
    tail.current = run
    return run
  }

  function apply(index: number) {
    pickedRef.current = index
    setPicked(index)
    const next = new Date(createdRef.current).getTime() - index * 60_000
    if (Math.abs(next - new Date(startRef.current).getTime()) <= 30_000) return
    const iso = new Date(next).toISOString()
    startRef.current = iso
    setLocalStart(iso)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void persist(iso)
    }, 300)
  }

  function onScroll() {
    const el = wheelRef.current
    if (!el) return
    const index = Math.max(0, Math.min(WHEEL_MINUTES, Math.round(el.scrollTop / WHEEL_ITEM)))
    if (index === pickedRef.current) return
    apply(index)
  }

  function closeEdit() {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      void persist(startRef.current)
    }
    setEditing(false)
  }

  async function clockOut() {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      await persist(startRef.current)
    }
    await tail.current
    onStop()
  }

  const started = new Date(localStart)
  const day = localDate(started)

  return (
    <div className="timer">
      <div className="timer-top">
        <span className="pulse" />
        <div>
          <div className="timer-time">{clock(localStart, now)}</div>
          <button className="timer-start" type="button" onClick={() => (editing ? closeEdit() : setEditing(true))}>
            Started {clockFace(started)}
            {day !== today && ` · ${formatDay(day)}`}
            {editing ? '' : ' · Edit'}
          </button>
        </div>
        <button className="btn blush" type="button" onClick={() => void clockOut()}>Clock out</button>
      </div>
      {editing && (
        <>
          <div className="wheel-wrap">
            <div className="wheel-mark" />
            <div
              className="wheel"
              ref={wheelRef}
              role="listbox"
              aria-label="Roll the start time earlier"
              tabIndex={0}
              onScroll={onScroll}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const index = Math.max(0, Math.min(WHEEL_MINUTES, pickedRef.current + (event.key === 'ArrowUp' ? 1 : -1)))
                wheelRef.current?.scrollTo({ top: index * WHEEL_ITEM, behavior: 'smooth' })
              }}
            >
              <div className="wheel-pad" />
              {rows.map((label, mins) => (
                <div key={mins} className={mins === picked ? 'wheel-item on' : 'wheel-item'} role="option" aria-selected={mins === picked}>
                  {label}
                </div>
              ))}
              <div className="wheel-pad" />
            </div>
          </div>
          <p className="wheel-note">{earlierText(picked)}</p>
          <button className="text-btn timer-done" type="button" onClick={closeEdit}>Done</button>
        </>
      )}
    </div>
  )
}

function TodayCard({
  period,
  kind,
  today,
  showTimer,
  onAdd,
  onStart,
  onEdit,
}: {
  period: PeriodDetail
  kind: Kind
  today: string
  showTimer: boolean
  onAdd: () => void
  onStart: () => void
  onEdit: (entry: LogEntry) => void
}) {
  const day = period.days.find((item) => item.date === today)
  const entries = dayEntries(day, kind)
  return (
    <section className="card">
      <p className="eyebrow">{weekday(today)} · {formatDay(today)}</p>
      <div className="today-figure">{todayFigure(day, kind)}</div>
      <div className="card-actions">
        {showTimer && <button className="btn blush wide" type="button" onClick={onStart}>Clock in</button>}
        <button className="btn ghost" type="button" onClick={onAdd}>{addLabel(kind)}</button>
      </div>
      {entries.length === 0 && <p className="quiet">Nothing logged today</p>}
      {entries.map((entry) => (
        <EntryButton key={entry.uid} entry={entry} today onEdit={onEdit} />
      ))}
    </section>
  )
}

function PeriodCard({
  period,
  kind,
  settings,
}: {
  period: PeriodDetail
  kind: Kind
  settings: Settings
}) {
  const live = kind === 'hours' ? period.hours_pay : kind === 'mileage' ? period.mileage_pay : period.expenses
  return (
    <section className="card">
      <p className="eyebrow">{formatPeriod(period.start, period.end)}</p>
      <div className="money">{money(live)}</div>
      <p className="sub">
        {kind === 'expenses'
          ? expenseCountText(period)
          : `${kind === 'hours' ? hoursText(period.hours) : milesText(period.miles)} · ${rateLine(period, kind, settings)}`}
      </p>
    </section>
  )
}

function rateLine(period: PeriodDetail, kind: 'hours' | 'mileage', settings: Settings) {
  if (kind === 'hours') {
    if (period.mixed_hour_rates) return 'rates vary'
    const rate = period.days.flatMap((day) => day.time_entries)[0]?.rate ?? settings.hourly_rate
    if (!rate) return 'add a rate to see pay'
    return `at ${rateText(rate, 'hr')}`
  }
  if (period.mixed_mile_rates) return 'rates vary'
  const rate = period.days.flatMap((day) => day.mileage_entries)[0]?.rate ?? settings.mileage_rate
  if (!rate) return 'add a rate to see reimbursement'
  return `at ${rateText(rate, 'mi')}`
}

function DayList({
  period,
  kind,
  today,
  onAdd,
  onEdit,
}: {
  period: PeriodDetail
  kind: Kind
  today: string
  onAdd: (date: string) => void
  onEdit: (entry: LogEntry) => void
}) {
  return (
    <div className="daylist">
      {period.days.map((day) => {
        const entries = dayEntries(day, kind)
        const empty = entries.length === 0
        const total = kind === 'expenses'
          ? money(day.expenses)
          : `${kind === 'hours' ? hoursText(day.hours) : milesText(day.miles)} · ${money(kind === 'hours' ? day.hours_pay : day.mileage_pay)}`
        const classes = ['dayblock', day.date === today ? 'today' : '', empty ? 'empty' : ''].filter(Boolean).join(' ')
        return (
          <section key={day.date} className={classes}>
            <div className="dayline">
              <div className="daywhen">
                <span>{weekdayShort(day.date)}</span>
                <strong>{dayNumber(day.date)}</strong>
              </div>
              <div className="daytotal">{empty ? '—' : total}</div>
              {day.date <= today ? (
                <button className="mini-plus" type="button" aria-label={`Add for ${formatDay(day.date)}`} onClick={() => onAdd(day.date)}>+</button>
              ) : <span />}
            </div>
            {entries.map((entry) => (
              <EntryButton key={entry.uid} entry={entry} onEdit={onEdit} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

function EntryButton({
  entry,
  today = false,
  onEdit,
}: {
  entry: LogEntry
  today?: boolean
  onEdit: (entry: LogEntry) => void
}) {
  const expense = 'amount' in entry
  return (
    <button className={today ? 'entry today-entry' : 'entry'} type="button" onClick={() => onEdit(entry)}>
      {expense ? (
        today ? (
          <>
            <span>{money(entry.amount)}</span>
            <span className="entry-note">{entry.note}</span>
          </>
        ) : (
          <>
            <span className="entry-name">{entry.note}</span>
            <span className="entry-pay">{money(entry.amount)}</span>
          </>
        )
      ) : (
        <>
          <span>{'hours' in entry ? hoursText(entry.hours) : milesText(entry.miles)}</span>
          {'source' in entry && entry.source === 'timer' && <em>clocked</em>}
          {'started_at' in entry && entry.started_at && entry.ended_at && (
            <span className="entry-times">{clockRange(entry.started_at, entry.ended_at)}</span>
          )}
          {entry.note ? <span className="entry-note">{entry.note}</span> : <span className="entry-note" />}
          {!today && 'pay' in entry && <span className="entry-pay">{money(entry.pay)}</span>}
        </>
      )}
    </button>
  )
}

function HistoryList({
  months,
  kind,
  onOpen,
}: {
  months: ReturnType<typeof history> | null
  kind: Kind
  onOpen: (item: HistoryPeriod) => void
}) {
  if (!months) return <div className="skeleton" />
  return (
    <div>
      {months.map((month) => (
        <section key={month.month}>
          <div className="month-head">
            <h2>{month.label}</h2>
            <span className={month.received > 0 ? 'got' : 'muted'}>Received {money(month.received)}</span>
          </div>
          {month.periods.length === 0 && <p className="quiet">No pay period ended this month.</p>}
          {month.periods.map((item) => (
            <button key={`${item.start}-${item.end}`} className="history-row" type="button" onClick={() => onOpen(item)}>
              <strong>{formatPeriod(item.start, item.end)}</strong>
              {item.recorded_only && <span className="badge">Saved record</span>}
              <div className="pair">
                <div className={kind === 'hours' ? 'emph' : ''}>
                  <small>Hours</small>
                  <b>{money(item.hours_pay)}</b>
                </div>
                <div className={kind === 'mileage' ? 'emph' : ''}>
                  <small>Miles</small>
                  <b>{money(item.mileage_pay)}</b>
                </div>
                {(kind === 'expenses' || item.expenses > 0) && (
                  <div className={kind === 'expenses' ? 'emph' : ''}>
                    <small>Expenses</small>
                    <b>{money(item.expenses)}</b>
                  </div>
                )}
              </div>
              <div className="badges">
                <span className={item.hours_payout ? 'badge paid' : 'badge'}>{item.hours_payout ? 'Hours paid' : 'Hours open'}</span>
                <span className={item.mileage_payout ? 'badge paid' : 'badge'}>{item.mileage_payout ? 'Miles paid' : 'Miles open'}</span>
                {(kind === 'expenses' || item.expenses > 0) && (
                  <span className={item.expenses_payout ? 'badge paid' : 'badge'}>{item.expenses_payout ? 'Expenses paid' : 'Expenses open'}</span>
                )}
              </div>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

function EntrySheet({
  sheet,
  kind,
  today,
  onClose,
  onDone,
}: {
  sheet: SheetState
  kind: Kind
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  return (
    <Sheet open={sheet !== null} title={sheetTitle(sheet, kind)} onClose={onClose}>
      {sheet?.type === 'add' && (
        <LogForm kind={kind} today={today} date={sheet.date} onDone={onDone} />
      )}
      {sheet?.type === 'time' && <LogForm kind="hours" today={today} entry={sheet.entry} onDone={onDone} />}
      {sheet?.type === 'mile' && <LogForm kind="mileage" today={today} entry={sheet.entry} onDone={onDone} />}
      {sheet?.type === 'expense' && <LogForm kind="expenses" today={today} entry={sheet.entry} onDone={onDone} />}
    </Sheet>
  )
}

function sheetTitle(sheet: SheetState, kind: Kind) {
  if (!sheet) return ''
  if (sheet.type === 'add') return addLabel(kind)
  if (kind === 'hours') return 'Edit hours'
  if (kind === 'mileage') return 'Edit drive'
  return 'Edit expense'
}

function pageTitle(kind: Kind) {
  if (kind === 'hours') return 'Hours'
  if (kind === 'mileage') return 'Miles'
  return 'Expenses'
}

function addLabel(kind: Kind) {
  if (kind === 'hours') return 'Add hours'
  if (kind === 'mileage') return 'Add miles'
  return 'Add expense'
}

function dayEntries(day: PeriodDay | undefined, kind: Kind): LogEntry[] {
  if (!day) return []
  if (kind === 'hours') return day.time_entries
  if (kind === 'mileage') return day.mileage_entries
  return day.expense_entries
}

function todayFigure(day: PeriodDay | undefined, kind: Kind) {
  if (kind === 'hours') return hoursText(day?.hours ?? 0)
  if (kind === 'mileage') return milesText(day?.miles ?? 0)
  return money(day?.expenses ?? 0)
}

function expenseCountText(period: PeriodDetail) {
  const count = period.days.reduce((sum, day) => sum + day.expense_entries.length, 0)
  return count === 1 ? '1 expense' : `${count} expenses`
}

function LogForm({
  kind,
  today,
  date,
  entry,
  onDone,
}: {
  kind: Kind
  today: string
  date?: string
  entry?: LogEntry
  onDone: (message: string) => void
}) {
  const starting = entry && 'hours' in entry ? splitHours(entry.hours) : null
  const [day, setDay] = useState(entry?.date ?? date ?? today)
  const [amount, setAmount] = useState(entry && 'miles' in entry ? String(entry.miles) : entry && 'amount' in entry ? String(entry.amount) : '')
  const [hoursPart, setHoursPart] = useState(starting ? String(starting.hours) : '')
  const [minutesPart, setMinutesPart] = useState(starting ? String(starting.minutes) : '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [armed, setArmed] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    let value = Number(amount)
    if (kind === 'hours') {
      const hours = hoursPart.trim() === '' ? 0 : Number(hoursPart)
      const minutes = minutesPart.trim() === '' ? 0 : Number(minutesPart)
      if (!Number.isInteger(hours) || hours < 0 || hours > 24) {
        setProblem('Enter whole hours')
        return
      }
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
        setProblem('Minutes should be from 0 to 59')
        return
      }
      if ((hours === 0 && minutes === 0) || (hours === 24 && minutes > 0)) {
        setProblem(hours === 24 ? 'That is more than a day' : 'Enter the time')
        return
      }
      value = (hours * 60 + minutes) / 60
    } else if (kind === 'expenses') {
      if (!note.trim()) {
        setProblem('Say what it was')
        return
      }
      if (!Number.isFinite(value) || value <= 0) {
        setProblem('Enter the amount')
        return
      }
    } else if (!Number.isFinite(value) || value <= 0) {
      setProblem('Enter the miles')
      return
    }
    setBusy(true)
    setProblem('')
    try {
      if (kind === 'hours') {
        if (entry) await updateTime(entry.uid, { date: day, hours: value, note })
        else await createTime({ date: day, hours: value, note })
      } else if (kind === 'expenses') {
        if (entry) await updateExpense(entry.uid, { date: day, amount: value, note })
        else await createExpense({ date: day, amount: value, note })
      } else {
        if (entry) await updateMileage(entry.uid, { date: day, miles: value, note })
        else await createMileage({ date: day, miles: value, note })
      }
      onDone('Saved')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not save')
    } finally {
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
      if (kind === 'hours') await deleteTime(entry.uid)
      else if (kind === 'expenses') await deleteExpense(entry.uid)
      else await deleteMileage(entry.uid)
      onDone('Deleted')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not delete')
      setBusy(false)
    }
  }

  const clockedTimes = entry && 'started_at' in entry ? clockRange(entry.started_at, entry.ended_at) : ''

  return (
    <form onSubmit={save}>
      <label className="field">
        <span>Day</span>
        <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} required />
      </label>
      {clockedTimes && (
        <p className="help clocked-times">Clocked in – out: {clockedTimes}</p>
      )}
      {kind === 'hours' ? (
        <div className="hm">
          <label className="field">
            <span>Hours</span>
            <input inputMode="numeric" value={hoursPart} onChange={(e) => setHoursPart(e.target.value)} placeholder="0" autoFocus />
          </label>
          <label className="field">
            <span>Minutes</span>
            <input inputMode="numeric" value={minutesPart} onChange={(e) => setMinutesPart(e.target.value)} placeholder="0" />
          </label>
        </div>
      ) : (
        <label className="field">
          <span>{kind === 'expenses' ? 'Amount' : 'Miles'}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kind === 'expenses' ? '0.00' : '0'} autoFocus />
        </label>
      )}
      <label className="field">
        <span>{kind === 'expenses' ? 'What was it?' : 'Note'}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'hours' ? 'Optional' : kind === 'expenses' ? 'Uber back' : 'Where to?'} required={kind === 'expenses'} />
      </label>
      {problem && <p className="mismatch">{problem}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {entry && (
        <button className="danger" type="button" onClick={() => void remove()}>{armed ? 'Tap again to delete' : 'Delete'}</button>
      )}
    </form>
  )
}
