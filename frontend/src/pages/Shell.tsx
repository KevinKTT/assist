import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../app-context'
import { IconCar, IconChart, IconClock, IconDays, IconGear, IconReceipt, Logo } from '../icons'

export function Shell() {
  const { settings, error, refresh, openSettings } = useApp()
  if (!settings) {
    return (
      <div className="boot">
        <div>
          <Logo className="logo" />
          <p className="wordmark">assist</p>
          {error && (
            <>
              <p className="muted">{error}</p>
              <button className="btn blush" type="button" onClick={() => void refresh()}>Try again</button>
            </>
          )}
        </div>
      </div>
    )
  }
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
