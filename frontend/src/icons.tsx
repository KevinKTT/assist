type IconProps = { className?: string }

export function Logo({ className }: IconProps) {
  return <img className={className} src="/logo.png" alt="" />
}

export function IconGear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h16M4 16h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="8" r="2.3" fill="#FFF6EE" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="15" cy="16" r="2.3" fill="#FFF6EE" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function IconClock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4.5l2.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconCar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 16h16v-2.2l-1.6-4.2A2 2 0 0 0 16.5 8h-9a2 2 0 0 0-1.9 1.6L4 13.8V16Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="7.5" cy="16.2" r="1.3" fill="currentColor" />
      <circle cx="16.5" cy="16.2" r="1.3" fill="currentColor" />
    </svg>
  )
}

export function IconDays() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3.8v3M16 3.8v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconChart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V9M12 19V5M19 19v-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
