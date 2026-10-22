import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../app-context'
import { IconCar, IconChart, IconClock, IconDays, IconGear, IconReceipt, Logo } from '../icons'
import type { SyncState } from '../store/sync'

export function Shell() {
  const { sync, syncNow, openSettings } = useApp()
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Logo className="brand-logo" />
          <p className="wordmark">assist</p>
        </div>
        <button className="icon-btn" type="button" aria-label="Settings" onClick={openSettings}>
          <IconGear />
        </button>
      </header>
      <SyncBanner sync={sync} onRetry={syncNow} />
      <Outlet />
      <nav className="tabbar" aria-label="Primary">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span className="ico"><IconClock /></span>
          Hours
        </NavLink>
        <NavLink to="/miles" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span className="ico"><IconCar /></span>
          Miles
        </NavLink>
        <NavLink to="/expenses" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span className="ico"><IconReceipt /></span>
          Expense
        </NavLink>
        <NavLink to="/days" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span className="ico"><IconDays /></span>
          To Do
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span className="ico"><IconChart /></span>
          Reports
        </NavLink>
      </nav>
    </div>
  )
}

function SyncBanner({ sync, onRetry }: { sync: SyncState; onRetry: () => void }) {
  if (sync.status === 'offline') {
    return (
      <button className="syncbar offline" type="button" onClick={onRetry}>
        <span>
          Offline. Everything you add is saved on this device and will sync when you're back.
        </span>
        <span className="syncbar-action">Retry</span>
      </button>
    )
  }
  if (sync.status === 'pending') {
    return (
      <button className="syncbar pending" type="button" onClick={onRetry}>
        <span>{sync.message ?? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to sync. It is saved on this device — open it to fix or retry.`}</span>
        <span className="syncbar-action">Sync now</span>
      </button>
    )
  }
  // Background syncs (every 30s, on returning to the app, after a save) are
  // silent: showing a "Syncing…" banner each time made the screen pulse and
  // shift. Only offline / waiting / rejected states are surfaced.
  return null
}
