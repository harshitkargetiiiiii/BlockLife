import { beforeEach, describe, expect, it } from 'vitest'
import {
  CRIME_EXPIRY_SECONDS,
  crimeRuntime,
  emitCrime,
  expireCrimes,
  getCrimeEventsByStatus,
  getOpenCrimes,
  recordReport,
  recordWitness,
  resetCrimeRuntime,
} from './crimeRuntime'
import { CRIME_PROFILES } from './crimeTypes'

beforeEach(() => resetCrimeRuntime())

describe('crime event runtime', () => {
  it('assigns stable, deterministic, monotonic ids and preserves order', () => {
    const a = emitCrime({ type: 'vehicle_theft', position: [10, 1, 10], suspectEntityId: 'player', vehicleId: 'v1' }, 1)
    const b = emitCrime({ type: 'assault', position: [12, 1, 10], suspectEntityId: 'player', victimEntityId: 'c9' }, 2)
    expect(a!.id).toBe('crime_0')
    expect(b!.id).toBe('crime_1')
    expect(crimeRuntime.events.map((e) => e.id)).toEqual(['crime_0', 'crime_1'])
  })

  it('maps severity and radii from the type profile (overridable)', () => {
    const e = emitCrime({ type: 'weapon_discharge', position: [0, 1, 0], suspectEntityId: 'player', weaponId: 'handgun' }, 1)!
    expect(e.severity).toBe(CRIME_PROFILES.weapon_discharge.severity)
    expect(e.noiseRadius).toBe(CRIME_PROFILES.weapon_discharge.noiseRadius)
    const forced = emitCrime({ type: 'reckless_driving', position: [0, 1, 0], suspectEntityId: 'player', severity: 9 }, 20)!
    expect(forced.severity).toBe(9)
  })

  it('debounces duplicate same-key emissions within the window (one impact/frame)', () => {
    const first = emitCrime({ type: 'vehicle_collision', position: [5, 1, 5], suspectEntityId: 'player', vehicleId: 'v1' }, 100)
    const dup = emitCrime({ type: 'vehicle_collision', position: [5, 1, 5], suspectEntityId: 'player', vehicleId: 'v1' }, 100.5)
    expect(first).not.toBeNull()
    expect(dup).toBeNull() // collapsed — 0.5s < 1.5s debounce
    // A different vehicle is a different key → not debounced.
    const other = emitCrime({ type: 'vehicle_collision', position: [5, 1, 5], suspectEntityId: 'player', vehicleId: 'v2' }, 100.5)
    expect(other).not.toBeNull()
    // Past the window the same key emits again.
    const later = emitCrime({ type: 'vehicle_collision', position: [5, 1, 5], suspectEntityId: 'player', vehicleId: 'v1' }, 102 )
    expect(later).not.toBeNull()
    expect(crimeRuntime.events).toHaveLength(3)
  })

  it('rate-limits gunfire so every shot cannot ratchet crime', () => {
    let emitted = 0
    for (let i = 0; i < 20; i++) {
      // 20 shots over 2 seconds at 0.1s spacing; 0.4s debounce.
      if (emitCrime({ type: 'weapon_discharge', position: [0, 1, 0], suspectEntityId: 'player', weaponId: 'handgun' }, i * 0.1)) {
        emitted++
      }
    }
    expect(emitted).toBeLessThanOrEqual(6) // ~1 per 0.4s, not 20
  })

  it('tags each event with its owning sector from world position', () => {
    const e = emitCrime({ type: 'vehicle_theft', position: [50, 1, -150], suspectEntityId: 'player', vehicleId: 'v1' }, 1)!
    expect(e.sectorId).toMatch(/^s-?\d+_-?\d+$/)
  })

  it('expires stale UNREPORTED events but keeps reported ones', () => {
    const stale = emitCrime({ type: 'vehicle_theft', position: [0, 1, 0], suspectEntityId: 'player', vehicleId: 'v1' }, 0)!
    const reported = emitCrime({ type: 'assault', position: [0, 1, 0], suspectEntityId: 'player', victimEntityId: 'c1' }, 0)!
    recordReport(reported.id, 'c1')
    expireCrimes(CRIME_EXPIRY_SECONDS + 1)
    expect(getCrimeEventsByStatus('expired').map((e) => e.id)).toEqual([stale.id])
    expect(getCrimeEventsByStatus('reported').map((e) => e.id)).toEqual([reported.id])
  })

  it('witness/report transitions: unseen → witnessed → reported', () => {
    const e = emitCrime({ type: 'vehicle_theft', position: [0, 1, 0], suspectEntityId: 'player', vehicleId: 'v1' }, 1)!
    expect(getOpenCrimes()).toHaveLength(1)
    recordWitness(e.id, 'cit_a')
    recordWitness(e.id, 'cit_a') // idempotent
    recordWitness(e.id, 'cit_b')
    expect(e.status).toBe('witnessed')
    expect(e.witnessedBy).toEqual(['cit_a', 'cit_b'])
    recordReport(e.id, 'cit_a')
    expect(e.status).toBe('reported')
    expect(e.reportedBy).toBe('cit_a')
    expect(getOpenCrimes()).toHaveLength(0) // reported is no longer "open"
  })

  it('bounds the event ring to the most recent events', () => {
    for (let i = 0; i < 100; i++) {
      emitCrime({ type: 'reckless_driving', position: [i, 1, 0], suspectEntityId: 'player', severity: 1 }, i * 10)
    }
    expect(crimeRuntime.events.length).toBeLessThanOrEqual(64)
    // Newest survives, oldest dropped.
    expect(crimeRuntime.events[crimeRuntime.events.length - 1].id).toBe('crime_99')
    expect(crimeRuntime.events.some((e) => e.id === 'crime_0')).toBe(false)
  })
})
