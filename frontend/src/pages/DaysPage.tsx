import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Sheet, useApp } from '../app-context'
import { IconDays, IconGrip } from '../icons'
import { addDays, formatDay, formatMonth, formatWeek, localDate, parseISODate, sundayOnOrBefore, weekday, weekdayShort } from '../format'
import { db } from '../store/db'
import { createTask, deleteTask, reorderTasks, updateTask } from '../store/repository'
import type { Task } from '../types'

export function DaysPage() {
  const { today, toast } = useApp()
  const [weekStart, setWeekStart] = useState(() => sundayOnOrBefore(parseISODate(today)))
  const [calOpen, setCalOpen] = useState(false)
  const [cursor, setCursor] = useState(() => new Date())
  const [sheet, setSheet] = useState<{ date: string; task?: Task } | null>(null)
  const [selected, setSelected] = useState(today)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickProblem, setQuickProblem] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const grip = useRef(false)
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], [] as Task[])
  const weekIso = localDate(weekStart)
  const days = Array.from({ length: 7 }, (_, i) => localDate(addDays(weekStart, i)))
  const thisWeek = localDate(sundayOnOrBefore(parseISODate(today))) === weekIso

  // Desktop agenda shows one day at a time; keep the selection inside the
  // displayed week when navigating.
  useEffect(() => {
    if (!days.includes(selected)) setSelected(days.includes(today) ? today : days[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekIso])

  async function quickAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!quickTitle.trim()) {
      setQuickProblem('Add a task first')
      return
    }
    if (quickTitle.trim().length > 2000) {
      setQuickProblem('That task is a bit long')
      return
    }
    setQuickBusy(true)
    setQuickProblem('')
    try {
      await createTask({ date: selected, title: quickTitle })
      setQuickTitle('')
      toast('Saved')
    } catch (err) {
      setQuickProblem(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setQuickBusy(false)
    }
  }

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
    setSelected(date)
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
        // A drag starts on a task handle. Don't treat that gesture as a week swipe.
        if (grip.current) {
          start.current = null
          return
        }
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
                <TaskList
                  date={date}
                  tasks={items}
                  variant="row"
                  empty={<p className="quiet">Nothing yet</p>}
                  onToggle={(task) => void toggle(task)}
                  onEdit={(task) => setSheet({ date, task })}
                  onGrip={(active) => { grip.current = active }}
                  onError={(message) => toast(message)}
                />
                <button className="day-add" type="button" onClick={() => setSheet({ date })}>+ Add</button>
              </div>
            </section>
          )
        })}
      </div>
      <div className="agenda">
        <aside className="agenda-side" aria-label="Week">
          {days.map((date) => {
            const items = tasks.filter((task) => task.date === date)
            const done = items.filter((task) => task.done).length
            const classes = ['agenda-day', date === today ? 'today' : '', date === selected ? 'selected' : ''].filter(Boolean).join(' ')
            return (
              <button key={date} type="button" className={classes} onClick={() => setSelected(date)} aria-pressed={date === selected}>
                <span className="agenda-day-when">
                  <span className="wk">{weekdayShort(date)}</span>
                  <span className="num">{parseISODate(date).getDate()}</span>
                </span>
                <span className="agenda-day-count">
                  {items.length === 0 ? 'Nothing yet' : `${done} of ${items.length} done`}
                </span>
              </button>
            )
          })}
          {!thisWeek && (
            <button className="text-btn agenda-today" type="button" onClick={() => pick(today)}>
              Back to today
            </button>
          )}
        </aside>
        <section className="agenda-main">
          <header className="agenda-head">
            <div>
              <p className="eyebrow">{selected === today ? 'Today' : weekday(selected)}</p>
              <h2>{weekday(selected)}, {formatDay(selected)}</h2>
            </div>
            <button className="btn ghost agenda-add" type="button" onClick={() => setSheet({ date: selected })}>
              Add task
            </button>
          </header>
          <form className="quick-add" onSubmit={(e) => void quickAdd(e)}>
            <label className="field task-field">
              <span>New task for {weekday(selected)}</span>
              <textarea
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="What needs doing? Write as much as you need…"
                rows={4}
                maxLength={2000}
              />
            </label>
            {quickProblem && <p className="mismatch">{quickProblem}</p>}
            <button className="btn primary quick-add-btn" type="submit" disabled={quickBusy}>
              {quickBusy ? 'Saving…' : 'Add task'}
            </button>
          </form>
          <TaskList
            date={selected}
            tasks={tasks.filter((task) => task.date === selected)}
            variant="card"
            empty={<p className="quiet">Nothing yet for this day.</p>}
            onToggle={(task) => void toggle(task)}
            onEdit={(task) => setSheet({ date: selected, task })}
            onGrip={(active) => { grip.current = active }}
            onError={(message) => toast(message)}
          />
        </section>
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

function tasksInOrder(tasks: Task[]): Task[] {
  return tasks.slice().sort((a, b) => a.sort_order - b.sort_order || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
}

function dropIndex(rows: HTMLElement[], from: number, clientY: number): number {
  let target = from
  for (let i = 0; i < rows.length; i++) {
    if (i === from) continue
    const rect = rows[i].getBoundingClientRect()
    const mid = rect.top + rect.height / 2
    if (i < from && clientY < mid) return i
    if (i > from && clientY > mid) target = i
  }
  return target
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((uid, index) => uid === b[index])
}

function TaskList({
  date,
  tasks,
  variant,
  empty,
  onToggle,
  onEdit,
  onGrip,
  onError,
}: {
  date: string
  tasks: Task[]
  variant: 'row' | 'card'
  empty: React.ReactNode
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
  onGrip: (active: boolean) => void
  onError: (message: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ uid: string; pointerId: number; startY: number; active: boolean; origin: string[] } | null>(null)
  const orderRef = useRef<string[] | null>(null)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragUid, setDragUid] = useState<string | null>(null)
  const sorted = useMemo(() => tasksInOrder(tasks), [tasks])
  const shown = useMemo(() => {
    if (!order) return sorted
    const byUid = new Map(sorted.map((task) => [task.uid, task]))
    const rows: Task[] = []
    for (const uid of order) {
      const task = byUid.get(uid)
      if (task) rows.push(task)
    }
    for (const task of sorted) {
      if (!order.includes(task.uid)) rows.push(task)
    }
    return rows
  }, [order, sorted])
  const shownRef = useRef(shown)
  shownRef.current = shown

  useEffect(() => {
    if (dragRef.current || !orderRef.current) return
    const ids = tasksInOrder(tasks).map((task) => task.uid)
    if (sameOrder(ids, orderRef.current)) {
      orderRef.current = null
      setOrder(null)
    }
  }, [tasks])

  function clearIfSynced() {
    const pending = orderRef.current
    if (!pending || dragRef.current) return
    const ids = tasksInOrder(tasksRef.current).map((task) => task.uid)
    if (sameOrder(ids, pending)) {
      orderRef.current = null
      setOrder(null)
    }
  }

  async function save(next: string[]) {
    try {
      await reorderTasks(date, next)
      clearIfSynced()
    } catch (err) {
      orderRef.current = null
      setOrder(null)
      onError(err instanceof Error ? err.message : 'Could not reorder')
    }
  }

  function finish(commit: boolean) {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragUid(null)
    onGrip(false)
    const next = orderRef.current
    if (!commit || !drag.active || !next || sameOrder(next, drag.origin)) {
      orderRef.current = null
      setOrder(null)
      return
    }
    void save(next)
  }

  function place(uid: string, clientY: number) {
    const list = listRef.current
    if (!list) return
    const rows = [...list.querySelectorAll<HTMLElement>('[data-task]')]
    const current = rows.map((row) => row.dataset.task ?? '')
    const from = current.indexOf(uid)
    if (from < 0) return
    const target = dropIndex(rows, from, clientY)
    if (target === from) return
    const next = current.slice()
    next.splice(from, 1)
    next.splice(target, 0, uid)
    orderRef.current = next
    setOrder(next)
  }

  function move(uid: string, direction: -1 | 1) {
    if (dragRef.current) return
    const ids = shownRef.current.map((task) => task.uid)
    const from = ids.indexOf(uid)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ids.length) return
    const next = ids.slice()
    next.splice(from, 1)
    next.splice(to, 0, uid)
    orderRef.current = next
    setOrder(next)
    void save(next)
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!drag.active) {
      if (Math.abs(event.clientY - drag.startY) < 5) return
      drag.active = true
      setDragUid(drag.uid)
    }
    event.preventDefault()
    place(drag.uid, event.clientY)
  }

  return (
    <div
      className={variant === 'card' ? 'agenda-tasks' : undefined}
      ref={listRef}
      style={dragUid ? { touchAction: 'none' } : undefined}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) finish(true)
      }}
      onPointerCancel={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) finish(false)
      }}
    >
      {shown.length === 0 && empty}
      {shown.map((task) => {
        const titleClass = variant === 'card' ? 'task-card-title' : 'task-title'
        const rowClass = [
          variant === 'card' ? 'task-card' : 'task',
          task.done ? 'done' : '',
          dragUid === task.uid ? 'dragging' : '',
        ].filter(Boolean).join(' ')
        const label = task.title.replace(/\s+/g, ' ')
        return (
          <div key={task.uid} className={rowClass} data-task={task.uid}>
            <button
              className={task.done ? 'check on' : 'check'}
              type="button"
              role="checkbox"
              aria-checked={task.done}
              aria-label={task.done ? `Mark not done: ${label}` : `Mark done: ${label}`}
              onClick={() => onToggle(task)}
            >
              {task.done ? '✓' : ''}
            </button>
            <button className={titleClass} type="button" onClick={() => onEdit(task)}>{task.title}</button>
            <button
              className="grip"
              type="button"
              aria-label={`Reorder ${label}`}
              aria-keyshortcuts="ArrowUp ArrowDown"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                onGrip(true)
                dragRef.current = {
                  uid: task.uid,
                  pointerId: event.pointerId,
                  startY: event.clientY,
                  active: false,
                  origin: shownRef.current.map((item) => item.uid),
                }
                // Capture on the list, which stays put while the rows reorder.
                listRef.current?.setPointerCapture(event.pointerId)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                move(task.uid, event.key === 'ArrowUp' ? -1 : 1)
              }}
            >
              <IconGrip />
            </button>
          </div>
        )
      })}
    </div>
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
    if (title.trim().length > 2000) {
      setProblem('That task is a bit long')
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
        <label className="field task-field">
          <span>{weekday(date)}</span>
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing? Write as much as you need…"
            autoFocus
            rows={6}
            maxLength={2000}
          />
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
