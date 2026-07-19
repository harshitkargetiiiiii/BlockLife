/**
 * Runtime anomaly detection (issue §10) — OBSERVE ONLY. Pure overlap scans over
 * an entity-registry snapshot plus a stateful tracker that separates transient
 * contact (tolerated) from sustained corruption (reported). Spatially indexed so
 * it never does an all-pairs O(n²) pass over the whole city.
 *
 * The detector never mutates entities and never throws into the frame loop —
 * callers wrap `scan` in a try/catch and downgrade failures to diagnostics.
 */
import {
  type EntityDescriptor,
  type OrientedBox2D,
  hasCapability,
  isPersonKind,
  isVehicleKind,
} from './entityTypes'
import { pushCircleOutOfAabb, pushCircleOutOfOrientedBox } from './occupancy'
import { SpatialHash } from './spatialHash'
import { type AnomalyRecord, type RawAnomaly, anomalyKey } from './anomalyTypes'

export const MAX_ANOMALY_RECORDS = 256
/** ~8 scans at the 4 Hz cadence ≈ 2s of persistence before "sustained". */
export const DEFAULT_SUSTAINED_TICKS = 8

export interface OccupancyScanOptions {
  /** Overlap deeper than this (world units) is material, not a graze. */
  overlapTolerance?: number
  cellSize?: number
}

const DEFAULT_TOLERANCE = 0.08

// ---- pure geometry -------------------------------------------------------

/** Overlap depth of a circle inside an AABB (0 = no overlap). */
export function circleAabbDepth(x: number, z: number, r: number, b: EntityDescriptor['footprint']): number {
  if (!b) return 0
  const [px, pz] = pushCircleOutOfAabb(x, z, r, b)
  return Math.hypot(px - x, pz - z)
}

/** Overlap depth of a circle inside an oriented box (0 = no overlap). */
export function circleOrientedDepth(x: number, z: number, r: number, box: OrientedBox2D): number {
  const [px, pz] = pushCircleOutOfOrientedBox(x, z, r, box)
  return Math.hypot(px - x, pz - z)
}

function orientedCorners(b: OrientedBox2D): [number, number][] {
  const c = Math.cos(b.headingY)
  const s = Math.sin(b.headingY)
  const fx = s * b.halfLength
  const fz = c * b.halfLength
  const rx = c * b.halfWidth
  const rz = -s * b.halfWidth
  return [
    [b.x + fx + rx, b.z + fz + rz],
    [b.x + fx - rx, b.z + fz - rz],
    [b.x - fx + rx, b.z - fz + rz],
    [b.x - fx - rx, b.z - fz - rz],
  ]
}

function overlapOnAxis(a: [number, number][], b: [number, number][], ax: number, az: number): boolean {
  let minA = Infinity
  let maxA = -Infinity
  let minB = Infinity
  let maxB = -Infinity
  for (const [x, z] of a) {
    const p = x * ax + z * az
    if (p < minA) minA = p
    if (p > maxA) maxA = p
  }
  for (const [x, z] of b) {
    const p = x * ax + z * az
    if (p < minB) minB = p
    if (p > maxB) maxB = p
  }
  return !(maxA < minB || maxB < minA)
}

/** Separating-axis test for two oriented boxes (with a small slack margin). */
export function orientedBoxesOverlap(a: OrientedBox2D, b: OrientedBox2D, slack = 0.05): boolean {
  const shrink = (box: OrientedBox2D): OrientedBox2D => ({
    ...box,
    halfLength: Math.max(0, box.halfLength - slack),
    halfWidth: Math.max(0, box.halfWidth - slack),
  })
  const ca = orientedCorners(shrink(a))
  const cb = orientedCorners(shrink(b))
  const axes: [number, number][] = [
    [Math.sin(a.headingY), Math.cos(a.headingY)],
    [Math.cos(a.headingY), -Math.sin(a.headingY)],
    [Math.sin(b.headingY), Math.cos(b.headingY)],
    [Math.cos(b.headingY), -Math.sin(b.headingY)],
  ]
  for (const [ax, az] of axes) if (!overlapOnAxis(ca, cb, ax, az)) return false
  return true
}

// ---- occupancy scan ------------------------------------------------------

/** Detect person↔person / person↔vehicle / person↔solid / vehicle↔vehicle overlaps. */
export function scanOccupancyAnomalies(
  entities: readonly EntityDescriptor[],
  opts: OccupancyScanOptions = {},
): RawAnomaly[] {
  const tol = opts.overlapTolerance ?? DEFAULT_TOLERANCE
  const cell = opts.cellSize ?? 4
  const people = entities.filter((e) => isPersonKind(e.kind) && e.radius != null)
  const vehicles = entities.filter((e) => isVehicleKind(e.kind) && e.oriented != null)
  const solids = entities.filter(
    (e) => (e.kind === 'building' || e.kind === 'prop') && e.footprint != null && hasCapability(e, 'solid'),
  )
  const out: RawAnomaly[] = []

  // person ↔ person (spatial hash, each pair once)
  const peopleHash = new SpatialHash(cell)
  for (const p of people) peopleHash.insert(p.id, p.x, p.z)
  const scratch: { id: string; x: number; z: number }[] = []
  const byId = new Map(people.map((p) => [p.id, p]))
  for (const p of people) {
    const r = p.radius ?? 0.35
    peopleHash.queryNeighbours(p.x, p.z, r + 0.8, p.id, scratch)
    for (const n of scratch) {
      if (n.id <= p.id) continue // each pair once (id order)
      const other = byId.get(n.id)
      if (!other) continue
      const minDist = r + (other.radius ?? 0.35)
      const d = Math.hypot(p.x - other.x, p.z - other.z)
      const depth = minDist - d
      if (depth > tol) {
        out.push({
          type: 'person_person_overlap',
          severity: 'error',
          entityIds: [p.id, other.id],
          sectorId: p.sectorId,
          x: (p.x + other.x) / 2,
          z: (p.z + other.z) / 2,
          depth,
        })
      }
    }
  }

  // person ↔ vehicle
  const vehHash = new SpatialHash(cell)
  for (const v of vehicles) vehHash.insert(v.id, v.x, v.z)
  const vehById = new Map(vehicles.map((v) => [v.id, v]))
  for (const p of people) {
    const r = p.radius ?? 0.35
    vehHash.queryNeighbours(p.x, p.z, r + 4, undefined, scratch)
    for (const n of scratch) {
      const v = vehById.get(n.id)
      if (!v?.oriented) continue
      const depth = circleOrientedDepth(p.x, p.z, r, v.oriented)
      if (depth > tol) {
        out.push({
          type: 'person_vehicle_overlap',
          severity: 'error',
          entityIds: [p.id, v.id],
          sectorId: p.sectorId,
          x: p.x,
          z: p.z,
          depth,
        })
      }
    }
  }

  // person ↔ solid
  const solidHash = new SpatialHash(cell)
  for (const s of solids) solidHash.insert(s.id, s.x, s.z)
  const solidById = new Map(solids.map((s) => [s.id, s]))
  for (const p of people) {
    const r = p.radius ?? 0.35
    solidHash.queryNeighbours(p.x, p.z, r + 6, undefined, scratch)
    for (const n of scratch) {
      const s = solidById.get(n.id)
      if (!s?.footprint) continue
      const depth = circleAabbDepth(p.x, p.z, r, s.footprint)
      if (depth > tol) {
        out.push({
          type: 'person_solid_overlap',
          severity: 'error',
          entityIds: [p.id, s.id],
          sectorId: p.sectorId,
          x: p.x,
          z: p.z,
          depth,
        })
      }
    }
  }

  // vehicle ↔ vehicle (oriented SAT, each pair once)
  for (const v of vehicles) {
    if (!v.oriented) continue
    vehHash.queryNeighbours(v.x, v.z, 8, v.id, scratch)
    for (const n of scratch) {
      if (n.id <= v.id) continue
      const other = vehById.get(n.id)
      if (!other?.oriented) continue
      if (orientedBoxesOverlap(v.oriented, other.oriented)) {
        out.push({
          type: 'vehicle_vehicle_overlap',
          severity: 'error',
          entityIds: [v.id, other.id],
          sectorId: v.sectorId,
          x: (v.x + other.x) / 2,
          z: (v.z + other.z) / 2,
        })
      }
    }
  }

  return out
}

// ---- stateful tracker ----------------------------------------------------

/**
 * Tracks raw detections across scans: consecutive-tick duration (transient vs
 * sustained), dedup by key, bounded record set. A record is dropped the tick its
 * overlap resolves, so `getActive` reflects the live world.
 */
export class AnomalyTracker {
  private active = new Map<string, AnomalyRecord>()
  private tick = 0
  private droppedForBound = 0

  ingest(raw: readonly RawAnomaly[]): void {
    this.tick++
    const seen = new Set<string>()
    for (const r of raw) {
      const key = anomalyKey(r)
      if (seen.has(key)) continue
      seen.add(key)
      const existing = this.active.get(key)
      if (existing) {
        existing.durationTicks = existing.lastSeenTick === this.tick - 1 ? existing.durationTicks + 1 : 1
        existing.lastSeenTick = this.tick
        existing.observations++
        existing.depth = r.depth
        existing.x = r.x
        existing.z = r.z
      } else {
        if (this.active.size >= MAX_ANOMALY_RECORDS) {
          this.droppedForBound++
          continue
        }
        this.active.set(key, {
          ...r,
          key,
          firstSeenTick: this.tick,
          lastSeenTick: this.tick,
          durationTicks: 1,
          observations: 1,
        })
      }
    }
    // Drop records whose overlap resolved this tick.
    for (const [key, rec] of this.active) {
      if (rec.lastSeenTick < this.tick) this.active.delete(key)
    }
  }

  /** All currently-overlapping records, deterministic (key order). */
  getActive(): AnomalyRecord[] {
    return [...this.active.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }

  /** Only records that have persisted past the sustained threshold. */
  getSustained(threshold = DEFAULT_SUSTAINED_TICKS): AnomalyRecord[] {
    return this.getActive().filter((r) => r.durationTicks >= threshold)
  }

  get tickCount(): number {
    return this.tick
  }

  get boundedDrops(): number {
    return this.droppedForBound
  }

  clear(): void {
    this.active.clear()
    this.tick = 0
    this.droppedForBound = 0
  }
}
