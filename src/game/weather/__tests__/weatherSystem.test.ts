import { describe, expect, it } from 'vitest'
import {
  createWeatherRuntime,
  getBlendedModifiers,
  getScheduledWeather,
  isRaining,
  requestWeather,
  snapWeatherForPause,
  stepWeather,
  TRANSITION_SECONDS,
} from '../weatherSystem'
import { isWeatherKind, WEATHER_KINDS, WEATHER_MODIFIERS } from '../weatherTypes'
import { getNearestShelter, PUDDLES, SHELTER_POINTS, WEATHER_FLAVOR } from '../weatherData'
import { getWeatherBadge, getWeatherFlavor } from '../weatherSelectors'

describe('getScheduledWeather', () => {
  it('keeps day 1 fully clear regardless of hour and seed', () => {
    for (const hour of [0, 5, 11, 17, 23]) {
      for (const seed of [1, 7, 42]) {
        expect(getScheduledWeather(1, hour, seed)).toBe('clear')
      }
    }
  })

  it('is deterministic and always returns a valid kind', () => {
    for (let day = 2; day <= 30; day++) {
      for (const hour of [2, 8, 14, 20]) {
        const a = getScheduledWeather(day, hour, 7)
        expect(a).toBe(getScheduledWeather(day, hour, 7))
        expect(isWeatherKind(a)).toBe(true)
      }
    }
  })

  it('is stable within a 6-hour slot', () => {
    expect(getScheduledWeather(3, 6, 7)).toBe(getScheduledWeather(3, 11.9, 7))
    expect(getScheduledWeather(3, 12, 7)).toBe(getScheduledWeather(3, 17.9, 7))
  })

  it('produces every weather kind across enough days', () => {
    const seen = new Set<string>()
    for (let day = 2; day <= 120; day++) {
      for (const hour of [2, 8, 14, 20]) seen.add(getScheduledWeather(day, hour, 7))
    }
    for (const kind of WEATHER_KINDS) expect(seen.has(kind)).toBe(true)
  })
})

describe('requestWeather', () => {
  it('instant requests settle everything at once', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'rain', { instant: true })
    expect(rt.kind).toBe('rain')
    expect(rt.targetKind).toBe('rain')
    expect(rt.transition).toBe(1)
    expect(rt.wetness).toBe(WEATHER_MODIFIERS.rain.targetWetness)
  })

  it('smooth requests start a crossfade toward the new kind', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'cloudy')
    expect(rt.kind).toBe('clear')
    expect(rt.targetKind).toBe('cloudy')
    expect(rt.transition).toBe(0)
  })

  it('manual flag marks the override', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'foggy', { manual: true })
    expect(rt.manualOverride).toBe(true)
  })
})

describe('stepWeather', () => {
  const clock = { day: 1, hour: 10 }

  it('completes a crossfade after TRANSITION_SECONDS', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'rain')
    stepWeather(rt, TRANSITION_SECONDS / 2, clock)
    expect(rt.transition).toBeGreaterThan(0.4)
    expect(rt.transition).toBeLessThan(1)
    stepWeather(rt, TRANSITION_SECONDS, clock)
    expect(rt.transition).toBe(1)
    expect(rt.kind).toBe('rain')
  })

  it('wetness rises in rain and drains slower after it clears', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'rain', { instant: true })
    rt.wetness = 0
    for (let i = 0; i < 60; i++) stepWeather(rt, 1, clock)
    expect(rt.wetness).toBeCloseTo(1, 1)

    requestWeather(rt, 'clear', { instant: true })
    rt.wetness = 1
    stepWeather(rt, 10, clock)
    const afterTen = rt.wetness
    expect(afterTen).toBeGreaterThan(0.5) // slow drain, still damp
    for (let i = 0; i < 100; i++) stepWeather(rt, 1, clock)
    expect(rt.wetness).toBe(0)
  })

  it('follows the schedule when the slot changes (but not on the first step)', () => {
    const rt = createWeatherRuntime()
    rt.seed = 7
    // First step only records the slot — a fresh/loaded game keeps its weather.
    stepWeather(rt, 0.1, { day: 5, hour: 2 })
    expect(rt.targetKind).toBe('clear')
    stepWeather(rt, 0.1, { day: 5, hour: 8 })
    expect(rt.targetKind).toBe(getScheduledWeather(5, 8, 7))
  })

  it('manual override suspends the schedule until the next day', () => {
    const rt = createWeatherRuntime()
    rt.seed = 7
    stepWeather(rt, 0.1, { day: 5, hour: 2 })
    requestWeather(rt, 'foggy', { instant: true, manual: true })
    // Later slot on the same day: override still holds.
    stepWeather(rt, 0.1, { day: 5, hour: 14 })
    expect(rt.targetKind).toBe('foggy')
    // Next day: schedule resumes.
    stepWeather(rt, 0.1, { day: 6, hour: 2 })
    expect(rt.manualOverride).toBe(false)
    expect(rt.targetKind).toBe(getScheduledWeather(6, 2, 7))
  })
})

describe('getBlendedModifiers', () => {
  it('returns exact table values when settled', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'rain', { instant: true })
    const m = getBlendedModifiers(rt)
    expect(m.sunFactor).toBe(WEATHER_MODIFIERS.rain.sunFactor)
    expect(m.trafficSpeedFactor).toBe(WEATHER_MODIFIERS.rain.trafficSpeedFactor)
  })

  it('crossfades halfway between two kinds', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'rain')
    rt.transition = 0.5
    const m = getBlendedModifiers(rt)
    const expected = (WEATHER_MODIFIERS.clear.sunFactor + WEATHER_MODIFIERS.rain.sunFactor) / 2
    expect(m.sunFactor).toBeCloseTo(expected, 5)
  })

  it('scales rain strength by intensity', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'rain', { instant: true, intensity: 0.5 })
    expect(getBlendedModifiers(rt).rainStrength).toBeCloseTo(0.5, 5)
  })

  it('rain slows traffic 10–20%', () => {
    const f = WEATHER_MODIFIERS.rain.trafficSpeedFactor
    expect(f).toBeGreaterThanOrEqual(0.8)
    expect(f).toBeLessThanOrEqual(0.9)
  })
})

describe('snapWeatherForPause', () => {
  it('completes the fade and settles wetness deterministically', () => {
    const rt = createWeatherRuntime()
    requestWeather(rt, 'rain')
    rt.transition = 0.3
    rt.wetness = 0.2
    snapWeatherForPause(rt)
    expect(rt.kind).toBe('rain')
    expect(rt.transition).toBe(1)
    expect(rt.wetness).toBe(WEATHER_MODIFIERS.rain.targetWetness)
  })
})

describe('isRaining', () => {
  it('true in rain, false otherwise', () => {
    const rt = createWeatherRuntime()
    expect(isRaining(rt)).toBe(false)
    requestWeather(rt, 'rain', { instant: true })
    expect(isRaining(rt)).toBe(true)
    requestWeather(rt, 'foggy', { instant: true })
    expect(isRaining(rt)).toBe(false)
  })
})

describe('weather data', () => {
  it('puddles are deterministic with unique ids', () => {
    expect(PUDDLES.length).toBeGreaterThan(10)
    const ids = new Set(PUDDLES.map((p) => p.id))
    expect(ids.size).toBe(PUDDLES.length)
    for (const p of PUDDLES) {
      expect(p.radiusX).toBeGreaterThan(0)
      expect(p.radiusZ).toBeGreaterThan(0)
      expect(Number.isFinite(p.position[0])).toBe(true)
      expect(Number.isFinite(p.position[1])).toBe(true)
    }
  })

  it('nearest shelter picks the closest point', () => {
    for (const s of SHELTER_POINTS) {
      expect(getNearestShelter(s.position[0], s.position[1]).id).toBe(s.id)
    }
  })

  it('badge and flavor cover every kind', () => {
    for (const kind of WEATHER_KINDS) {
      expect(getWeatherBadge(kind)).toContain(' ')
      expect(getWeatherFlavor(kind)).toBe(WEATHER_FLAVOR[kind])
      expect(WEATHER_FLAVOR[kind].length).toBeGreaterThan(5)
    }
  })
})
