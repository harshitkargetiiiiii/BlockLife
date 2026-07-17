import type { Vec2 } from '../world/worldTypes'

/** Progression of one citizen's awareness of a crime. */
export type WitnessState =
  | 'unaware'
  | 'noticed'
  | 'startled'
  | 'fleeing'
  | 'reporting'
  | 'reported'
  | 'hiding'
  | 'resuming'

/** Seeded, STABLE per-citizen traits (never Math.random). */
export interface WitnessPersonality {
  courage: number // 0 timid … 1 bold (bold flee less)
  reportProbability: number // base chance a capable witness reports
  panicThreshold: number // severity above which they flee first
  fleeDistance: number // how far they run from the source
  curiosity: number // small chance to approach/look
}

/** A citizen the witness system may evaluate this frame. */
export interface WitnessCandidate {
  id: string
  position: Vec2
  /** Awake, not incapacitated, not deep indoors. */
  capable: boolean
}

/** Environmental modifiers to sight range. */
export interface WitnessContext {
  raining: boolean
  isNight: boolean
}

export type WitnessVerdict = 'saw' | 'heard' | 'none'

/** Crime types loud enough to be reported from HEARING alone (no LOS). */
export const AUDIBLE_REPORTABLE = new Set([
  'weapon_discharge',
  'attacking_police',
  'police_injury',
])
