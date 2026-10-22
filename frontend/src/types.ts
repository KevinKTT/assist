export type Cycle = 'weekly' | 'biweekly' | 'monthly'

export type Settings = {
  display_name: string
  hourly_rate: number
  mileage_rate: number
  cycle: Cycle
  cycle_anchor: string
  payday_offset_days: number | null
}

export type Payout = {
  id: number
  uid: string
  kind: 'hours' | 'mileage' | 'expenses'
  period_start: string
  period_end: string
  amount: number
  paid_on: string
  note: string
}

export type TimeEntry = {
  id: number
  uid: string
  date: string
  hours: number
  rate: number
  pay: number
  note: string
  source: 'timer' | 'manual'
  started_at: string | null
  ended_at: string | null
}

export type MileageEntry = {
  id: number
  uid: string
  date: string
  miles: number
  rate: number
  pay: number
  note: string
}

export type ExpenseEntry = {
  id: number
  uid: string
  date: string
  amount: number
  note: string
}

export type PeriodDay = {
  date: string
  hours: number
  hours_pay: number
  miles: number
  mileage_pay: number
  expenses: number
  time_entries: TimeEntry[]
  mileage_entries: MileageEntry[]
  expense_entries: ExpenseEntry[]
}

export type PeriodDetail = {
  start: string
  end: string
  cycle: Cycle
  is_current: boolean
  prev_start: string | null
  next_start: string | null
  hours: number
  hours_pay: number
  miles: number
  mileage_pay: number
  expenses: number
  combined: number
  mixed_hour_rates: boolean
  mixed_mile_rates: boolean
  payday: string | null
  hours_payout: Payout | null
  mileage_payout: Payout | null
  expenses_payout: Payout | null
  recorded_only: boolean
  days: PeriodDay[]
}

export type HistoryPeriod = Omit<PeriodDetail, 'days'>

export type HistoryMonth = {
  month: string
  label: string
  received: number
  periods: HistoryPeriod[]
}

export type Task = {
  id: number
  uid: string
  date: string
  title: string
  done: boolean
  done_at: string | null
  sort_order: number
}

export type SeriesPoint = {
  date: string
  hours: number
  miles: number
}

export type Dashboard = {
  period: {
    start: string
    end: string
    hours: number
    hours_pay: number
    miles: number
    mileage_pay: number
    expenses: number
    combined: number
    days_worked: number
    hours_payout: Payout | null
    mileage_payout: Payout | null
    expenses_payout: Payout | null
    payday: string | null
  }
  week: {
    start: string
    end: string
    tasks_done: number
    tasks_open: number
  }
  today: {
    date: string
    hours: number
    miles: number
    tasks_open: number
  }
  month_received: number
  range: {
    start: string
    end: string
    hours: number
    hours_pay: number
    miles: number
    mileage_pay: number
    expenses: number
    combined: number
    tasks_done: number
    tasks_open: number
    expense_entries: ExpenseEntry[]
    series: SeriesPoint[]
  }
}

export type Running = {
  id: number
  uid: string
  date: string
  started_at: string
  created_at: string
  note: string
}

export type Kind = 'hours' | 'mileage' | 'expenses'
