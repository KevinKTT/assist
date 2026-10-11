const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function localDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

export function sundayOnOrBefore(d: Date): Date {
  return addDays(d, -d.getDay())
}

export function weekday(iso: string): string {
  return DAYS[parseISODate(iso).getDay()]
}

export function weekdayShort(iso: string): string {
  return SHORT[parseISODate(iso).getDay()]
}

export function dayNumber(iso: string): number {
  return parseISODate(iso).getDate()
}

export function formatDay(iso: string): string {
  const d = parseISODate(iso)
  const year = d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : ''
  return `${MON[d.getMonth()]} ${d.getDate()}${year}`
}

export function formatPeriod(start: string, end: string): string {
  const a = parseISODate(start)
  const b = parseISODate(end)
  const showYear = a.getFullYear() !== new Date().getFullYear() || a.getFullYear() !== b.getFullYear()
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    const year = showYear ? `, ${a.getFullYear()}` : ''
    return `${MON[a.getMonth()]} ${a.getDate()} – ${b.getDate()}${year}`
  }
  return `${formatDay(start)} – ${formatDay(end)}`
}

export function formatWeek(start: Date): string {
  const end = addDays(start, 6)
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const year = start.getFullYear() !== new Date().getFullYear() ? ` ${start.getFullYear()}` : ''
    return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}${year}`
  }
  return `${MON[start.getMonth()]} ${start.getDate()} – ${MON[end.getMonth()]} ${end.getDate()}`
}

export function formatMonth(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function rateText(n: number, unit: string): string {
  const s = n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
  return `${s} / ${unit}`
}

export function splitHours(n: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(n * 60 + 1e-6))
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

export function hoursText(n: number): string {
  const { hours, minutes } = splitHours(n)
  if (hours === 0) return `${minutes} min`
  const label = hours === 1 ? '1 hr' : `${hours} hrs`
  if (minutes === 0) return label
  return `${label} ${minutes} min`
}

export function milesText(n: number): string {
  return `${Number(n.toFixed(2))} mi`
}

export function clock(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

export function clockFace(d: Date): string {
  const h24 = d.getHours()
  const hour = h24 % 12 || 12
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${hour}:${minute} ${h24 >= 12 ? 'PM' : 'AM'}`
}
