import * as THREE from 'three'
import type {
  AnimationRole,
  CharacterAnimState,
  CharacterAssetDefinition,
  CharacterMotionState,
} from './characterTypes'
import { RUN_SPEED, WALK_SPEED } from '../player/playerTypes'

/**
 * Semantic animation state machine over a single AnimationMixer.
 *
 * - actions are created ONCE per instance; same-state updates never restart
 * - transitions are crossfades with per-pair durations
 * - playback rate follows normalized movement speed within clamped bands
 * - driving/disabled park the mixer on idle (the model is hidden by the
 *   driving policy; a seated `drive` clip slots in here later)
 * - deterministic freeze for visual tests: freezeAt(t) pins every action
 */

export const CROSSFADE_SECONDS: Record<string, number> = {
  'idle>walk': 0.2,
  'walk>idle': 0.22,
  'walk>run': 0.15,
  'run>walk': 0.18,
  'run>idle': 0.25,
  default: 0.2,
}

export const WALK_RATE_RANGE: [number, number] = [0.75, 1.25]
export const RUN_RATE_RANGE: [number, number] = [0.85, 1.2]

export function crossfadeDuration(from: string, to: string): number {
  return CROSSFADE_SECONDS[`${from}>${to}`] ?? CROSSFADE_SECONDS.default
}

/** Pure, clamped playback-rate policy (unit-tested). Animation NEVER feeds
    back into gameplay velocity — it only mirrors it. */
export function playbackRateFor(
  role: 'idle' | 'walk' | 'run',
  speed: number,
  scale: { walk?: number; run?: number } = {},
): number {
  if (role === 'idle') return 1
  if (role === 'walk') {
    const raw = (speed / WALK_SPEED) * (scale.walk ?? 1)
    return Math.min(WALK_RATE_RANGE[1], Math.max(WALK_RATE_RANGE[0], raw))
  }
  const raw = (speed / RUN_SPEED) * (scale.run ?? 1)
  return Math.min(RUN_RATE_RANGE[1], Math.max(RUN_RATE_RANGE[0], raw))
}

/** Which locomotion states map to which clip role. */
function roleForState(state: CharacterAnimState): AnimationRole {
  switch (state) {
    case 'walk':
      return 'walk'
    case 'run':
      return 'run'
    default:
      return 'idle'
  }
}

export class CharacterAnimationController {
  readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<AnimationRole, THREE.AnimationAction>()
  private readonly def: CharacterAssetDefinition
  current: CharacterAnimState = 'idle'
  previous: CharacterAnimState = 'idle'
  frozen = false

  constructor(
    root: THREE.Object3D,
    def: CharacterAssetDefinition,
    clips: Partial<Record<AnimationRole, THREE.AnimationClip>>,
  ) {
    this.mixer = new THREE.AnimationMixer(root)
    this.def = def
    for (const [role, clip] of Object.entries(clips) as [AnimationRole, THREE.AnimationClip][]) {
      const action = this.mixer.clipAction(clip)
      action.enabled = true
      action.setLoop(THREE.LoopRepeat, Infinity)
      this.actions.set(role, action)
    }
    // Start parked on idle — no T-pose frame, ever.
    const idle = this.actions.get('idle')
    if (idle) {
      idle.play()
      this.mixer.update(0)
    }
  }

  hasRole(role: AnimationRole): boolean {
    return this.actions.has(role)
  }

  get activeActionCount(): number {
    let n = 0
    for (const a of this.actions.values()) if (a.isRunning()) n++
    return n
  }

  get currentRate(): number {
    const action = this.actions.get(roleForState(this.current))
    return action ? action.timeScale : 1
  }

  /** Advance one frame from normalized motion. Never touches React state. */
  update(motion: CharacterMotionState, dt: number): void {
    if (this.frozen) return
    const nextState: CharacterAnimState =
      motion.locomotion === 'disabled'
        ? 'disabled'
        : motion.locomotion === 'driving'
          ? 'driving'
          : motion.locomotion

    if (nextState !== this.current) this.transitionTo(nextState)

    // Playback rate mirrors real speed inside clamped bands.
    const role = roleForState(this.current)
    const action = this.actions.get(role)
    if (action && (role === 'walk' || role === 'run')) {
      action.timeScale = playbackRateFor(role, motion.speed, this.def.animationSpeedScale)
    }
    this.mixer.update(dt)
  }

  private transitionTo(next: CharacterAnimState): void {
    const fromRole = roleForState(this.current)
    const toRole = roleForState(next)
    this.previous = this.current
    this.current = next
    if (fromRole === toRole) return // driving/disabled share the idle clip
    const from = this.actions.get(fromRole)
    const to = this.actions.get(toRole)
    if (!to) return
    const duration = crossfadeDuration(fromRole, toRole)
    to.reset()
    to.timeScale = 1
    to.play()
    if (from && from.isRunning()) {
      to.crossFadeFrom(from, duration, false)
    } else {
      to.fadeIn(duration)
    }
  }

  /** Teleports/saves: snap to idle with no residual fade. */
  resetToIdle(): void {
    for (const action of this.actions.values()) action.stop()
    this.current = 'idle'
    this.previous = 'idle'
    const idle = this.actions.get('idle')
    if (idle) {
      idle.reset()
      idle.setEffectiveWeight(1)
      idle.play()
    }
    this.mixer.update(0)
  }

  /** Deterministic pose for visual tests: pin every action at time t. */
  freezeAt(t: number): void {
    this.resetToIdle()
    const idle = this.actions.get('idle')
    if (idle) idle.time = t % (idle.getClip().duration || 1)
    this.mixer.update(0)
    this.frozen = true
  }

  unfreeze(): void {
    this.frozen = false
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.mixer.getRoot())
    this.actions.clear()
  }
}
