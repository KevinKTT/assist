import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { Sheet, useApp } from '../app-context'
import { clock, clockFace, dayNumber, formatDay, formatPeriod, hoursText, localDate, milesText, money, rateText, splitHours, weekday, weekdayShort } from '../format'
import type { HistoryMonth, HistoryPeriod, Kind, MileageEntry, PeriodDetail, Running, Settings, TimeEntry } from '../types'

type SheetState =
  | null
  | { type: 'add'; date: string }
  | { type: 'time'; entry: TimeEntry }
  | { type: 'mile'; entry: MileageEntry }

export function HoursPage() {
  return <LogPage kind="hours" />
}

export function MilesPage() {
  return <LogPage kind="mileage" />
}

function LogPage({ kind }: { kind: Kind }) {
  const { today, settings, revision, toast, bump, openSettings } = useApp()
  const [start, setStart] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodDetail | null>(null)
  const [view, setView] = useState<'today' | 'period' | 'history'>('today')
  const [history, setHistory] = useState<HistoryMonth[] | null>(null)
  const [drill, setDrill] = useState<PeriodDetail | null>(null)
  const [running, setRunning] = useState<Running | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState<SheetState>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const params = new URLSearchParams({ today })
    if (start) params.set('start', start)
    api<PeriodDetail>(`/api/periods?${params}`)
      .then((data) => {
        if (!live) return
        setPeriod(data)
        setError('')
      })
      .catch((err: Error) => {
        if (live) setError(err.message)
      })
    return () => {
      live = false
    }
  }, [today, start, revision])

  useEffect(() => {
    if (kind !== 'hours') return
    let live = true
    api<{ running: Running | null }>('/api/time/running')
      .then((data) => {
        if (live) setRunning(data.running)
      })
      .catch(() => {
        if (live) setRunning(null)
      })
    return () => {
      live = false
    }
  }, [kind, revision])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  useEffect(() => {
    if (view !== 'history') return
    let live = true
    api<HistoryMonth[]>(`/api/history?today=${today}`)
      .then((data) => {
        if (live) setHistory(data)
      })
      .catch((err: Error) => {
        if (live) toast(err.message)
      })
    return () => {
      live = false
    }
  }, [view, today, revision, toast])

  async function startTimer() {
    try {
      setRunning(await api<Running>('/api/time/start', {
        method: 'POST',
        body: JSON.stringify({ work_date: today, started_at: new Date().toISOString() }),
      }))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start')
    }
  }

  async function stopTimer() {
    try {
      const result = await api<{ discarded: boolean; entry: TimeEntry | null }>('/api/time/stop', {
        method: 'POST',
        body: JSON.stringify({ ended_at: new Date().toISOString() }),
      })
      setRunning(null)
      if (result.discarded) toast('That was too short to save')
      else if (result.entry && result.entry.hours > 16) toast('That was a long clock-in. Tap it if the hours need a fix.')
      else toast('Hours saved')
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not stop')
    }
  }

  async function openHistory(item: HistoryPeriod) {
    try {
      const params = new URLSearchParams({ today, start: item.start, end: item.end })
      setDrill(await api<PeriodDetail>(`/api/periods?${params}`))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open that period')
    }
  }

  const shown = view === 'history' && drill ? drill : period
  const title = kind === 'hours' ? 'Hours' : 'Miles'

  return (
    <main className="screen">
      <h1>{title}</h1>
      {kind === 'hours' && settings && settings.hourly_rate <= 0 && (
        <button className="nudge" type="button" onClick={openSettings}>Add an hourly rate to see what this period will pay.</button>
      )}
      {kind === 'mileage' && settings && settings.mileage_rate <= 0 && (
        <button className="nudge" type="button" onClick={openSettings}>Add a per-mile rate to see the reimbursement.</button>
      )}
      {kind === 'hours' && running && (
        <RunningTimer
          running={running}
          now={now}
          today={today}
          onStop={() => void stopTimer()}
          onAdjusted={setRunning}
          toast={toast}
        />
      )}
      <div className="segment thirds">
        <button type="button" className={view === 'today' ? 'on' : ''} onClick={() => { setView('today'); setDrill(null); setStart(null) }}>Today</button>
        <button type="button" className={view === 'period' ? 'on' : ''} onClick={() => { setView('period'); setDrill(null); setStart(null) }}>This period</button>
        <button type="button" className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>History</button>
      </div>
      {view === 'history' && !drill && (
        <HistoryList months={history} kind={kind} onOpen={(item) => void openHistory(item)} />
      )}
      {view === 'history' && drill && (
        <button className="back" type="button" onClick={() => setDrill(null)}>Back to history</button>
      )}
      {view === 'today' && period && settings && (
        <TodayCard
          period={period}
          kind={kind}
          today={today}
          showTimer={kind === 'hours' && !running}
          onAdd={() => setSheet({ type: 'add', date: today })}
          onStart={() => void startTimer()}
          onEdit={(entry) => {
            if ('hours' in entry) setSheet({ type: 'time', entry })
            else setSheet({ type: 'mile', entry })
          }}
        />
      )}
      {view === 'period' && period && settings && (
        <>
          <PeriodCard period={period} kind={kind} settings={settings} />
          <DayList
            period={period}
            kind={kind}
            today={today}
            onAdd={(date) => setSheet({ type: 'add', date: date > today ? today : date })}
            onEdit={(entry) => {
              if ('hours' in entry) setSheet({ type: 'time', entry })
              else setSheet({ type: 'mile', entry })
            }}
          />
        </>
      )}
      {view === 'history' && drill && shown && settings && (
        <>
          <PeriodCard period={shown} kind={kind} settings={settings} />
          <DayList
            period={shown}
            kind={kind}
            today={today}
            onAdd={(date) => setSheet({ type: 'add', date })}
            onEdit={(entry) => {
              if ('hours' in entry) setSheet({ type: 'time', entry })
              else setSheet({ type: 'mile', entry })
            }}
          />
        </>
      )}
      {(view === 'today' || view === 'period') && !period && !error && <div className="skeleton" />}
      {(view === 'today' || view === 'period') && error && !period && (
        <div className="card">
          <p>{error}</p>
          <button className="btn blush" type="button" onClick={bump}>Try again</button>
        </div>
      )}
      <EntrySheet
        sheet={sheet}
        kind={kind}
        today={today}
        onClose={() => setSheet(null)}
        onDone={(message) => {
          setSheet(null)
          toast(message)
          bump()
          if (drill) void openHistory(drill)
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
  onAdjusted,
  toast,
}: {
  running: Running
  now: number
  today: string
  onStop: () => void
  onAdjusted: (next: Running) => void
  toast: (message: string) => void
}) {
  const [localStart, setLocalStart] = useState(running.started_at)
  const [picked, setPicked] = useState(() => minutesBack(running.created_at, running.started_at))
  const startRef = useRef(running.started_at)
  const pickedRef = useRef(picked)
  const createdRef = useRef(running.created_at)
  const wheelRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | null>(null)
  const tail = useRef<Promise<void>>(Promise.resolve())
  createdRef.current = running.created_at

  const rows = useMemo(() => {
    const created = new Date(running.created_at)
    const tapDay = localDate(created)
    return WHEEL_BACK.map((mins) => {
      const when = new Date(created.getTime() - mins * 60_000)
      const day = localDate(when)
      const face = clockFace(when)
      return day === tapDay ? face : `${weekdayShort(day)} ${face}`
    })
  }, [running.created_at])

  useLayoutEffect(() => {
    const mins = minutesBack(running.created_at, startRef.current)
    pickedRef.current = mins
    setPicked(mins)
    if (wheelRef.current) wheelRef.current.scrollTop = mins * WHEEL_ITEM
  }, [running.id, running.created_at])

  useEffect(() => {
    return () => {
      if (!saveTimer.current) return
      window.clearTimeout(saveTimer.current)
      const iso = startRef.current
      void api('/api/time/running', {
        method: 'PATCH',
        body: JSON.stringify({ started_at: iso, work_date: localDate(new Date(iso)) }),
      })
    }
  }, [])

  function persist(iso: string) {
    const run = tail.current.then(async () => {
      try {
        onAdjusted(await api<Running>('/api/time/running', {
          method: 'PATCH',
          body: JSON.stringify({ started_at: iso, work_date: localDate(new Date(iso)) }),
        }))
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
          <div className="timer-start">
            Started {clockFace(started)}
            {day !== today && ` · ${formatDay(day)}`}
          </div>
        </div>
        <button className="btn blush" type="button" onClick={() => void clockOut()}>Clock out</button>
      </div>
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
  onEdit: (entry: TimeEntry | MileageEntry) => void
}) {
  const day = period.days.find((item) => item.date === today)
  const figure = kind === 'hours' ? hoursText(day?.hours ?? 0) : milesText(day?.miles ?? 0)
  const entries = kind === 'hours' ? day?.time_entries ?? [] : day?.mileage_entries ?? []
  return (
    <section className="card">
      <p className="eyebrow">{weekday(today)} · {formatDay(today)}</p>
      <div className="today-figure">{figure}</div>
      <div className="card-actions">
        {showTimer && <button className="btn blush wide" type="button" onClick={onStart}>Clock in</button>}
        <button className="btn ghost" type="button" onClick={onAdd}>{kind === 'hours' ? 'Add hours' : 'Add miles'}</button>
      </div>
      {entries.length === 0 && <p className="quiet">Nothing logged today</p>}
      {entries.map((entry) => (
        <button key={entry.id} className="entry today-entry" type="button" onClick={() => onEdit(entry)}>
          <span>{'hours' in entry ? hoursText(entry.hours) : milesText(entry.miles)}</span>
          {'source' in entry && entry.source === 'timer' && <em>clocked</em>}
          {entry.note ? <span className="entry-note">{entry.note}</span> : <span className="entry-note" />}
        </button>
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
  const live = kind === 'hours' ? period.hours_pay : period.mileage_pay
  return (
    <section className="card">
      <p className="eyebrow">{formatPeriod(period.start, period.end)}</p>
      <div className="money">{money(live)}</div>
      <p className="sub">
        {kind === 'hours' ? hoursText(period.hours) : milesText(period.miles)} · {rateLine(period, kind, settings)}
      </p>
    </section>
  )
}

function rateLine(period: PeriodDetail, kind: Kind, settings: Settings) {
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
  onEdit: (entry: TimeEntry | MileageEntry) => void
}) {
  return (
    <div>
      {period.days.map((day) => {
        const entries = kind === 'hours' ? day.time_entries : day.mileage_entries
        const empty = entries.length === 0
        const qty = kind === 'hours' ? hoursText(day.hours) : milesText(day.miles)
        const pay = kind === 'hours' ? day.hours_pay : day.mileage_pay
        const classes = ['dayblock', day.date === today ? 'today' : '', empty ? 'empty' : ''].filter(Boolean).join(' ')
        return (
          <section key={day.date} className={classes}>
            <div className="dayline">
              <div className="daywhen">
                <span>{weekdayShort(day.date)}</span>
                <strong>{dayNumber(day.date)}</strong>
              </div>
              <div className="daytotal">{empty ? '—' : `${qty} · ${money(pay)}`}</div>
              {day.date <= today ? (
                <button className="mini-plus" type="button" aria-label={`Add for ${formatDay(day.date)}`} onClick={() => onAdd(day.date)}>+</button>
              ) : <span />}
            </div>
            {entries.map((entry) => (
              <button key={entry.id} className="entry" type="button" onClick={() => onEdit(entry)}>
                <span>{'hours' in entry ? hoursText(entry.hours) : milesText(entry.miles)}</span>
                {'source' in entry && entry.source === 'timer' && <em>clocked</em>}
                {entry.note ? <span className="entry-note">{entry.note}</span> : <span className="entry-note" />}
                <span className="entry-pay">{money(entry.pay)}</span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function HistoryList({
  months,
  kind,
  onOpen,
}: {
  months: HistoryMonth[] | null
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
              </div>
              <div className="badges">
                <span className={item.hours_payout ? 'badge paid' : 'badge'}>{item.hours_payout ? 'Hours paid' : 'Hours open'}</span>
                <span className={item.mileage_payout ? 'badge paid' : 'badge'}>{item.mileage_payout ? 'Miles paid' : 'Miles open'}</span>
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
    </Sheet>
  )
}

function sheetTitle(sheet: SheetState, kind: Kind) {
  if (!sheet) return ''
  if (sheet.type === 'add') return kind === 'hours' ? 'Add hours' : 'Add miles'
  return kind === 'hours' ? 'Edit hours' : 'Edit drive'
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
  entry?: TimeEntry | MileageEntry
  onDone: (message: string) => void
}) {
  const starting = entry && 'hours' in entry ? splitHours(entry.hours) : null
  const [day, setDay] = useState(entry?.date ?? date ?? today)
  const [amount, setAmount] = useState(entry && 'miles' in entry ? String(entry.miles) : '')
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
    } else if (!Number.isFinite(value) || value <= 0) {
      setProblem('Enter the miles')
      return
    }
    setBusy(true)
    setProblem('')
    try {
      if (kind === 'hours') {
        const body = { work_date: day, hours: value, note }
        if (entry) await api(`/api/time/${entry.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        else await api('/api/time', { method: 'POST', body: JSON.stringify(body) })
      } else {
        const body = { drive_date: day, miles: value, note }
        if (entry) await api(`/api/mileage/${entry.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        else await api('/api/mileage', { method: 'POST', body: JSON.stringify(body) })
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
      await api(kind === 'hours' ? `/api/time/${entry.id}` : `/api/mileage/${entry.id}`, { method: 'DELETE' })
      onDone('Deleted')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not delete')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save}>
      <label className="field">
        <span>Day</span>
        <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} required />
      </label>
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
          <span>Miles</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
        </label>
      )}
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'hours' ? 'Optional' : 'Where to?'} />
      </label>
      {problem && <p className="mismatch">{problem}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {entry && (
        <button className="danger" type="button" onClick={() => void remove()}>{armed ? 'Tap again to delete' : 'Delete'}</button>
      )}
    </form>
  )
}


