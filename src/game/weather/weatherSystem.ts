import {
  WEATHER_MODIFIERS,
  type WeatherKind,
  type WeatherModifiers,
} from './weatherTypes'
import { seededRandom } from '../world/materials'

/**
 * Live weather state. Module singleton mutated by the director each frame —
 * per-frame consumers (lighting, rain, materials, traffic) read it without
 * touching React. The zustand store mirrors only the discrete `kind` for UI.
 */
export interface WeatherRuntime {
  kind: WeatherKind
  /** Kind we're fading toward (equals kind when settled). */
  targetKind: WeatherKind
  /** 0..1 crossfade between kind → targetKind. */
  transition: number
  /** Player-facing strength of the current weather (scales rain/fx). */
  intensity: number
  /** Surface wetness 0..1: rises in rain, drains slowly afterwards. */
  wetness: number
  /** Deterministic seed for the daily schedule. */
  seed: number
  /** True when a player/test forced the weather (auto-schedule pauses). */
  manualOverride: boolean
  /** Last schedule slot seen (day * 10 + slot); -1 = no step taken yet. */
  lastScheduleKey: number
  pauseSeq: number
}

export function createWeatherRuntime(): WeatherRuntime {
  return {
    kind: 'clear',
    targetKind: 'clear',
    transition: 1,
    intensity: 1,
    wetness: 0,
    seed: 7,
    manualOverride: false,
    lastScheduleKey: -1,
    pauseSeq: 0,
  }
}

export const weatherRuntime: WeatherRuntime = createWeatherRuntime()

/** Back to a fresh clear sky (new game / weatherless save). */
export function resetWeatherRuntime(): void {
  Object.assign(weatherRuntime, createWeatherRuntime())
}

/** Crossfade duration between weathers (real seconds). */
export const TRANSITION_SECONDS = 8
/** Wetness rise time in rain / drain time after rain (real seconds). */
export const WETNESS_RISE_SECONDS = 25
export const WETNESS_DRAIN_SECONDS = 70

/**
 * Deterministic daily schedule: four 6-hour slots per day, hashed from
 * (day, slot, seed). Day 1 is always fully clear so a fresh game (and every
 * visual test scene) starts with the classic look.
 */
export function getScheduledWeather(day: number, hour: number, seed: number): WeatherKind {
  if (day <= 1) return 'clear'
  const slot = Math.floor(((hour % 24) + 24) % 24 / 6)
  const r = seededRandom(day * 401 + slot * 89 + seed * 13)
  if (r < 0.45) return 'clear'
  if (r < 0.75) return 'cloudy'
  if (r < 0.93) return 'rain'
  return 'foggy'
}

/** Requests a weather change (smooth by default, instant for tests/loads). */
export function requestWeather(
  runtime: WeatherRuntime,
  kind: WeatherKind,
  options: { instant?: boolean; intensity?: number; manual?: boolean } = {},
): void {
  runtime.intensity = options.intensity ?? 1
  if (options.manual) runtime.manualOverride = true
  if (options.instant) {
    runtime.kind = kind
    runtime.targetKind = kind
    runtime.transition = 1
    runtime.wetness = WEATHER_MODIFIERS[kind].targetWetness
    return
  }
  if (kind === runtime.targetKind) return
  // Re-anchor the fade at the currently blended state.
  runtime.kind = runtime.transition >= 1 ? runtime.targetKind : runtime.kind
  runtime.targetKind = kind
  runtime.transition = 0
}

/**
 * Advances transitions, wetness and the automatic schedule. Pure over its
 * inputs (runtime object + clock values); called by WorldDirector when the
 * world is unpaused, and by the test API's advanceWeather.
 */
export function stepWeather(
  runtime: WeatherRuntime,
  dt: number,
  clock: { day: number; hour: number },
): void {
  // Automatic schedule (suspended after a manual override until next day).
  // The very first step only records the slot — a fresh game or a just-loaded
  // save keeps its current weather until the next slot boundary.
  const slot = Math.floor(((clock.hour % 24) + 24) % 24 / 6)
  const scheduleKey = clock.day * 10 + slot
  if (scheduleKey !== runtime.lastScheduleKey) {
    const firstStep = runtime.lastScheduleKey < 0
    const dayChanged = clock.day !== Math.floor(runtime.lastScheduleKey / 10)
    runtime.lastScheduleKey = scheduleKey
    if (!firstStep) {
      if (dayChanged) runtime.manualOverride = false
      if (!runtime.manualOverride) {
        requestWeather(runtime, getScheduledWeather(clock.day, clock.hour, runtime.seed))
      }
    }
  }

  // Crossfade.
  if (runtime.transition < 1) {
    runtime.transition = Math.min(1, runtime.transition + dt / TRANSITION_SECONDS)
    if (runtime.transition >= 1) runtime.kind = runtime.targetKind
  }

  // Wetness dynamics: rain soaks surfaces, then they slowly dry.
  const blended = getBlendedModifiers(runtime)
  const target = blended.targetWetness * runtime.intensity
  if (target > runtime.wetness) {
    runtime.wetness = Math.min(target, runtime.wetness + dt / WETNESS_RISE_SECONDS)
  } else {
    runtime.wetness = Math.max(target, runtime.wetness - dt / WETNESS_DRAIN_SECONDS)
  }
}

const blendScratch: WeatherModifiers = { ...WEATHER_MODIFIERS.clear, skyTint: [1, 1, 1] }

/** Modifiers crossfaded between the outgoing and incoming weather. */
export function getBlendedModifiers(runtime: WeatherRuntime): WeatherModifiers {
  const from = WEATHER_MODIFIERS[runtime.kind]
  const to = WEATHER_MODIFIERS[runtime.targetKind]
  const t = runtime.transition
  const mix = (a: number, b: number) => a + (b - a) * t
  blendScratch.sunFactor = mix(from.sunFactor, to.sunFactor)
  blendScratch.ambientFactor = mix(from.ambientFactor, to.ambientFactor)
  blendScratch.skyTint[0] = mix(from.skyTint[0], to.skyTint[0])
  blendScratch.skyTint[1] = mix(from.skyTint[1], to.skyTint[1])
  blendScratch.skyTint[2] = mix(from.skyTint[2], to.skyTint[2])
  blendScratch.glowBoost = mix(from.glowBoost, to.glowBoost)
  blendScratch.glowFloor = mix(from.glowFloor, to.glowFloor)
  blendScratch.fogDensity = mix(from.fogDensity, to.fogDensity)
  blendScratch.trafficSpeedFactor = mix(from.trafficSpeedFactor, to.trafficSpeedFactor)
  blendScratch.targetWetness = mix(from.targetWetness, to.targetWetness)
  blendScratch.rainStrength = mix(from.rainStrength, to.rainStrength) * runtime.intensity
  return blendScratch
}

/** Deterministic snap for visual tests: complete fades, settle wetness. */
export function snapWeatherForPause(runtime: WeatherRuntime): void {
  runtime.kind = runtime.targetKind
  runtime.transition = 1
  runtime.wetness = WEATHER_MODIFIERS[runtime.kind].targetWetness * runtime.intensity
}

/** Convenience for traffic and citizens: is it effectively raining? */
export function isRaining(runtime: WeatherRuntime): boolean {
  return getBlendedModifiers(runtime).rainStrength > 0.5
}
