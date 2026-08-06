import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  CROSSFADE_SECONDS,
  CharacterAnimationController,
  RUN_RATE_RANGE,
  WALK_RATE_RANGE,
  crossfadeDuration,
  playbackRateFor,
} from './CharacterAnimationController'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'
import { createMotionState } from './characterAnimationState'
import { WALK_SPEED, RUN_SPEED } from '../player/playerTypes'
import type { AnimationRole } from './characterTypes'
import type { CharacterMotionState } from './characterTypes'

const DEF = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

function makeClip(name: string, duration: number): THREE.AnimationClip {
  const track = new THREE.QuaternionKeyframeTrack(
    '.quaternion',
    [0, duration],
    [0, 0, 0, 1, 0, 0, 0, 1],
  )
  return new THREE.AnimationClip(name, duration, [track])
}

function makeController(roles: AnimationRole[] = ['idle', 'walk', 'run']) {
  const root = new THREE.Object3D()
  const clips: Partial<Record<AnimationRole, THREE.AnimationClip>> = {}
  const durations: Record<string, number> = { idle: 2.4, walk: 0.9, run: 0.62 }
  for (const role of roles) clips[role] = makeClip(role, durations[role] ?? 1)
  return { root, clips, controller: new CharacterAnimationController(root, DEF, clips) }
}

function motion(
  locomotion: CharacterMotionState['locomotion'],
  speed: number,
): CharacterMotionState {
  const m = createMotionState()
  m.locomotion = locomotion
  m.speed = speed
  m.moving = locomotion === 'walk' || locomotion === 'run'
  return m
}

describe('playbackRateFor', () => {
  it('idle always plays at 1', () => {
    expect(playbackRateFor('idle', 99)).toBe(1)
  })

  it('walk rate tracks speed and clamps to its band', () => {
    expect(playbackRateFor('walk', WALK_SPEED)).toBeCloseTo(1)
    expect(playbackRateFor('walk', 0.1)).toBe(WALK_RATE_RANGE[0])
    expect(playbackRateFor('walk', WALK_SPEED * 10)).toBe(WALK_RATE_RANGE[1])
  })

  it('run rate tracks speed and clamps to its band', () => {
    expect(playbackRateFor('run', RUN_SPEED)).toBeCloseTo(1)
    expect(playbackRateFor('run', 0.1)).toBe(RUN_RATE_RANGE[0])
    expect(playbackRateFor('run', RUN_SPEED * 10)).toBe(RUN_RATE_RANGE[1])
  })

  it('applies the per-asset speed scale inside the clamps', () => {
    expect(playbackRateFor('walk', WALK_SPEED, { walk: 1.1 })).toBeCloseTo(1.1)
    expect(playbackRateFor('walk', WALK_SPEED, { walk: 99 })).toBe(WALK_RATE_RANGE[1])
  })
})

describe('crossfadeDuration', () => {
  it('uses the per-pair table with a default fallback', () => {
    expect(crossfadeDuration('idle', 'walk')).toBe(CROSSFADE_SECONDS['idle>walk'])
    expect(crossfadeDuration('run', 'idle')).toBe(CROSSFADE_SECONDS['run>idle'])
    expect(crossfadeDuration('sit', 'walk')).toBe(CROSSFADE_SECONDS.default)
  })
})

describe('CharacterAnimationController', () => {
  it('starts parked on idle (no T-pose frame)', () => {
    const { controller } = makeController()
    expect(controller.current).toBe('idle')
    expect(controller.activeActionCount).toBe(1)
  })

  it('transitions idle→walk→run→idle, tracking previous state', () => {
    const { controller } = makeController()
    controller.update(motion('walk', WALK_SPEED), 1 / 60)
    expect(controller.current).toBe('walk')
    expect(controller.previous).toBe('idle')
    controller.update(motion('run', RUN_SPEED), 1 / 60)
    expect(controller.current).toBe('run')
    expect(controller.previous).toBe('walk')
    controller.update(motion('idle', 0), 1 / 60)
    expect(controller.current).toBe('idle')
    expect(controller.previous).toBe('run')
  })

  it('same-state updates never restart the clip', () => {
    const { controller, clips } = makeController()
    controller.update(motion('walk', WALK_SPEED), 1 / 60)
    for (let i = 0; i < 20; i++) controller.update(motion('walk', WALK_SPEED), 1 / 60)
    const walkAction = controller.mixer.existingAction(clips.walk!)!
    const timeBefore = walkAction.time
    expect(timeBefore).toBeGreaterThan(0.2) // ~0.35s into the loop
    controller.update(motion('walk', WALK_SPEED), 1 / 60)
    // A restart would snap time back to 0; a continuation advances it.
    expect(walkAction.time).toBeGreaterThan(timeBefore)
  })

  it('mirrors speed into the playback rate within clamps', () => {
    const { controller } = makeController()
    controller.update(motion('walk', WALK_SPEED * 0.9), 1 / 60)
    expect(controller.currentRate).toBeCloseTo(0.9)
    controller.update(motion('walk', 0.3), 1 / 60)
    expect(controller.currentRate).toBe(WALK_RATE_RANGE[0])
  })

  it('driving parks on the idle clip but reports the driving state', () => {
    const { controller } = makeController()
    controller.update(motion('driving', 8), 1 / 60)
    expect(controller.current).toBe('driving')
    expect(controller.activeActionCount).toBe(1)
  })

  it('freezeAt pins the pose and update becomes a no-op until unfreeze', () => {
    const { controller } = makeController()
    controller.update(motion('run', RUN_SPEED), 1 / 60)
    controller.freezeAt(0)
    expect(controller.frozen).toBe(true)
    expect(controller.current).toBe('idle')
    controller.update(motion('run', RUN_SPEED), 1 / 60)
    expect(controller.current).toBe('idle') // frozen: no transition happened
    controller.unfreeze()
    controller.update(motion('run', RUN_SPEED), 1 / 60)
    expect(controller.current).toBe('run')
  })

  it('resetToIdle leaves exactly the idle action running', () => {
    const { controller } = makeController()
    controller.update(motion('run', RUN_SPEED), 1 / 60)
    controller.resetToIdle()
    expect(controller.current).toBe('idle')
    expect(controller.activeActionCount).toBe(1)
  })

  it('tolerates a missing optional role without throwing', () => {
    const { controller } = makeController(['idle', 'walk'])
    expect(controller.hasRole('run')).toBe(false)
    controller.update(motion('run', RUN_SPEED), 1 / 60)
    // State advances; the missing action is simply not played.
    expect(controller.current).toBe('run')
  })

  it('two instances animate independently (no shared mixer state)', () => {
    const a = makeController()
    const b = makeController()
    a.controller.update(motion('run', RUN_SPEED), 1 / 60)
    expect(a.controller.current).toBe('run')
    expect(b.controller.current).toBe('idle')
    expect(a.controller.mixer).not.toBe(b.controller.mixer)
  })

  it('dispose stops all actions', () => {
    const { controller } = makeController()
    controller.update(motion('walk', WALK_SPEED), 1 / 60)
    controller.dispose()
    expect(controller.activeActionCount).toBe(0)
  })
})

describe('CharacterAnimationController — staticIdle (issue #21 §4)', () => {
  const STATIC_DEF = { ...DEF, staticIdle: true }
  function makeStatic() {
    const root = new THREE.Object3D()
    const clips: Partial<Record<AnimationRole, THREE.AnimationClip>> = {
      idle: makeClip('idle', 0.9),
      walk: makeClip('walk', 0.9),
      run: makeClip('run', 0.62),
    }
    return { clips, controller: new CharacterAnimationController(root, STATIC_DEF, clips) }
  }

  it('holds the idle at a still frame instead of marching in place', () => {
    const { controller, clips } = makeStatic()
    const idleAction = controller.mixer.existingAction(clips.idle!)!
    for (let i = 0; i < 30; i++) controller.update(motion('idle', 0), 1 / 60)
    expect(idleAction.paused).toBe(true)
    expect(idleAction.time).toBe(0) // never advances while standing → no walk-in-place
  })

  it('still animates the walk clip while moving, then re-freezes idle on stop', () => {
    const { controller, clips } = makeStatic()
    const walkAction = controller.mixer.existingAction(clips.walk!)!
    for (let i = 0; i < 10; i++) controller.update(motion('walk', WALK_SPEED), 1 / 60)
    expect(walkAction.paused).toBe(false)
    expect(walkAction.time).toBeGreaterThan(0)
    for (let i = 0; i < 30; i++) controller.update(motion('idle', 0), 1 / 60)
    expect(controller.mixer.existingAction(clips.idle!)!.paused).toBe(true)
  })

  it('a normal (looping-idle) asset is unaffected — its idle clip keeps advancing', () => {
    const { controller, clips } = makeController() // DEF has no staticIdle
    const idleAction = controller.mixer.existingAction(clips.idle!)!
    for (let i = 0; i < 30; i++) controller.update(motion('idle', 0), 1 / 60)
    expect(idleAction.paused).toBe(false)
    expect(idleAction.time).toBeGreaterThan(0)
  })
})
