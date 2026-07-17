import type { CharacterMotionState } from './characterTypes'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { RUN_SPEED, WALK_SPEED } from '../player/playerTypes'

/**
 * Normalized motion: animation reads INTENT derived from authoritative
 * movement state (physics velocity, driving flag), never raw keys — a
 * player sliding from physics still animates by actual speed; a teleport
 * (position jump without velocity) never bursts into a run.
 */

/** Below this speed the character is visually standing still. */
export const IDLE_DEADZONE = 0.25
/** Walk→run boundary with hysteresis to prevent gait oscillation. */
export const RUN_THRESHOLD = (WALK_SPEED + RUN_SPEED) / 2
export const RUN_HYSTERESIS = 0.6

export function createMotionState(): CharacterMotionState {
  return {
    locomotion: 'idle',
    speed: 0,
    normalizedSpeed: 0,
    facingAngle: 0,
    grounded: true,
    moving: false,
  }
}

/**
 * Pure gait selector with hysteresis: `wasRunning` biases the boundary so a
 * speed hovering at the threshold doesn't flip walk/run every frame.
 */
export function selectLocomotionRole(
  speed: number,
  wasRunning: boolean,
): 'idle' | 'walk' | 'run' {
  if (speed < IDLE_DEADZONE) return 'idle'
  const threshold = wasRunning ? RUN_THRESHOLD - RUN_HYSTERESIS : RUN_THRESHOLD + RUN_HYSTERESIS
  return speed >= threshold ? 'run' : 'walk'
}

/** Mutates `out` (no per-frame allocation). */
export function updateMotionState(
  out: CharacterMotionState,
  input: {
    speed: number
    facingAngle: number
    driving: boolean
    disabled?: boolean
  },
): CharacterMotionState {
  if (input.disabled) {
    out.locomotion = 'disabled'
    out.speed = 0
    out.normalizedSpeed = 0
    out.moving = false
    return out
  }
  if (input.driving) {
    out.locomotion = 'driving'
    out.speed = input.speed
    out.normalizedSpeed = 0
    out.moving = false
    out.facingAngle = input.facingAngle
    return out
  }
  const role = selectLocomotionRole(input.speed, out.locomotion === 'run')
  out.locomotion = role
  out.speed = input.speed
  out.moving = role !== 'idle'
  out.facingAngle = input.facingAngle
  out.normalizedSpeed =
    role === 'idle'
      ? 0
      : role === 'walk'
        ? Math.min(1, input.speed / WALK_SPEED)
        : Math.min(1, input.speed / RUN_SPEED)
  out.grounded = true
  return out
}

// ---- Player selector -------------------------------------------------

const playerMotion = createMotionState()
let lastPlayerX = 0
let lastPlayerZ = 0
let hasLastPlayer = false
let playerFacing = Math.PI
let smoothedPlayerSpeed = 0

/** Position jumps beyond this are teleports — never animate them as a run. */
export const MOTION_TELEPORT_DISTANCE = 8

/**
 * Render frames and physics ticks don't align perfectly, so a raw dist/dt
 * sample can spike to 2-3× the true speed for a single frame (enough to
 * misread a walk as a run). An ~120ms exponential moving average absorbs
 * the jitter without making gait changes feel laggy.
 */
export const SPEED_SMOOTHING_TAU = 0.12

/** Pure EMA step, framerate-independent via the time constant. */
export function smoothSpeed(previous: number, raw: number, dt: number, tau: number): number {
  if (dt <= 0) return previous
  const alpha = 1 - Math.exp(-dt / tau)
  return previous + (raw - previous) * alpha
}

/**
 * Derives the player's visual motion from authoritative position deltas
 * (covers physics slides, soft-wall deflections, everything) + store mode.
 * `headingRef` comes from the controller so idle keeps the last facing.
 */
export function getPlayerCharacterMotionState(
  dt: number,
  heading: number,
): CharacterMotionState {
  const store = useGameStore.getState()
  const p = registry.playerPosition
  let rawSpeed = 0
  if (hasLastPlayer && dt > 0) {
    const dist = Math.hypot(p.x - lastPlayerX, p.z - lastPlayerZ)
    if (dist > MOTION_TELEPORT_DISTANCE) {
      // Teleports reset cleanly instead of producing one absurd-speed frame.
      smoothedPlayerSpeed = 0
    } else {
      rawSpeed = dist / dt
    }
  }
  lastPlayerX = p.x
  lastPlayerZ = p.z
  hasLastPlayer = true
  playerFacing = heading
  smoothedPlayerSpeed = smoothSpeed(smoothedPlayerSpeed, rawSpeed, dt, SPEED_SMOOTHING_TAU)
  return updateMotionState(playerMotion, {
    speed: smoothedPlayerSpeed,
    facingAngle: playerFacing,
    driving: store.mode === 'driving',
  })
}

export function resetPlayerMotionState(): void {
  hasLastPlayer = false
  smoothedPlayerSpeed = 0
  playerMotion.locomotion = 'idle'
  playerMotion.speed = 0
}

// ---- NPC selector ------------------------------------------------------

/**
 * NPC motion derives from behavior intent (the NPC frame loop publishes
 * walking + speed + heading into its own runtime), not from keyboard state.
 */
export function getNpcCharacterMotionState(
  out: CharacterMotionState,
  npc: { walking: boolean; speed: number; heading: number },
): CharacterMotionState {
  return updateMotionState(out, {
    speed: npc.walking ? npc.speed : 0,
    facingAngle: npc.heading,
    driving: false,
  })
}
