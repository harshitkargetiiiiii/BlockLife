import { beforeEach, describe, expect, it } from 'vitest'
import { clearWanted, getWantedLevel, setWantedLevel, wantedRuntime } from '../crime/wantedRuntime'
import { resetIncidentRuntime } from '../crime/reportingSystem'
import { registerPlayerDamageSink, resetDamageRuntime } from '../combat/damageRuntime'
import { activeCounts, policeRuntime, resetPoliceRuntime } from './policeRuntime'
import { stepPoliceDirector, type PoliceDirectorInput } from './policeStep'
import type { Vec2 } from '../world/worldTypes'

const clearLos = () => true
const noLos = () => false

function input(over: Partial<PoliceDirectorInput>): PoliceDirectorInput {
  return {
    gameTime: 100,
    dt: 0.4,
    suspectPos: [22, 6],
    suspectInVehicle: false,
    suspectSpeed: 0,
    cameraBox: null,
    hasLos: clearLos,
    ...over,
  }
}

beforeEach(() => {
  resetPoliceRuntime()
  resetIncidentRuntime()
  clearWanted()
})

describe('police director orchestration', () => {
  it('spawns a response and drives units toward a wanted suspect', () => {
    setWantedLevel(2, [22, 0, 6], 100)
    stepPoliceDirector(input({ suspectSpeed: 5 }))
    expect(activeCounts().vehicles).toBeGreaterThan(0)
  })

  it('sets pursuit while an officer sees the suspect', () => {
    setWantedLevel(1, [22, 0, 6], 100)
    // First tick spawns; place a unit on the suspect so it sees them.
    stepPoliceDirector(input({ suspectSpeed: 5 }))
    for (const u of policeRuntime.units.values()) u.position = [24, 6]
    const r = stepPoliceDirector(input({ gameTime: 101, suspectSpeed: 5 }))
    expect(r.anySees).toBe(true)
    expect(wantedRuntime.status).toBe('pursuit')
  })

  it('transitions pursuit → searching when the last officer loses sight', () => {
    setWantedLevel(1, [22, 0, 6], 100)
    stepPoliceDirector(input({ suspectSpeed: 5 }))
    for (const u of policeRuntime.units.values()) u.position = [24, 6]
    stepPoliceDirector(input({ gameTime: 101, suspectSpeed: 5 }))
    expect(wantedRuntime.status).toBe('pursuit')
    // Now the suspect breaks line of sight.
    stepPoliceDirector(input({ gameTime: 102, suspectSpeed: 5, hasLos: noLos }))
    expect(wantedRuntime.status).toBe('searching')
  })

  it('resolves an arrest: records it and clears wanted', () => {
    setWantedLevel(1, [22, 0, 6], 100)
    stepPoliceDirector(input({ suspectSpeed: 0 }))
    // Park a unit in arrest range of a stopped suspect and let the hold elapse.
    for (const u of policeRuntime.units.values()) u.position = [23, 6]
    let t = 101
    while (getWantedLevel() > 0 && t < 130) {
      stepPoliceDirector(input({ gameTime: t, suspectSpeed: 0 }))
      t += 0.4
    }
    expect(policeRuntime.arrestsMade).toBeGreaterThan(0)
    expect(getWantedLevel()).toBe(0)
  })

  it('never arrests a suspect who keeps driving away', () => {
    setWantedLevel(2, [22, 0, 6], 100)
    for (let i = 0; i < 30; i++) {
      const r = stepPoliceDirector(
        input({ gameTime: 100 + i * 0.4, suspectInVehicle: true, suspectSpeed: 12 }),
      )
      expect(r.arrested).toBe(false)
    }
    expect(policeRuntime.arrestsMade).toBe(0)
  })

  it('officers in combat (L3) return fire and can damage the player', () => {
    let playerDamage = 0
    registerPlayerDamageSink((amount) => {
      playerDamage += amount
      return { health: Math.max(0, 100 - playerDamage), incapacitated: playerDamage >= 100 }
    })
    resetDamageRuntime()
    setWantedLevel(3, [22, 0, 6], 100) // forces armed L3 response
    stepPoliceDirector(input({ suspectSpeed: 5 }))
    // Park a unit next to the suspect so it holds a combat visual.
    for (const u of policeRuntime.units.values()) u.position = [24, 6]
    let firedAtLeastOnce = false
    for (let t = 101; t < 130; t += 0.5) {
      stepPoliceDirector(input({ gameTime: t, suspectSpeed: 5 }))
      for (const u of policeRuntime.units.values()) {
        if (u.state === 'combat') firedAtLeastOnce = true
      }
    }
    expect(firedAtLeastOnce).toBe(true)
    expect(playerDamage).toBeGreaterThan(0)
    // Restore a no-op sink so other test files aren't affected.
    registerPlayerDamageSink(() => ({ health: 100, incapacitated: false }))
  })

  it('applies avoidance so pursuing units cannot phase through a wall', () => {
    setWantedLevel(1, [22, 0, 6], 100)
    stepPoliceDirector(input({ suspectSpeed: 5 }))
    const capturedZ: number[] = []
    const avoid = (p: Vec2): Vec2 => {
      capturedZ.push(p[1])
      return [p[0], 99] // resolver forces every step to z=99
    }
    stepPoliceDirector(input({ gameTime: 101, suspectSpeed: 5, avoid }))
    for (const u of policeRuntime.units.values()) expect(u.position[1]).toBe(99)
    expect(capturedZ.length).toBeGreaterThan(0)
  })
})

describe('dismounted officers (Hard M4)', () => {
  const onSuspect = (): Vec2 => [22, 6]

  function bringCruiserToSuspect(): void {
    setWantedLevel(1, [22, 0, 6], 100)
    stepPoliceDirector(input({ suspectSpeed: 5 }))
    // Park the cruiser right on the on-foot suspect so it is within dismount range.
    for (const u of policeRuntime.units.values()) u.position = [23, 6]
  }

  it('puts an officer on the street once a cruiser closes on an on-foot suspect', () => {
    bringCruiserToSuspect()
    stepPoliceDirector(
      input({ gameTime: 101, suspectPos: onSuspect(), suspectInVehicle: false, suspectSpeed: 3 }),
    )
    expect(activeCounts().officers).toBe(1)
    const officer = [...policeRuntime.units.values()].find((u) => u.kind === 'officer')
    expect(officer?.cruiserId).toBeDefined()
    expect(officer?.state).toBe('pursuing_on_foot')
  })

  it('spawns the officer at the driver-supplied safe exit', () => {
    bringCruiserToSuspect()
    stepPoliceDirector(
      input({
        gameTime: 101,
        suspectPos: onSuspect(),
        suspectInVehicle: false,
        suspectSpeed: 3,
        findSafeExit: () => [77, 77],
      }),
    )
    const officer = [...policeRuntime.units.values()].find((u) => u.kind === 'officer')
    expect(officer?.position).toEqual([77, 77])
  })

  it('never dismounts more than one officer per cruiser', () => {
    bringCruiserToSuspect()
    for (let t = 101; t < 110; t += 0.4) {
      stepPoliceDirector(
        input({ gameTime: t, suspectPos: onSuspect(), suspectInVehicle: false, suspectSpeed: 3 }),
      )
    }
    // L1 caps officers at 2, but there is only ONE cruiser → exactly one officer.
    expect(activeCounts().officers).toBe(1)
  })

  it('does not dismount while the suspect is still driving', () => {
    setWantedLevel(2, [22, 0, 6], 100)
    stepPoliceDirector(input({ suspectSpeed: 12, suspectInVehicle: true }))
    for (const u of policeRuntime.units.values()) u.position = [23, 6]
    stepPoliceDirector(
      input({ gameTime: 101, suspectInVehicle: true, suspectSpeed: 12 }),
    )
    expect(activeCounts().officers).toBe(0)
  })

  it('officers ride down with their cruiser and vanish when wanted clears', () => {
    bringCruiserToSuspect()
    stepPoliceDirector(
      input({ gameTime: 101, suspectPos: onSuspect(), suspectInVehicle: false, suspectSpeed: 3 }),
    )
    expect(activeCounts().officers).toBe(1)
    // Clearing wanted drains the whole fleet — officers included.
    clearWanted()
    stepPoliceDirector(input({ gameTime: 102, suspectSpeed: 0 }))
    expect(activeCounts().officers).toBe(0)
    expect(activeCounts().vehicles).toBe(0)
  })
})
