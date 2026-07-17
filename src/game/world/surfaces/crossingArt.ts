import type { Vec2 } from '../worldTypes'
import { INTERSECTIONS } from '../../traffic/intersections/intersectionRegistry'
import { WALK_CROSSINGS } from '../../traffic/walkCrossings'
import { getRoadRects } from '../cityLayout'

/**
 * Crosswalk Surface Art & Curb Furniture v1: every registered crossing
 * (Harbor Cross's four signalized crossings + the painted walk-crossings)
 * compiles ONCE into a visual spec — zebra stripes, curb ramps, tactile
 * pads and waiting furniture — derived entirely from the crossing
 * registries. No coordinates are duplicated; behavior is untouched: this
 * layer only makes the legal crossings legible.
 */

export interface CrosswalkVisualSpec {
  crossingId: string
  zoneId: string
  kind: 'signalized' | 'unsignalized'
  center: Vec2
  /** Pedestrian travel axis (the long axis of the band). */
  axis: 'x' | 'z'
  /** Band thickness along vehicle travel. */
  width: number
  /** Band length across the road (pedestrian travel). */
  span: number
  curbAnchors: [Vec2, Vec2]
  signalGroupId?: string
  sectorIds: string[]
  sourceRef: { sectorId: string; sourceId: string; derivation: string }
}

export interface CrossingStripe {
  id: string
  x: number
  z: number
  /** Plane size [x, z]. */
  w: number
  d: number
  material: 'stripe' | 'wornStripe'
}

export interface CrossingPad {
  id: string
  kind: 'curbRamp' | 'tactile'
  x: number
  z: number
  w: number
  d: number
}

export interface CrossingFurniture {
  id: string
  kind: 'signalPost' | 'unsignaledPost'
  position: Vec2
  /** For signalized posts: the intersection whose clock drives the head. */
  intersectionId?: string
}

export interface CompiledCrossingArt {
  spec: CrosswalkVisualSpec
  stripes: CrossingStripe[]
  pads: CrossingPad[]
  furniture: CrossingFurniture[]
}

function sectorOf(id: string): string {
  const m = id.match(/^(s-?\d+_-?\d+)_/)
  return m ? m[1] : 's0_0'
}

function buildSpecs(): CrosswalkVisualSpec[] {
  const specs: CrosswalkVisualSpec[] = []
  for (const x of INTERSECTIONS) {
    for (const c of x.crossings) {
      const axis: 'x' | 'z' = c.halfExtents[0] > c.halfExtents[1] ? 'x' : 'z'
      specs.push({
        crossingId: c.id,
        zoneId: c.id,
        kind: 'signalized',
        center: c.center,
        axis,
        width: 2 * Math.min(c.halfExtents[0], c.halfExtents[1]),
        span: 2 * Math.max(c.halfExtents[0], c.halfExtents[1]),
        curbAnchors: c.waitSpots,
        signalGroupId: c.arm,
        sectorIds: [sectorOf(c.id)],
        sourceRef: { sectorId: sectorOf(c.id), sourceId: x.id, derivation: 'intersection crossing' },
      })
    }
  }
  for (const c of WALK_CROSSINGS) {
    const axis: 'x' | 'z' = c.halfExtents[0] > c.halfExtents[1] ? 'x' : 'z'
    specs.push({
      crossingId: c.id,
      zoneId: c.id,
      kind: 'unsignalized',
      center: c.center,
      axis,
      width: 2 * Math.min(c.halfExtents[0], c.halfExtents[1]),
      span: 2 * Math.max(c.halfExtents[0], c.halfExtents[1]),
      curbAnchors: c.waitSpots,
      sectorIds: [sectorOf(c.id)],
      sourceRef: { sectorId: sectorOf(c.id), sourceId: c.roadId, derivation: 'road walk-crossing' },
    })
  }
  return specs
}

export const CROSSWALK_VISUAL_SPECS: CrosswalkVisualSpec[] = buildSpecs()

/**
 * Zebra stripes: bars perpendicular to pedestrian travel, elongated along
 * vehicle travel, kept a half-step inside the band so nothing pokes past
 * the zone (or behind a stop line). Signalized crossings get the full
 * high-contrast ladder; unsignalized ones get a sparser pattern with edge
 * bars. Every 3rd bar is 'worn' for texture — deterministic by index.
 */
function compileStripes(spec: CrosswalkVisualSpec): CrossingStripe[] {
  const stripes: CrossingStripe[] = []
  const spacing = spec.kind === 'signalized' ? 0.95 : 1.7
  const barThickness = 0.5
  const barLength = spec.width - 0.4
  // Stripes only cover the ROADWAY portion of the span (the band pokes a
  // step into each sidewalk for the ramps — paint stays off the curb).
  const paintSpan = spec.span - 2.4
  const count = Math.max(3, Math.floor(paintSpan / spacing))
  for (let i = 0; i < count; i++) {
    const offset = -paintSpan / 2 + spacing / 2 + i * spacing
    const along = spec.axis === 'x' ? [spec.center[0] + offset, spec.center[1]] : [spec.center[0], spec.center[1] + offset]
    stripes.push({
      id: `${spec.crossingId}_bar_${i}`,
      x: along[0],
      z: along[1],
      w: spec.axis === 'x' ? barThickness : barLength,
      d: spec.axis === 'x' ? barLength : barThickness,
      material: spec.kind === 'signalized' && i % 3 === 2 ? 'wornStripe' : 'stripe',
    })
  }
  if (spec.kind === 'unsignalized') {
    // Paired edge bars along the band edges make the sparse ladder read as
    // a marked crossing rather than stray paint.
    const edgeOffset = spec.width / 2 - 0.35
    for (const [side, name] of [[-1, 'edge_a'], [1, 'edge_b']] as const) {
      stripes.push({
        id: `${spec.crossingId}_${name}`,
        x: spec.axis === 'x' ? spec.center[0] : spec.center[0] + side * edgeOffset,
        z: spec.axis === 'x' ? spec.center[1] + side * edgeOffset : spec.center[1],
        w: spec.axis === 'x' ? paintSpan : 0.22,
        d: spec.axis === 'x' ? 0.22 : paintSpan,
        material: 'stripe',
      })
    }
  }
  return stripes
}

/** Curb ramp + tactile pad at each curb anchor, facing the crossing. */
function compilePads(spec: CrosswalkVisualSpec): CrossingPad[] {
  const pads: CrossingPad[] = []
  spec.curbAnchors.forEach((anchor, i) => {
    const towardCenter: Vec2 = [
      Math.sign(spec.center[0] - anchor[0]),
      Math.sign(spec.center[1] - anchor[1]),
    ]
    // Tactile pad right at the curb anchor; ramp one step toward the road,
    // still on the sidewalk band (the paint span stops 1.2 short of it).
    const alongX = spec.axis === 'x'
    pads.push({
      id: `${spec.crossingId}_tactile_${i}`,
      kind: 'tactile',
      x: anchor[0],
      z: anchor[1],
      w: alongX ? 0.7 : 1.7,
      d: alongX ? 1.7 : 0.7,
    })
    pads.push({
      id: `${spec.crossingId}_ramp_${i}`,
      kind: 'curbRamp',
      x: anchor[0] + towardCenter[0] * (alongX ? 0.9 : 0),
      z: anchor[1] + towardCenter[1] * (alongX ? 0 : 0.9),
      w: alongX ? 1.1 : 2.1,
      d: alongX ? 2.1 : 1.1,
    })
  })
  return pads
}

/**
 * Waiting furniture: a pedestrian signal post (live walk/dont-walk head)
 * beside each curb anchor of a signalized crossing; a static crossing sign
 * for unsignalized ones. Posts sit a side-step off the pedestrian path so
 * they never overlap queued citizens or the crossing itself.
 */
function compileFurniture(spec: CrosswalkVisualSpec): CrossingFurniture[] {
  const out: CrossingFurniture[] = []
  const intersectionId = spec.kind === 'signalized' ? spec.crossingId.replace(/_cross_(north|south|east|west)$/, '') : undefined
  spec.curbAnchors.forEach((anchor, i) => {
    // Perpendicular side-step (off the walking line), away from the box.
    const side = i === 0 ? -1 : 1
    const position: Vec2 =
      spec.axis === 'x'
        ? [anchor[0] + side * 0.4, anchor[1] + (anchor[1] > spec.center[1] ? 1.1 : -1.1)]
        : [anchor[0] + (anchor[0] > spec.center[0] ? 1.1 : -1.1), anchor[1] + side * 0.4]
    out.push({
      id: `${spec.crossingId}_post_${i}`,
      kind: spec.kind === 'signalized' ? 'signalPost' : 'unsignaledPost',
      position,
      intersectionId,
    })
  })
  return out
}

export const CROSSING_ART: CompiledCrossingArt[] = CROSSWALK_VISUAL_SPECS.map((spec) => ({
  spec,
  stripes: compileStripes(spec),
  pads: compilePads(spec),
  furniture: compileFurniture(spec),
}))

const ART_BY_SECTOR = new Map<string, CompiledCrossingArt[]>()
for (const art of CROSSING_ART) {
  for (const sectorId of art.spec.sectorIds) {
    if (!ART_BY_SECTOR.has(sectorId)) ART_BY_SECTOR.set(sectorId, [])
    ART_BY_SECTOR.get(sectorId)!.push(art)
  }
}

export function getCrossingArtForSector(sectorId: string): CompiledCrossingArt[] {
  return ART_BY_SECTOR.get(sectorId) ?? []
}

export function getCrossingArt(crossingId: string): CompiledCrossingArt | undefined {
  return CROSSING_ART.find((a) => a.spec.crossingId === crossingId)
}

// ---------------------------------------------------------------------------
// Validation (unit suite).
// ---------------------------------------------------------------------------

export function validateCrossingArt(): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const roads = getRoadRects()
  const zoneIds = new Set([
    ...INTERSECTIONS.flatMap((x) => x.crossings.map((c) => c.id)),
    ...WALK_CROSSINGS.map((c) => c.id),
  ])
  for (const art of CROSSING_ART) {
    const { spec } = art
    const where = `${spec.crossingId} (${spec.sourceRef.sourceId})`
    if (!zoneIds.has(spec.zoneId)) errors.push(`${where}: visual spec resolves no CrosswalkZone`)
    if (!spec.sourceRef.sourceId) errors.push(`${where}: missing source ref`)
    const bounds = {
      minX: spec.center[0] - (spec.axis === 'x' ? spec.span : spec.width) / 2 - 0.01,
      maxX: spec.center[0] + (spec.axis === 'x' ? spec.span : spec.width) / 2 + 0.01,
      minZ: spec.center[1] - (spec.axis === 'x' ? spec.width : spec.span) / 2 - 0.01,
      maxZ: spec.center[1] + (spec.axis === 'x' ? spec.width : spec.span) / 2 + 0.01,
    }
    for (const s of art.stripes) {
      if (ids.has(s.id)) errors.push(`${where}: duplicate detail id ${s.id}`)
      ids.add(s.id)
      if (
        s.x - s.w / 2 < bounds.minX ||
        s.x + s.w / 2 > bounds.maxX ||
        s.z - s.d / 2 < bounds.minZ ||
        s.z + s.d / 2 > bounds.maxZ
      ) {
        errors.push(`${where}: stripe ${s.id} leaves the crossing bounds`)
      }
      // Bars must be elongated along VEHICLE travel (perpendicular to the
      // pedestrian axis) — except the unsignalized edge bars.
      if (!s.id.includes('edge')) {
        const elongatedAlongVehicle = spec.axis === 'x' ? s.d > s.w : s.w > s.d
        if (!elongatedAlongVehicle) errors.push(`${where}: stripe ${s.id} runs the wrong way`)
      }
    }
    for (const p of art.pads) {
      if (ids.has(p.id)) errors.push(`${where}: duplicate detail id ${p.id}`)
      ids.add(p.id)
      // Tactile pads stay OUTSIDE the roadway.
      if (p.kind === 'tactile') {
        for (const r of roads) {
          if (p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ) {
            errors.push(`${where}: tactile pad ${p.id} sits on roadway ${r.id}`)
          }
        }
        const anchor = spec.curbAnchors.some(
          (a) => Math.hypot(a[0] - p.x, a[1] - p.z) < 0.01,
        )
        if (!anchor) errors.push(`${where}: tactile pad ${p.id} is off its curb anchor`)
      }
    }
    for (const f of art.furniture) {
      if (ids.has(f.id)) errors.push(`${where}: duplicate detail id ${f.id}`)
      ids.add(f.id)
      for (const r of roads) {
        if (f.position[0] > r.minX && f.position[0] < r.maxX && f.position[1] > r.minZ && f.position[1] < r.maxZ) {
          errors.push(`${where}: post ${f.id} stands on roadway ${r.id}`)
        }
      }
      if (
        f.position[0] > bounds.minX && f.position[0] < bounds.maxX &&
        f.position[1] > bounds.minZ && f.position[1] < bounds.maxZ
      ) {
        errors.push(`${where}: post ${f.id} stands inside the crossing`)
      }
      for (const a of spec.curbAnchors) {
        if (Math.hypot(a[0] - f.position[0], a[1] - f.position[1]) < 0.8) {
          errors.push(`${where}: post ${f.id} crowds a waiting anchor`)
        }
      }
      if (f.kind === 'signalPost' && spec.kind !== 'signalized') {
        errors.push(`${where}: signal head on an unsignalized crossing`)
      }
      if (f.kind === 'signalPost' && !f.intersectionId) {
        errors.push(`${where}: signal post ${f.id} has no intersection`)
      }
    }
  }
  // Stop lines stay BEHIND every signalized crossing band (regression:
  // they once sat inside it).
  for (const x of INTERSECTIONS) {
    for (const line of x.stopLines) {
      for (const c of x.crossings) {
        if (
          Math.abs(line.position[0] - c.center[0]) < c.halfExtents[0] &&
          Math.abs(line.position[1] - c.center[1]) < c.halfExtents[1]
        ) {
          errors.push(`${x.id}: stop line ${line.laneId} sits on crossing ${c.id}`)
        }
      }
    }
  }
  return errors
}

/** Dev-only: DebugPanel lists per-crossing art rows when enabled. */
export const crossingArtDebug = { enabled: false }

/** Debug/test summary for one crossing's generated art. */
export function getCrossingArtSummary(crossingId: string) {
  const art = getCrossingArt(crossingId)
  if (!art) return null
  return {
    crossingId,
    kind: art.spec.kind,
    axis: art.spec.axis,
    stripeCount: art.stripes.length,
    padPositions: art.pads.map((p) => ({ id: p.id, kind: p.kind, x: p.x, z: p.z })),
    furniture: art.furniture.map((f) => ({ id: f.id, kind: f.kind, position: [...f.position] })),
    sectorIds: [...art.spec.sectorIds],
  }
}
