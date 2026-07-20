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
  /** Person↔person overlap deeper than this (world units) is material, not a graze. */
  overlapTolerance?: number
  /** Person↔vehicle/solid: flag only when depth exceeds this (centre inside). */
  embedTolerance?: number
  cellSize?: number
}

const DEFAULT_TOLERANCE = 0.08
/** Person↔vehicle/solid: flag only when the centre is inside (depth > radius). */
const EMBED_TOLERANCE = 0.4

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
  // Person↔vehicle/solid use a larger tolerance: a body grazing a car or a
  // wall/door/curb (centre outside → depth ≤ the person radius) is tolerated, so
  // only a person whose CENTRE is inside (genuine embedding) is flagged. This
  // matches the live occupancy clamp (personOccupancy), so grazing is never
  // treated as corruption on either side.
  const embedTol = opts.embedTolerance ?? EMBED_TOLERANCE
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
      if (depth > embedTol) {
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
      if (depth > embedTol) {
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

// ---- traffic stall / honk-loop scan --------------------------------------

/** Minimal per-car view the traffic scan needs (a `CarRuntime` satisfies it). */
export interface TrafficCarView {
  id: string
  x: number
  z: number
  /** Seconds obstructed by a ROAD-BLOCKER (person / driven car). Resets to 0 on
   *  signal, queue and crosswalk waits — so a red light never accumulates it. */
  blockedTime: number
  reason?: string
}

export interface TrafficScanOptions {
  /** blockedTime past this (s) → a stall the staged recovery hasn't cleared. */
  blockedStallSeconds?: number
  /** blockedTime past this (s) → an endless honk loop (≥ a few honk cycles). */
  honkLoopSeconds?: number
}

/** A car obstructed this long has outlived the staged recovery — a real stall. */
export const DEFAULT_BLOCKED_STALL_SECONDS = 10
/** honkCooldown≈6s, honkAfterBlocked≈2.5s → past ~20s the car has honked ≥3×. */
export const DEFAULT_HONK_LOOP_SECONDS = 20

/**
 * Detect a car stuck behind a road-blocker far longer than the staged traffic
 * recovery should take (`traffic_blocked`), escalating to `honk_loop` once it has
 * been stuck long enough to have cycled its honk several times — an "endless
 * blocked / honking" pileup. Pure + observe-only: `blockedTime` already excludes
 * legitimate signal/queue/crosswalk waits, so this never flags a normal red.
 */
export function scanTrafficAnomalies(
  cars: Iterable<TrafficCarView>,
  opts: TrafficScanOptions = {},
): RawAnomaly[] {
  const stall = opts.blockedStallSeconds ?? DEFAULT_BLOCKED_STALL_SECONDS
  const loop = opts.honkLoopSeconds ?? DEFAULT_HONK_LOOP_SECONDS
  const out: RawAnomaly[] = []
  for (const c of cars) {
    if (c.blockedTime <= stall) continue
    out.push({
      type: 'traffic_blocked',
      severity: 'warning',
      entityIds: [c.id],
      sectorId: null,
      x: c.x,
      z: c.z,
      depth: c.blockedTime,
      detail: c.reason,
    })
    // Escalation emitted ALONGSIDE the stall (not instead of it), so the stall
    // record stays continuously sustained while the loop signal layers on top.
    if (c.blockedTime > loop) {
      out.push({
        type: 'honk_loop',
        severity: 'warning',
        entityIds: [c.id],
        sectorId: null,
        x: c.x,
        z: c.z,
        depth: c.blockedTime,
        detail: c.reason,
      })
    }
  }
  return out
}

// ---- streaming safety-ring scan ------------------------------------------

/** Snapshot of the player safety ring the streaming anomaly scan reads. */
export interface StreamingSafetySnapshot {
  /** True when every required (current + entering) sector is gameplay-ready. */
  covered: boolean
  /** Required sector ids NOT ready this frame (the coverage gap). */
  notReady: readonly string[]
  /** True when the soft backstop clamped a boundary crossing this frame. */
  backstopActive: boolean
  /** Required sector ids the watchdog force-reloaded (wedged in loading). */
  healed: readonly string[]
}

/**
 * Surface the streaming safety-ring diagnostics (issue §6): a coverage gap
 * around the active subject (`player_outside_coverage`) and any required sector
 * the watchdog had to force-reload (`sector_stuck_loading`). Observe-only — the
 * safety ring itself owns correction (prewarm + soft clamp + self-heal). A
 * transient gap during normal streaming resolves within a scan or two; only a
 * SUSTAINED gap (readiness truly behind) is a real problem, which the tracker's
 * duration threshold separates out.
 */
export function scanStreamingAnomalies(snap: StreamingSafetySnapshot | null): RawAnomaly[] {
  if (!snap) return []
  const out: RawAnomaly[] = []
  if (!snap.covered) {
    out.push({
      type: 'player_outside_coverage',
      severity: 'error',
      entityIds: snap.notReady.length > 0 ? [...snap.notReady] : ['player'],
      sectorId: snap.notReady[0] ?? null,
      detail: snap.backstopActive ? 'backstop_clamping' : 'coverage_gap',
    })
  }
  for (const id of snap.healed) {
    out.push({
      type: 'sector_stuck_loading',
      severity: 'error',
      entityIds: [id],
      sectorId: id,
      detail: 'watchdog_self_heal',
    })
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
