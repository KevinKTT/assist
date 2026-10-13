import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Sheet, useApp } from '../app-context'
import { IconDays } from '../icons'
import { addDays, formatMonth, formatWeek, localDate, parseISODate, sundayOnOrBefore, weekday, weekdayShort } from '../format'
import { db } from '../store/db'
import { createTask, deleteTask, updateTask } from '../store/repository'
import type { Task } from '../types'

export function DaysPage() {
  const { today, toast } = useApp()
  const [weekStart, setWeekStart] = useState(() => sundayOnOrBefore(parseISODate(today)))
  const [calOpen, setCalOpen] = useState(false)
  const [cursor, setCursor] = useState(() => new Date())
  const [sheet, setSheet] = useState<{ date: string; task?: Task } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], [] as Task[])
  const weekIso = localDate(weekStart)
  const days = Array.from({ length: 7 }, (_, i) => localDate(addDays(weekStart, i)))
  const thisWeek = localDate(sundayOnOrBefore(parseISODate(today))) === weekIso

  function shift(dir: number) {
    setWeekStart((current) => addDays(current, dir * 7))
    setCalOpen(false)
  }

  async function toggle(task: Task) {
    try {
      await updateTask(task.uid, { done: !task.done })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update')
    }
  }

  function pick(date: string) {
    setWeekStart(sundayOnOrBefore(parseISODate(date)))
    setCalOpen(false)
  }

  return (
    <main
      className="screen has-fab"
      onTouchStart={(e) => {
        const t = e.changedTouches[0]
        start.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        if (!start.current) return
        const t = e.changedTouches[0]
        const dx = t.clientX - start.current.x
        const dy = t.clientY - start.current.y
        if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.2) shift(dx < 0 ? 1 : -1)
        start.current = null
      }}
    >
      <div className="week-head">
        <button className="round" type="button" aria-label="Previous week" onClick={() => shift(-1)}>‹</button>
        <div>
          <p className="eyebrow">{thisWeek ? 'This week' : 'Week'}</p>
          <h1>{formatWeek(weekStart)}</h1>
        </div>
        <button
          className="icon-btn"
          type="button"
          aria-label="Calendar"
          onClick={() => {
            setCursor(new Date(weekStart.getFullYear(), weekStart.getMonth(), 1))
            setCalOpen((open) => !open)
          }}
        >
          <IconDays />
        </button>
      </div>
      {!thisWeek && (
        <button className="text-btn" type="button" onClick={() => setWeekStart(sundayOnOrBefore(parseISODate(today)))}>
          Back to today
        </button>
      )}
      {calOpen && (
        <Calendar
          cursor={cursor}
          weekStart={weekStart}
          today={today}
          onCursor={setCursor}
          onPick={pick}
        />
      )}
      <div className="planner">
        {days.map((date) => {
          const items = tasks.filter((task) => task.date === date)
          return (
            <section key={date} className={date === today ? 'plan-day today' : 'plan-day'}>
              <div className="plan-mark">
                <div className="wk">{weekdayShort(date)}</div>
                <div className="num">{parseISODate(date).getDate()}</div>
              </div>
              <div>
                {items.length === 0 && <p className="quiet">Nothing yet</p>}
                {items.map((task) => (
                  <div key={task.uid} className={task.done ? 'task done' : 'task'}>
                    <button
                      className={task.done ? 'check on' : 'check'}
                      type="button"
                      role="checkbox"
                      aria-checked={task.done}
                      aria-label={task.done ? `Mark not done: ${task.title}` : `Mark done: ${task.title}`}
                      onClick={() => void toggle(task)}
                    >
                      {task.done ? '✓' : ''}
                    </button>
                    <button className="task-title" type="button" onClick={() => setSheet({ date, task })}>{task.title}</button>
                  </div>
                ))}
                <button className="day-add" type="button" onClick={() => setSheet({ date })}>+ Add</button>
              </div>
            </section>
          )
        })}
      </div>
      <div className="fab">
        <button
          type="button"
          aria-label="Add a task"
          onClick={() => setSheet({ date: days.includes(today) ? today : days[0] })}
        >
          +
        </button>
      </div>
      <TaskSheet
        sheet={sheet}
        days={days}
        onClose={() => setSheet(null)}
        onDone={(message) => {
          setSheet(null)
          toast(message)
        }}
      />
    </main>
  )
}

function Calendar({
  cursor,
  weekStart,
  today,
  onCursor,
  onPick,
}: {
  cursor: Date
  weekStart: Date
  today: string
  onCursor: (next: Date) => void
  onPick: (date: string) => void
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = addDays(first, -first.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const week = localDate(weekStart)
  return (
    <div className="cal">
      <div className="cal-head">
        <button className="round" type="button" aria-label="Previous month" onClick={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button>
        <span>{formatMonth(cursor)}</span>
        <button className="round" type="button" aria-label="Next month" onClick={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => <div key={`${label}-${i}`} className="dow">{label}</div>)}
        {cells.map((day) => {
          const iso = localDate(day)
          const inWeek = iso >= week && iso <= localDate(addDays(weekStart, 6))
          const classes = [
            day.getMonth() === cursor.getMonth() ? '' : 'out',
            inWeek ? 'in-week' : '',
            iso === today ? 'is-today' : '',
          ].filter(Boolean).join(' ')
          return (
            <button key={iso} type="button" className={classes} onClick={() => onPick(iso)}>
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TaskSheet({
  sheet,
  days,
  onClose,
  onDone,
}: {
  sheet: { date: string; task?: Task } | null
  days: string[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [date, setDate] = useState(sheet?.date ?? days[0])
  const [title, setTitle] = useState(sheet?.task?.title ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!sheet) return
    setDate(sheet.date)
    setTitle(sheet.task?.title ?? '')
    setProblem('')
    setArmed(false)
    setBusy(false)
  }, [sheet])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) {
      setProblem('Add a task first')
      return
    }
    setBusy(true)
    try {
      if (sheet?.task) {
        await updateTask(sheet.task.uid, { title, date })
      } else {
        await createTask({ date, title })
      }
      onDone('Saved')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!sheet?.task) return
    if (!armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    try {
      await deleteTask(sheet.task.uid)
      onDone('Deleted')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not delete')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={sheet !== null} title={sheet?.task ? 'Edit task' : 'New task'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="chips">
          {days.map((day) => (
            <button key={day} type="button" className={date === day ? 'chip on' : 'chip'} onClick={() => setDate(day)}>
              {weekdayShort(day)} {parseISODate(day).getDate()}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{weekday(date)}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus />
        </label>
        {problem && <p className="mismatch">{problem}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {sheet?.task && (
          <button className="danger" type="button" onClick={() => void remove()}>{armed ? 'Tap again to delete' : 'Delete'}</button>
        )}
      </form>
    </Sheet>
  )
}
