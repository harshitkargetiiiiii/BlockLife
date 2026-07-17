import {
  BUILDINGS,
  CITY_BOUNDS,
  FOOD_TRUCK,
  getRoadRects,
  JOB_KIOSK,
  PARK,
  PROPS,
} from './cityLayout'
import type { PropDef } from './worldTypes'
import { areVehicleFootprintsOverlapping, type VehicleFootprint } from '../traffic/vehicleObstacles'

/**
 * THE single source of truth for what is solid in the city.
 *
 * Every placed object resolves to one oriented-rectangle footprint here.
 * CityColliders builds the physics cuboids from this table, and
 * validateWorldOccupancy() checks every pair of footprints for overlap —
 * so an object can never be solid in physics but unchecked in placement,
 * or vice versa. Add a prop type: give it a footprint (or explicitly null
 * for flat/wall decals) and both systems pick it up.
 */
// Moved to the leaf module propSolidity.ts (the authoring compiler needs
// the table without importing cityLayout); re-exported for all consumers.
export { PROP_SOLIDITY, type SolidSpec } from './propSolidity'
import { PROP_SOLIDITY } from './propSolidity'

/** A solid object's 2D oriented footprint (shares the traffic OBB math). */
export interface SolidFootprint extends VehicleFootprint {
  source: 'building' | 'prop'
}

function propFootprint(prop: PropDef): SolidFootprint | null {
  const spec = PROP_SOLIDITY[prop.type]
  if (!spec.half) return null
  const [dx, dz] = spec.offset ?? [0, 0]
  return {
    id: prop.id,
    kind: 'ambient',
    source: 'prop',
    position: { x: prop.position[0] + dx, z: prop.position[1] + dz },
    heading: prop.rotationY ?? 0,
    halfWidth: spec.half[0],
    halfLength: spec.half[2],
    speed: 0,
  }
}

/** Every solid footprint in the city: buildings + solid props. */
export function collectSolidFootprints(): SolidFootprint[] {
  const out: SolidFootprint[] = []
  for (const b of BUILDINGS) {
    out.push({
      id: b.id,
      kind: 'ambient',
      source: 'building',
      position: { x: b.position[0], z: b.position[1] },
      heading: 0,
      halfWidth: b.size[0] / 2,
      halfLength: b.size[2] / 2,
      speed: 0,
    })
  }
  for (const p of PROPS) {
    const f = propFootprint(p)
    if (f) out.push(f)
  }
  // Fixed street fixtures with bespoke colliders (matching CityColliders).
  out.push({
    id: FOOD_TRUCK.id,
    kind: 'ambient',
    source: 'prop',
    position: { x: FOOD_TRUCK.position[0] - 0.4, z: FOOD_TRUCK.position[1] },
    heading: 0,
    halfWidth: 2.6,
    halfLength: 1.3,
    speed: 0,
  })
  out.push({
    id: JOB_KIOSK.id,
    kind: 'ambient',
    source: 'prop',
    position: { x: JOB_KIOSK.position[0], z: JOB_KIOSK.position[1] },
    heading: 0,
    halfWidth: 0.3,
    halfLength: 0.9,
    speed: 0,
  })
  // Water is solid for walking purposes — nobody strolls across the pond.
  // (Square approximation of the circle + its sandy bank rim.)
  out.push({
    id: 'park_pond',
    kind: 'ambient',
    source: 'prop',
    position: { x: PARK.pond.center[0], z: PARK.pond.center[1] },
    heading: 0,
    halfWidth: PARK.pond.radius + 0.55,
    halfLength: PARK.pond.radius + 0.55,
    speed: 0,
  })
  return out
}

export interface OccupancyOptions {
  /** Points that must stay clear of every solid footprint. */
  clearPoints?: { id: string; x: number; z: number; clearance: number }[]
  /** Poly-lines (walker routes) that must stay clear along their whole length. */
  clearPaths?: { id: string; points: [number, number][]; loop?: boolean; clearance: number }[]
}

/** Expands paths into sampled clear-points (~1 unit apart) covering segments. */
function samplePath(path: NonNullable<OccupancyOptions['clearPaths']>[number]) {
  const points: { id: string; x: number; z: number; clearance: number }[] = []
  const pts = path.loop ? [...path.points, path.points[0]] : path.points
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 2))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      points.push({
        id: `${path.id} @${(ax + (bx - ax) * t).toFixed(1)},${(az + (bz - az) * t).toFixed(1)}`,
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        clearance: path.clearance,
      })
    }
  }
  return points
}

/**
 * Universal no-phasing check: no two solid footprints overlap, nothing solid
 * sits on driving asphalt (parked vehicles and street furniture belong on
 * curbs), and required-clear points (citizen spawns, walk waypoints) don't
 * start inside anything solid. Returns human-readable problems; empty = the
 * whole city holds proper solid values.
 */
export function validateWorldOccupancy(options: OccupancyOptions = {}): string[] {
  const errors: string[] = []
  const footprints = collectSolidFootprints()
  const roads = getRoadRects()

  // 1. Pairwise solid-vs-solid (skip building-building: covered by the AABB
  //    placement test with exact math; OBB here would agree anyway).
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i]
      const b = footprints[j]
      if (a.source === 'building' && b.source === 'building') continue
      if (areVehicleFootprintsOverlapping(a, b)) {
        errors.push(`${a.id} overlaps ${b.id}`)
      }
    }
  }

  // 2. Solid props must stay off driving asphalt (cones are road furniture
  //    in real life, but ambient cars have no swerve logic — keep them off).
  for (const f of footprints) {
    if (f.source !== 'prop') continue
    for (const r of roads) {
      if (f.position.x > r.minX && f.position.x < r.maxX && f.position.z > r.minZ && f.position.z < r.maxZ) {
        errors.push(`${f.id} sits on ${r.id}`)
      }
    }
  }

  // 3. Nothing solid STRADDLES the boundary walls. Fully-outside objects
  //    (backdrop towers, edge-dressing trees) are unreachable scenery and
  //    allowed; an object half-in half-out would clip the invisible wall.
  for (const f of footprints) {
    if (f.source === 'building') continue
    const r = Math.max(f.halfWidth, f.halfLength)
    const insideX = f.position.x > CITY_BOUNDS.minX && f.position.x < CITY_BOUNDS.maxX
    const insideZ = f.position.z > CITY_BOUNDS.minZ && f.position.z < CITY_BOUNDS.maxZ
    const fullyOutside =
      f.position.x < CITY_BOUNDS.minX - r ||
      f.position.x > CITY_BOUNDS.maxX + r ||
      f.position.z < CITY_BOUNDS.minZ - r ||
      f.position.z > CITY_BOUNDS.maxZ + r
    if (!(insideX && insideZ) && !fullyOutside) {
      errors.push(`${f.id} straddles the city boundary`)
    }
  }

  // 4. Required-clear points (citizen spawns) and full walker routes —
  //    sampled along every segment so a route can't pass THROUGH anything
  //    solid between waypoints.
  const allClearPoints = [
    ...(options.clearPoints ?? []),
    ...(options.clearPaths ?? []).flatMap(samplePath),
  ]
  for (const p of allClearPoints) {
    for (const f of footprints) {
      const probe: VehicleFootprint = {
        id: p.id,
        kind: 'ambient',
        position: { x: p.x, z: p.z },
        heading: 0,
        halfWidth: p.clearance,
        halfLength: p.clearance,
        speed: 0,
      }
      if (areVehicleFootprintsOverlapping(probe, f)) {
        errors.push(`${p.id} starts inside solid ${f.id}`)
      }
    }
  }

  return errors
}
