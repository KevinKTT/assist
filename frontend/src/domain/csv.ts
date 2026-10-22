import { duration } from './money'
import type { buildReport } from './summary'

// Mirrors backend/app/csv_export.py so reports export while offline.

type Report = ReturnType<typeof buildReport>

function csvSafe(value: string): string {
  if (value && '=+-@'.includes(value[0])) return `'${value}`
  return value
}

function field(value: string | number): string {
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function row(values: (string | number)[]): string {
  return values.map(field).join(',') + '\r\n'
}

export function renderCsv(report: Report): string {
  const lines: string[] = []
  lines.push(row(['assist']))
  lines.push(row(['Name', csvSafe(report.name)]))
  lines.push(row(['From', report.start]))
  lines.push(row(['To', report.end]))
  lines.push(row(['Prepared', report.prepared]))
  lines.push(row(['Hours', duration(report.hours)]))
  lines.push(row(['Hours pay', report.hours_pay.toFixed(2)]))
  lines.push(row(['Miles', report.miles.toFixed(2)]))
  lines.push(row(['Mileage pay', report.mileage_pay.toFixed(2)]))
  lines.push(row(['Expenses', report.expenses.toFixed(2)]))
  lines.push(row(['Combined', report.combined.toFixed(2)]))
  lines.push(row(['Tasks completed', report.tasks_done]))
  lines.push(row(['Tasks open', report.tasks_open]))
  lines.push(row([]))
  lines.push(row(['Hours']))
  lines.push(row(['Date', 'Time', 'Hours', 'Rate', 'Pay', 'Note', 'Source']))
  for (const entry of report.time_entries) {
    lines.push(row([entry.date, duration(entry.hours), entry.hours.toFixed(2), entry.rate.toFixed(2), entry.pay.toFixed(2), csvSafe(entry.note), entry.source]))
  }
  lines.push(row([]))
  lines.push(row(['Miles']))
  lines.push(row(['Date', 'Miles', 'Rate', 'Pay', 'Note']))
  for (const entry of report.mileage_entries) {
    lines.push(row([entry.date, entry.miles.toFixed(2), entry.rate.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''), entry.pay.toFixed(2), csvSafe(entry.note)]))
  }
  lines.push(row([]))
  lines.push(row(['Expenses']))
  lines.push(row(['Date', 'Amount', 'Note']))
  for (const entry of report.expense_entries) {
    lines.push(row([entry.date, entry.amount.toFixed(2), csvSafe(entry.note)]))
  }
  lines.push(row([]))
  lines.push(row(['Tasks']))
  lines.push(row(['Date', 'Title', 'Status', 'Completed at']))
  for (const task of report.tasks) {
    lines.push(row([task.date, csvSafe(task.title), task.done ? 'done' : 'open', task.done_at ?? '']))
  }
  lines.push(row([]))
  lines.push(row(['Received']))
  lines.push(row(['Paid on', 'Kind', 'Period start', 'Period end', 'Amount', 'Note']))
  for (const payout of report.payouts) {
    lines.push(row([payout.paid_on, payout.kind, payout.period_start, payout.period_end, payout.amount.toFixed(2), csvSafe(payout.note)]))
  }
  return '\ufeff' + lines.join('')
}

export function downloadCsv(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
