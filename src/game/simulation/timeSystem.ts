/**
 * In-game clock. By default 1 real minute = 1 in-game hour
 * (HOURS_PER_REAL_SECOND = 1/60), scaled by the store's `timeScale`.
 */
export const HOURS_PER_REAL_SECOND = 1 / 60

export interface ClockState {
  day: number
  hour: number
}

export function advanceClock(day: number, hour: number, dtHours: number): ClockState {
  let h = hour + dtHours
  let d = day
  while (h >= 24) {
    h -= 24
    d += 1
  }
  while (h < 0) {
    h += 24
    d -= 1
  }
  return { day: d, hour: h }
}

/** Sleep always wakes the player at 07:00. Sleeping after midnight stays on the same day. */
export function sleepUntilMorning(day: number, hour: number): ClockState {
  if (hour >= 7) return { day: day + 1, hour: 7 }
  return { day, hour: 7 }
}

export function formatClock(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.floor((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
