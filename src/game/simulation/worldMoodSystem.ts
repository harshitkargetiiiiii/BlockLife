import type { LightingState, RGB, WorldMood } from '../world/worldTypes'

export function getMood(hour: number): WorldMood {
  if (hour >= 6 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17.5) return 'afternoon'
  if (hour >= 17.5 && hour < 20.5) return 'evening'
  return 'night'
}

export const MOOD_ICONS: Record<WorldMood, string> = {
  morning: '🌅',
  afternoon: '☀️',
  evening: '🌇',
  night: '🌙',
}

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

interface LightKeyframe {
  hour: number
  sky: RGB
  sun: RGB
  sunIntensity: number
  ambient: RGB
  ambientIntensity: number
  hemiIntensity: number
}

// Keyframes over a 24h cycle; values are lerped between neighbors so light
// shifts continuously through morning/afternoon/evening/night.
const KEYFRAMES: LightKeyframe[] = [
  { hour: 0, sky: hex('#111830'), sun: hex('#7d97dd'), sunIntensity: 0.3, ambient: hex('#222c4a'), ambientIntensity: 0.42, hemiIntensity: 0.14 },
  { hour: 5, sky: hex('#19213c'), sun: hex('#7d97dd'), sunIntensity: 0.35, ambient: hex('#283150'), ambientIntensity: 0.44, hemiIntensity: 0.18 },
  { hour: 6.5, sky: hex('#ffd9b0'), sun: hex('#ffbe78'), sunIntensity: 1.7, ambient: hex('#b39ec4'), ambientIntensity: 0.65, hemiIntensity: 0.45 },
  { hour: 9, sky: hex('#bfe3ff'), sun: hex('#fff1d6'), sunIntensity: 2.5, ambient: hex('#cfe0ee'), ambientIntensity: 0.75, hemiIntensity: 0.55 },
  { hour: 13, sky: hex('#a8ddff'), sun: hex('#ffffff'), sunIntensity: 2.9, ambient: hex('#dbe8f2'), ambientIntensity: 0.8, hemiIntensity: 0.6 },
  { hour: 17, sky: hex('#ffd9a3'), sun: hex('#ffcf8a'), sunIntensity: 2.3, ambient: hex('#e6cdb0'), ambientIntensity: 0.7, hemiIntensity: 0.5 },
  { hour: 19, sky: hex('#ff9d6e'), sun: hex('#ff8a4d'), sunIntensity: 1.5, ambient: hex('#c88ba0'), ambientIntensity: 0.62, hemiIntensity: 0.4 },
  { hour: 20.5, sky: hex('#273153'), sun: hex('#8ba0d8'), sunIntensity: 0.45, ambient: hex('#2f3a63'), ambientIntensity: 0.48, hemiIntensity: 0.2 },
  { hour: 24, sky: hex('#111830'), sun: hex('#7d97dd'), sunIntensity: 0.3, ambient: hex('#222c4a'), ambientIntensity: 0.42, hemiIntensity: 0.14 },
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

export function getLightingForHour(hour: number): LightingState {
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1].hour <= h) i++
  const a = KEYFRAMES[i]
  const b = KEYFRAMES[i + 1]
  const span = b.hour - a.hour
  const t = span > 0 ? (h - a.hour) / span : 0
  return {
    skyColor: lerpRGB(a.sky, b.sky, t),
    sunColor: lerpRGB(a.sun, b.sun, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    ambientColor: lerpRGB(a.ambient, b.ambient, t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
  }
}

/** 0 = lamps/windows off (day), 1 = fully glowing (night). Smooth ramps at dusk/dawn. */
export function getLampGlow(hour: number): number {
  const h = ((hour % 24) + 24) % 24
  if (h >= 20 || h < 6) return 1
  if (h >= 19 && h < 20) return h - 19
  if (h >= 6 && h < 7) return 1 - (h - 6)
  return 0
}

/** Directional light position for a given hour: a sun arc by day, a fixed moon at night. */
export function getSunPosition(hour: number): [number, number, number] {
  const h = ((hour % 24) + 24) % 24
  if (h >= 6 && h <= 19) {
    const t = (h - 6) / 13 // 0 at sunrise, 1 at sunset
    const x = Math.cos(t * Math.PI) * 34
    const y = Math.sin(t * Math.PI) * 32 + 8
    return [x, y, 14]
  }
  return [-18, 30, -12] // moon
}
