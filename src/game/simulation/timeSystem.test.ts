import { describe, expect, it } from 'vitest'
import { advanceClock, formatClock, sleepUntilMorning } from './timeSystem'

describe('timeSystem', () => {
  it('advances hours within the same day', () => {
    expect(advanceClock(1, 8, 2)).toEqual({ day: 1, hour: 10 })
  })

  it('advances fractional hours', () => {
    const { day, hour } = advanceClock(1, 8, 0.25)
    expect(day).toBe(1)
    expect(hour).toBeCloseTo(8.25)
  })

  it('rolls over midnight into the next day', () => {
    expect(advanceClock(1, 23, 2)).toEqual({ day: 2, hour: 1 })
  })

  it('rolls over multiple days', () => {
    expect(advanceClock(1, 12, 48)).toEqual({ day: 3, hour: 12 })
  })

  it('sleep after 7:00 wakes at 7:00 the next day', () => {
    expect(sleepUntilMorning(1, 22)).toEqual({ day: 2, hour: 7 })
    expect(sleepUntilMorning(3, 8)).toEqual({ day: 4, hour: 7 })
  })

  it('sleep after midnight wakes at 7:00 the same day', () => {
    expect(sleepUntilMorning(2, 2)).toEqual({ day: 2, hour: 7 })
  })

  it('formats fractional hours as HH:MM', () => {
    expect(formatClock(8)).toBe('08:00')
    expect(formatClock(13.5)).toBe('13:30')
    expect(formatClock(0.25)).toBe('00:15')
  })
})
