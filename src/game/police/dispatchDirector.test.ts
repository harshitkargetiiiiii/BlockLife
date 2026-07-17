import { beforeEach, describe, expect, it } from 'vitest'
import { clearWanted, setWantedLevel } from '../crime/wantedRuntime'
import { resetIncidentRuntime } from '../crime/reportingSystem'
import { activeCounts, resetPoliceRuntime } from './policeRuntime'
import { POLICE_CAPS } from './policeTypes'
import { stepDispatch } from './dispatchDirector'
import type { CameraBox } from './policeSpawns'

const OFF_CAMERA: CameraBox = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }

beforeEach(() => {
  resetPoliceRuntime()
  resetIncidentRuntime()
  clearWanted()
})

describe('police dispatch director', () => {
  it('spawns no units while wanted is clear', () => {
    stepDispatch({ gameTime: 10, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    expect(activeCounts().vehicles).toBe(0)
  })

  it('reconciles the active fleet up to the cap for the current level', () => {
    setWantedLevel(1, [22, 0, 6], 10)
    stepDispatch({ gameTime: 10, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    expect(activeCounts().vehicles).toBe(POLICE_CAPS[1].vehicles)

    // Escalate to L3 → more units are dispatched, still capped.
    setWantedLevel(3, [22, 0, 6], 12)
    stepDispatch({ gameTime: 12, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    expect(activeCounts().vehicles).toBe(POLICE_CAPS[3].vehicles)
  })

  it('does not exceed the cap across repeated ticks', () => {
    setWantedLevel(2, [22, 0, 6], 10)
    for (let t = 10; t < 20; t++) {
      stepDispatch({ gameTime: t, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    }
    expect(activeCounts().vehicles).toBe(POLICE_CAPS[2].vehicles)
  })

  it('despawns the whole fleet when wanted clears', () => {
    setWantedLevel(3, [22, 0, 6], 10)
    stepDispatch({ gameTime: 10, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    expect(activeCounts().vehicles).toBeGreaterThan(0)
    clearWanted()
    stepDispatch({ gameTime: 30, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    expect(activeCounts().vehicles).toBe(0)
  })

  it('reconciles the fleet DOWN when the level drops but stays > 0', () => {
    setWantedLevel(3, [22, 0, 6], 10)
    stepDispatch({ gameTime: 10, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    const high = activeCounts().vehicles
    expect(high).toBe(POLICE_CAPS[3].vehicles)

    setWantedLevel(1, [22, 0, 6], 30)
    stepDispatch({ gameTime: 30, suspectPosition: [22, 6], cameraBox: OFF_CAMERA })
    expect(activeCounts().vehicles).toBe(POLICE_CAPS[1].vehicles)
  })
})
