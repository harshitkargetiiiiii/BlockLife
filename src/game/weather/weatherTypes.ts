export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'foggy'

export const WEATHER_KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'foggy']

export function isWeatherKind(v: unknown): v is WeatherKind {
  return v === 'clear' || v === 'cloudy' || v === 'rain' || v === 'foggy'
}

/**
 * How a weather kind modifies the existing day/night lighting and systems.
 * These MULTIPLY the mood values — weather never replaces the day cycle.
 */
export interface WeatherModifiers {
  /** Multiplier on directional sun/moon intensity. */
  sunFactor: number
  /** Multiplier on ambient + hemisphere intensity. */
  ambientFactor: number
  /** RGB multiplier applied to sky/sun/ambient colors (desaturating tints). */
  skyTint: [number, number, number]
  /** Multiplier on lamp/window/traffic-glow emissives. */
  glowBoost: number
  /** Extra baseline lamp/window glow even in daytime (cozy rain windows). */
  glowFloor: number
  /** FogExp2 density contribution. */
  fogDensity: number
  /** Multiplier on ambient-car cruise speeds. */
  trafficSpeedFactor: number
  /** Target surface wetness while this weather holds. */
  targetWetness: number
  /** Rain particle strength. */
  rainStrength: number
}

export const WEATHER_MODIFIERS: Record<WeatherKind, WeatherModifiers> = {
  clear: {
    sunFactor: 1,
    ambientFactor: 1,
    skyTint: [1, 1, 1],
    glowBoost: 1,
    glowFloor: 0,
    fogDensity: 0,
    trafficSpeedFactor: 1,
    targetWetness: 0,
    rainStrength: 0,
  },
  cloudy: {
    sunFactor: 0.55,
    ambientFactor: 0.88,
    skyTint: [0.82, 0.85, 0.9],
    glowBoost: 1.1,
    glowFloor: 0.08,
    fogDensity: 0.004,
    trafficSpeedFactor: 0.97,
    targetWetness: 0,
    rainStrength: 0,
  },
  rain: {
    sunFactor: 0.32,
    ambientFactor: 0.72,
    skyTint: [0.62, 0.67, 0.78],
    glowBoost: 1.45,
    glowFloor: 0.35,
    fogDensity: 0.007,
    trafficSpeedFactor: 0.84,
    targetWetness: 1,
    rainStrength: 1,
  },
  foggy: {
    sunFactor: 0.45,
    ambientFactor: 0.82,
    skyTint: [0.9, 0.9, 0.87],
    glowBoost: 1.2,
    glowFloor: 0.15,
    fogDensity: 0.028,
    trafficSpeedFactor: 0.9,
    targetWetness: 0.15,
    rainStrength: 0,
  },
}

export const WEATHER_ICONS: Record<WeatherKind, string> = {
  clear: '☀️',
  cloudy: '☁️',
  rain: '🌧️',
  foggy: '🌫️',
}

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  foggy: 'Fog',
}
