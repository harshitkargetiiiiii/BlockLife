import type {
  OccluderDescriptor,
  OcclusionState,
  VisibilitySubject,
} from './visibilityTypes'
import { clipSegmentToRect, type CameraPoint } from './occlusionBroadPhase'

/**
 * Precise phase: exact analytic occlusion for an orthographic diorama.
 *
 * For each subject sample point we trace the 3D segment toward the camera.
 * The occluder blocks that sample iff the segment's ground-plane projection
 * crosses the footprint AND the segment's height while inside the footprint
 * dips into the occluder's [minY, maxY] band. Height along the segment is
 * linear, so the test reduces to two endpoint evaluations — no raycasting,
 * no mesh access, fully deterministic.
 */

/** Padding for the precise test — roughly the subject's readable half-width. */
export const PRECISE_PADDING = 0.35

/** Hysteresis: occlusion must persist this long before fading begins. */
export const OCCLUDE_DELAY_SECONDS = 0.12
/** …and clearance must persist this long before restoring begins. */
export const CLEAR_DELAY_SECONDS = 0.3

export function countBlockedSamples(
  camera: CameraPoint,
  subject: VisibilitySubject,
  occ: OccluderDescriptor,
): number {
  const span = clipSegmentToRect(
    subject.x,
    subject.z,
    camera.x,
    camera.z,
    occ.bounds2D,
    PRECISE_PADDING,
  )
  if (!span) return 0
  const [t0, t1] = span
  let blocked = 0
  for (const h of subject.sampleHeights) {
    const y = subject.groundY + h
    // Height of the sight line at the entry/exit of the footprint.
    const yEnter = y + (camera.y - y) * t0
    const yExit = y + (camera.y - y) * t1
    const yMin = Math.min(yEnter, yExit)
    const yMax = Math.max(yEnter, yExit)
    // The line passes through the occluder's vertical band somewhere inside
    // the footprint iff the [yMin, yMax] range overlaps [minY, maxY].
    if (yMax > occ.minY && yMin < occ.maxY) blocked++
  }
  return blocked
}

/** True when enough of the subject is hidden to warrant a fade. */
export function isMeaningfullyOccluded(
  camera: CameraPoint,
  subject: VisibilitySubject,
  occ: OccluderDescriptor,
): boolean {
  return countBlockedSamples(camera, subject, occ) >= subject.minBlockedSamples
}

export function createOcclusionState(): OcclusionState {
  return {
    targetOpacity: 1,
    currentOpacity: 1,
    occludedSince: null,
    clearSince: null,
    reason: 'clear',
    blockedSamples: 0,
  }
}

/**
 * Advances one occluder's hysteresis + fade interpolation. Pure over its
 * inputs; mutates `state` in place (runtime registry object, not React).
 */
export function stepOcclusionState(
  state: OcclusionState,
  occludedNow: boolean,
  blockedSamples: number,
  occ: Pick<OccluderDescriptor, 'minimumOpacity' | 'fadeSpeed' | 'restoreSpeed'>,
  now: number,
  dt: number,
): void {
  state.blockedSamples = blockedSamples
  if (occludedNow) {
    state.clearSince = null
    if (state.occludedSince === null) state.occludedSince = now
    // Begin fading only once occlusion has persisted (edge-flicker guard).
    if (now - state.occludedSince >= OCCLUDE_DELAY_SECONDS) {
      state.targetOpacity = occ.minimumOpacity
      state.reason = `occluded (${blockedSamples} samples)`
    }
  } else {
    state.occludedSince = null
    if (state.clearSince === null) state.clearSince = now
    if (now - state.clearSince >= CLEAR_DELAY_SECONDS) {
      state.targetOpacity = 1
      state.reason = 'clear'
    }
  }

  // Interpolate: fast out, slower back.
  const rate = state.targetOpacity < state.currentOpacity ? occ.fadeSpeed : occ.restoreSpeed
  const delta = state.targetOpacity - state.currentOpacity
  if (delta !== 0) {
    const step = rate * dt
    state.currentOpacity =
      Math.abs(delta) <= step ? state.targetOpacity : state.currentOpacity + Math.sign(delta) * step
  }
}

/** Snap the state to its resolved target (teleports, pause determinism). */
export function snapOcclusionState(state: OcclusionState): void {
  state.currentOpacity = state.targetOpacity
}

/** Hard-reset to fully visible (teleport/apartment/save-load). */
export function resetOcclusionState(state: OcclusionState): void {
  state.targetOpacity = 1
  state.currentOpacity = 1
  state.occludedSince = null
  state.clearSince = null
  state.reason = 'clear'
  state.blockedSamples = 0
}
