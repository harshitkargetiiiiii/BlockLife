import { seededRandom } from '../world/materials'
import {
  CONNECTORS,
  INDUSTRIAL,
  RESIDENTIAL,
  ROAD_CENTER,
  ROAD_HALF_WIDTH,
} from '../world/cityLayout'
import type { WeatherKind } from './weatherTypes'

/** A flat elliptical water patch on the asphalt. */
export interface PuddleDef {
  id: string
  position: [number, number] // x, z
  radiusX: number
  radiusZ: number
  rotationY: number
}

const PUDDLE_SEED = 91

interface RoadStrip {
  id: string
  horizontal: boolean
  /** Centerline coordinate (z for horizontal strips, x for vertical). */
  center: number
  halfWidth: number
  from: number
  to: number
  count: number
}

// Every drivable strip in the city gets a few puddles near the gutters.
const STRIPS: RoadStrip[] = [
  { id: 'ring_n', horizontal: true, center: -ROAD_CENTER, halfWidth: ROAD_HALF_WIDTH, from: -27, to: 27, count: 5 },
  { id: 'ring_s', horizontal: true, center: ROAD_CENTER, halfWidth: ROAD_HALF_WIDTH, from: -27, to: 27, count: 5 },
  { id: 'ring_w', horizontal: false, center: -ROAD_CENTER, halfWidth: ROAD_HALF_WIDTH, from: -21, to: 21, count: 4 },
  { id: 'ring_e', horizontal: false, center: ROAD_CENTER, halfWidth: ROAD_HALF_WIDTH, from: -21, to: 21, count: 4 },
  { id: 'res', horizontal: true, center: RESIDENTIAL.roadCenterZ, halfWidth: RESIDENTIAL.roadHalfWidth, from: RESIDENTIAL.roadMinX + 2, to: RESIDENTIAL.roadMaxX - 2, count: 5 },
  { id: 'ind', horizontal: false, center: INDUSTRIAL.roadCenterX, halfWidth: INDUSTRIAL.roadHalfWidth, from: INDUSTRIAL.roadMinZ + 2, to: INDUSTRIAL.roadMaxZ - 2, count: 5 },
  { id: 'conn_n', horizontal: false, center: CONNECTORS.north.centerX, halfWidth: CONNECTORS.north.halfWidth, from: CONNECTORS.north.fromZ + 2, to: CONNECTORS.north.toZ - 2, count: 2 },
  { id: 'conn_e', horizontal: true, center: CONNECTORS.east.centerZ, halfWidth: CONNECTORS.east.halfWidth, from: CONNECTORS.east.fromX + 2, to: CONNECTORS.east.toX - 2, count: 2 },
]

function buildPuddles(): PuddleDef[] {
  const puddles: PuddleDef[] = []
  let n = 0
  for (const strip of STRIPS) {
    for (let i = 0; i < strip.count; i++) {
      n++
      const along =
        strip.from + (strip.to - strip.from) * seededRandom(PUDDLE_SEED + n * 17.3)
      // Bias puddles toward the gutters where water actually collects.
      const side = seededRandom(PUDDLE_SEED + n * 29.7) < 0.5 ? -1 : 1
      const across = strip.center + side * (strip.halfWidth - 1.1)
      const radiusA = 0.7 + seededRandom(PUDDLE_SEED + n * 43.1) * 1.1
      const radiusB = 0.45 + seededRandom(PUDDLE_SEED + n * 57.9) * 0.7
      puddles.push({
        id: `puddle_${strip.id}_${i}`,
        position: strip.horizontal ? [along, across] : [across, along],
        radiusX: strip.horizontal ? radiusA : radiusB,
        radiusZ: strip.horizontal ? radiusB : radiusA,
        rotationY: (seededRandom(PUDDLE_SEED + n * 71.3) - 0.5) * 0.6,
      })
    }
  }
  return puddles
}

/** Deterministic puddle layout — identical every run (visual-test friendly). */
export const PUDDLES: PuddleDef[] = buildPuddles()

/** Covered spots where sheltering citizens wait out the rain. */
export interface ShelterPointDef {
  id: string
  position: [number, number] // x, z
  facing: number
}

export const SHELTER_POINTS: ShelterPointDef[] = [
  { id: 'shelter_shop_awning', position: [-14.5, -17.5], facing: Math.PI }, // under central shop fronts
  { id: 'shelter_bus_stop', position: [19.5, 22.2], facing: 0 }, // south ring bus shelter
  { id: 'shelter_res_porch', position: [-8, -39.5], facing: Math.PI }, // residential porch line
  { id: 'shelter_market_stall', position: [43, 16], facing: Math.PI / 2 }, // industrial market canopy
  // City Expansion v2: one covered spot per new block.
  { id: 'shelter_west_porch', position: [-53.8, 1], facing: Math.PI / 2 }, // west commons porch
  { id: 'shelter_deli_awning', position: [7.6, 52.1], facing: 0 }, // south deli awning
  { id: 'shelter_freight_dock', position: [53.8, -30], facing: -Math.PI / 2 }, // freight dock overhang
]

/** Closest covered spot for a citizen caught in the rain. */
export function getNearestShelter(x: number, z: number): ShelterPointDef {
  let best = SHELTER_POINTS[0]
  let bestDist = Infinity
  for (const s of SHELTER_POINTS) {
    const d = (s.position[0] - x) ** 2 + (s.position[1] - z) ** 2
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return best
}

/** Phone flavor lines per weather (kept short for the home screen). */
export const WEATHER_FLAVOR: Record<WeatherKind, string> = {
  clear: 'Clear skies over the block.',
  cloudy: 'Grey and quiet. Good walking weather.',
  rain: 'Rain on the block — windows are glowing.',
  foggy: 'Fog rolled in. Watch the crossings.',
}
