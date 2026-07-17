import { describe, expect, it } from 'vitest'
import { getLampGlow, getLightingForHour, getMood } from './worldMoodSystem'

describe('worldMoodSystem', () => {
  it('maps hours to moods', () => {
    expect(getMood(8)).toBe('morning')
    expect(getMood(14)).toBe('afternoon')
    expect(getMood(18.5)).toBe('evening')
    expect(getMood(23)).toBe('night')
    expect(getMood(3)).toBe('night')
  })

  it('afternoon is brighter than night', () => {
    const noon = getLightingForHour(13)
    const midnight = getLightingForHour(0)
    expect(noon.sunIntensity).toBeGreaterThan(midnight.sunIntensity)
    expect(noon.ambientIntensity).toBeGreaterThan(midnight.ambientIntensity)
  })

  it('evening light is warmer (more red than blue) than afternoon', () => {
    const evening = getLightingForHour(19)
    expect(evening.sunColor[0]).toBeGreaterThan(evening.sunColor[2])
  })

  it('night sky is dark blue', () => {
    const night = getLightingForHour(23)
    expect(night.skyColor[2]).toBeGreaterThan(night.skyColor[0])
    expect(night.skyColor[0]).toBeLessThan(0.2)
  })

  it('lighting interpolates continuously', () => {
    const a = getLightingForHour(9)
    const b = getLightingForHour(9.01)
    expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.05)
  })

  it('lamps are on at night and off in the afternoon', () => {
    expect(getLampGlow(23)).toBe(1)
    expect(getLampGlow(3)).toBe(1)
    expect(getLampGlow(13)).toBe(0)
  })

  it('lamps ramp smoothly at dusk', () => {
    expect(getLampGlow(19.5)).toBeGreaterThan(0)
    expect(getLampGlow(19.5)).toBeLessThan(1)
  })
})
