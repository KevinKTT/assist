import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import type { Settings } from './types'
import { localDate } from './format'

type AppContextValue = {
  today: string
  settings: Settings | null
  error: string | null
  revision: number
  openSettings: () => void
  toast: (message: string) => void
  bump: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AppContextValue | null>(null)

export function useApp() {
  const value = useContext(Ctx)
  if (!value) throw new Error('useApp')
  return value
}

function useToday() {
  const [today, setToday] = useState(localDate)
  useEffect(() => {
    const tick = () => setToday(localDate())
    const id = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return today
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const today = useToday()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const toastTimer = useRef<number | null>(null)
  const bump = useCallback(() => setRevision((n) => n + 1), [])
  const toast = useCallback((next: string) => {
    setMessage(next)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setMessage(null), 2800)
  }, [])
  const refresh = useCallback(async () => {
    try {
      setSettings(await api<Settings>(`/api/settings?today=${today}`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Can't reach assist")
    }
  }, [today])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') bump()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [bump])

  const value = useMemo(
    () => ({
      today,
      settings,
      error,
      revision,
      openSettings: () => setSettingsOpen(true),
      toast,
      bump,
      refresh,
    }),
    [today, settings, error, revision, toast, bump, refresh],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      {settings && (
        <SettingsSheet
          open={settingsOpen}
          settings={settings}
          today={today}
          onClose={() => setSettingsOpen(false)}
          onSaved={async () => {
            await refresh()
            bump()
            toast('Saved')
            setSettingsOpen(false)
          }}
        />
      )}
      {message && <div className="toast" role="status">{message}</div>}
    </Ctx.Provider>
  )
}

function SettingsSheet({
  open,
  settings,
  today,
  onClose,
  onSaved,
}: {
  open: boolean
  settings: Settings
  today: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(settings.display_name)
  const [hourly, setHourly] = useState(String(settings.hourly_rate || ''))
  const [mileage, setMileage] = useState(String(settings.mileage_rate || ''))
  const [cycle, setCycle] = useState(settings.cycle)
  const [anchor, setAnchor] = useState(settings.cycle_anchor)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    if (!open) return
    setName(settings.display_name)
    setHourly(settings.hourly_rate ? String(settings.hourly_rate) : '')
    setMileage(settings.mileage_rate ? String(settings.mileage_rate) : '')
    setCycle(settings.cycle)
    setAnchor(settings.cycle_anchor)
    setProblem('')
    setBusy(false)
  }, [open, settings])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const hourlyRate = hourly.trim() === '' ? 0 : Number(hourly)
    const mileageRate = mileage.trim() === '' ? 0 : Number(mileage)
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0 || !Number.isFinite(mileageRate) || mileageRate < 0) {
      setProblem('Enter rates as numbers')
      return
    }
    setBusy(true)
    setProblem('')
    try {
      await api('/api/settings?today=' + today, {
        method: 'PUT',
        body: JSON.stringify({
          display_name: name,
          hourly_rate: hourlyRate,
          mileage_rate: mileageRate,
          cycle,
          cycle_anchor: anchor,
          payday_offset_days: null,
        }),
      })
      await onSaved()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <form onSubmit={save}>
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="For reports" autoComplete="name" />
        </label>
        <label className="field">
          <span>Hourly rate</span>
          <input inputMode="decimal" value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="0.00" />
        </label>
        <label className="field">
          <span>Per mile</span>
          <input inputMode="decimal" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="0.00" />
        </label>
        <div className="chips" role="group" aria-label="Pay cycle">
          {([
            ['weekly', 'Weekly'],
            ['biweekly', 'Every 2 weeks'],
            ['monthly', 'Monthly'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={cycle === value ? 'chip on' : 'chip'} onClick={() => setCycle(value)}>
              {label}
            </button>
          ))}
        </div>
        {cycle !== 'monthly' && (
          <label className="field">
            <span>Current period started</span>
            <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} required />
          </label>
        )}
        <p className="help">This sets where each pay period begins. Saved payouts stay as you recorded them.</p>
        {problem && <p className="mismatch">{problem}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  )
}

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    document.body.classList.add('sheet-open')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('sheet-open')
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!open) return null
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="handle" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </>
  )
}
