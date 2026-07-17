import type {
  RoadGraph,
  TrafficDestination,
  VehicleRouteMode,
} from './roadGraphTypes'
import { createRng, hashString, pickWeighted, type SeededRng } from './routeRng'

/**
 * Deterministic destination and mode selection. Same routing seed + same
 * vehicle id + same call sequence = same choices, so tests can pin routes
 * while live traffic still reads as varied.
 */

/** Fleet distribution when a car doesn't pin its mode explicitly. */
const MODE_WEIGHTS: [VehicleRouteMode, number][] = [
  ['crossDistrict', 0.5],
  ['localLoop', 0.3],
  ['throughTraffic', 0.2],
]

export function selectRouteMode(routingSeed: number, vehicleId: string): VehicleRouteMode {
  const rng = createRng(hashString(`${routingSeed}:${vehicleId}:mode`))
  const roll = rng()
  let acc = 0
  for (const [mode, weight] of MODE_WEIGHTS) {
    acc += weight
    if (roll < acc) return mode
  }
  return 'crossDistrict'
}

export interface DestinationChoiceContext {
  /** District the vehicle is currently in — usually avoided for variety. */
  currentDistrictId?: string
  /** Recent destinations (newest last) to discourage immediate repeats. */
  lastDestinationIds?: readonly string[]
  mode: VehicleRouteMode
}

/**
 * Weighted destination pick:
 * - throughTraffic cars only choose district exits (they leave the map)
 * - crossDistrict cars prefer other districts and skip recent repeats
 * - falls back gracefully instead of returning null when filters over-prune
 */
export function selectDestination(
  graph: RoadGraph,
  rng: SeededRng,
  context: DestinationChoiceContext,
): TrafficDestination | null {
  const all = [...graph.destinations.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  const wantExit = context.mode === 'throughTraffic'
  let pool = all.filter((d) => (d.kind === 'districtExit') === wantExit)
  if (pool.length === 0) pool = all

  const recent = new Set(context.lastDestinationIds ?? [])
  const withoutRecent = pool.filter((d) => !recent.has(d.id))
  if (withoutRecent.length > 0) pool = withoutRecent

  if (context.currentDistrictId) {
    const crossDistrict = pool.filter((d) => d.districtId !== context.currentDistrictId)
    if (crossDistrict.length > 0) pool = crossDistrict
  }

  return pickWeighted(pool, (d) => d.weight, rng)
}

/** Per-vehicle deterministic RNG stream for destination sequences. */
export function createVehicleRng(routingSeed: number, vehicleId: string): SeededRng {
  return createRng(hashString(`${routingSeed}:${vehicleId}:destinations`))
}
