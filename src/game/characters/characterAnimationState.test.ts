import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  IDLE_DEADZONE,
  MOTION_TELEPORT_DISTANCE,
  RUN_HYSTERESIS,
  RUN_THRESHOLD,
  SPEED_SMOOTHING_TAU,
  createMotionState,
  getNpcCharacterMotionState,
  getPlayerCharacterMotionState,
  resetPlayerMotionState,
  selectLocomotionRole,
  smoothSpeed,
  updateMotionState,
} from './characterAnimationState'
import { WALK_SPEED, RUN_SPEED } from '../player/playerTypes'
import { registry } from '../world/runtimeRegistry'
import { useGameStore, createInitialGameState } from '../store/useGameStore'

describe('selectLocomotionRole', () => {
  it('treats sub-deadzone speeds as idle', () => {
    expect(selectLocomotionRole(0, false)).toBe('idle')
    expect(selectLocomotionRole(IDLE_DEADZONE - 0.01, false)).toBe('idle')
    expect(selectLocomotionRole(IDLE_DEADZONE - 0.01, true)).toBe('idle')
  })

  it('selects walk between the deadzone and the run threshold', () => {
    expect(selectLocomotionRole(IDLE_DEADZONE + 0.01, false)).toBe('walk')
    expect(selectLocomotionRole(WALK_SPEED, false)).toBe('walk')
  })

  it('selects run above the raised threshold when not yet running', () => {
    expect(selectLocomotionRole(RUN_THRESHOLD + RUN_HYSTERESIS + 0.01, false)).toBe('run')
    expect(selectLocomotionRole(RUN_SPEED, false)).toBe('run')
  })

  it('applies hysteresis: threshold speeds stay in the current gait', () => {
    // Just above the base threshold — not enough to ENTER run…
    expect(selectLocomotionRole(RUN_THRESHOLD + 0.1, false)).toBe('walk')
    // …but plenty to STAY in run once running.
    expect(selectLocomotionRole(RUN_THRESHOLD + 0.1, true)).toBe('run')
    expect(selectLocomotionRole(RUN_THRESHOLD - RUN_HYSTERESIS - 0.01, true)).toBe('walk')
  })
})

describe('updateMotionState', () => {
  it('maps driving to the driving locomotion without moving flag', () => {
    const out = createMotionState()
    updateMotionState(out, { speed: 9, facingAngle: 1, driving: true })
    expect(out.locomotion).toBe('driving')
    expect(out.moving).toBe(false)
  })

  it('maps disabled above everything else', () => {
    const out = createMotionState()
    updateMotionState(out, { speed: 9, facingAngle: 0, driving: false, disabled: true })
    expect(out.locomotion).toBe('disabled')
    expect(out.speed).toBe(0)
  })

  it('normalizes speed within the current gait band', () => {
    const out = createMotionState()
    updateMotionState(out, { speed: WALK_SPEED / 2, facingAngle: 0, driving: false })
    expect(out.locomotion).toBe('walk')
    expect(out.normalizedSpeed).toBeCloseTo(0.5)
    updateMotionState(out, { speed: RUN_SPEED * 2, facingAngle: 0, driving: false })
    expect(out.locomotion).toBe('run')
    expect(out.normalizedSpeed).toBe(1) // clamped
  })

  it('mutates and returns the same object (no per-frame allocation)', () => {
    const out = createMotionState()
    expect(updateMotionState(out, { speed: 1, facingAngle: 0, driving: false })).toBe(out)
  })
})

describe('smoothSpeed', () => {
  it('converges toward a steady input', () => {
    let s = 0
    for (let i = 0; i < 120; i++) s = smoothSpeed(s, WALK_SPEED, 1 / 60, SPEED_SMOOTHING_TAU)
    expect(s).toBeCloseTo(WALK_SPEED, 1)
  })

  it('absorbs a single-frame spike without entering the run band', () => {
    // Steady walk, then one frame reads 2.5× the true speed (physics/render
    // tick misalignment) — the smoothed value must stay below the run gate.
    let s = WALK_SPEED
    s = smoothSpeed(s, WALK_SPEED * 2.5, 1 / 60, SPEED_SMOOTHING_TAU)
    expect(s).toBeLessThan(RUN_THRESHOLD + RUN_HYSTERESIS)
    expect(selectLocomotionRole(s, false)).toBe('walk')
  })

  it('returns the previous value for non-positive dt', () => {
    expect(smoothSpeed(3, 10, 0, SPEED_SMOOTHING_TAU)).toBe(3)
  })
})

describe('getPlayerCharacterMotionState', () => {
  const dt = 1 / 60

  beforeEach(() => {
    resetPlayerMotionState()
    registry.playerPosition.set(0, 0.8, 0)
    useGameStore.setState(createInitialGameState())
  })

  afterEach(() => {
    resetPlayerMotionState()
    useGameStore.setState(createInitialGameState())
  })

  /** Advances the player x by `speed` u/s for `frames` frames. */
  function step(speed: number, frames: number) {
    let m = getPlayerCharacterMotionState(dt, 0)
    for (let i = 0; i < frames; i++) {
      registry.playerPosition.x += speed * dt
      m = getPlayerCharacterMotionState(dt, 0)
    }
    return m
  }

  it('derives walk from sustained position deltas', () => {
    const m = step(WALK_SPEED, 90)
    expect(m.locomotion).toBe('walk')
    expect(m.speed).toBeCloseTo(WALK_SPEED, 0)
  })

  it('derives run from sustained faster deltas', () => {
    const m = step(RUN_SPEED, 90)
    expect(m.locomotion).toBe('run')
  })

  it('a teleport never bursts into a run', () => {
    step(WALK_SPEED, 30)
    registry.playerPosition.x += MOTION_TELEPORT_DISTANCE * 10
    const m = getPlayerCharacterMotionState(dt, 0)
    expect(m.locomotion).toBe('idle')
    expect(m.speed).toBeLessThan(IDLE_DEADZONE)
  })

  it('driving mode overrides locomotion regardless of deltas', () => {
    useGameStore.setState({ mode: 'driving' })
    const m = step(RUN_SPEED, 30)
    expect(m.locomotion).toBe('driving')
  })

  it('keeps the supplied heading as facing', () => {
    getPlayerCharacterMotionState(dt, 1.25)
    const m = getPlayerCharacterMotionState(dt, 2.5)
    expect(m.facingAngle).toBe(2.5)
  })
})

describe('getNpcCharacterMotionState', () => {
  it('maps published intent to walk/idle', () => {
    const out = createMotionState()
    getNpcCharacterMotionState(out, { walking: true, speed: 1.8, heading: 0.5 })
    expect(out.locomotion).toBe('walk')
    expect(out.facingAngle).toBe(0.5)
    getNpcCharacterMotionState(out, { walking: false, speed: 1.8, heading: 0.5 })
    expect(out.locomotion).toBe('idle')
    expect(out.speed).toBe(0)
  })
})
