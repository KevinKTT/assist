import { describe, expect, it } from 'vitest'
import { mondayOnOrBefore, parseISODate, workdayAverage } from './format'

describe('mondayOnOrBefore', () => {
  it('keeps a Monday and walks other days back to it', () => {
    expect(mondayOnOrBefore(parseISODate('2026-03-09'))).toEqual(parseISODate('2026-03-09'))
    expect(mondayOnOrBefore(parseISODate('2026-03-10'))).toEqual(parseISODate('2026-03-09'))
    expect(mondayOnOrBefore(parseISODate('2026-03-15'))).toEqual(parseISODate('2026-03-09'))
    expect(mondayOnOrBefore(parseISODate('2026-10-24'))).toEqual(parseISODate('2026-10-19'))
  })
})

describe('workdayAverage', () => {
  it('averages hours across days that have hours', () => {
    expect(workdayAverage(9, 2)).toBe('4 hrs 30 min')
    expect(workdayAverage(8, 1)).toBe('8 hrs')
  })

  it('stays empty when nobody worked', () => {
    expect(workdayAverage(0, 0)).toBe('None yet')
  })
})
