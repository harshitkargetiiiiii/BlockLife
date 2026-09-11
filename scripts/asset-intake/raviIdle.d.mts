/** Types for the issue #27 Ravi idle derivation, so the contract test can import it directly. */

/** Authored length of the replacement Idle loop, in seconds. */
export declare const IDLE_DURATION: number

export interface RaviIdleArmReport {
  wristRollDeg: number
  palmErrorDegAfter: number
  palmNormalAfter: number[]
  elbowBendBeforeDeg: number
  elbowBendAfterDeg: number
  wristWorldYBefore: number
  wristWorldYAfter: number
  segmentLenDriftUpper: number
  segmentLenDriftFore: number
}

export interface RaviIdleReport {
  clip: { name: string; durationSeconds: number; keys: number; channelsRewritten: number }
  maxLoopEndpointDelta: number
  arms: { left: RaviIdleArmReport; right: RaviIdleArmReport }
}

/**
 * Rewrite ONLY the "Idle" clip of the Wave-0 Ravi at `inPath` and write the derived GLB to
 * `outPath` (which may be the same path). Deterministic: same input bytes -> same output bytes.
 */
export declare function bakeRaviIdle(inPath: string, outPath: string): Promise<RaviIdleReport>
