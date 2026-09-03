/**
 * Per-sector placement report (World Integrity issue §7/§8) — runs the pure
 * placement validators over one sector's authored data and returns every
 * failure with exact entity IDs + reasons. Deterministic, pure; used by the
 * unit gate (assert zero real defects), the DEV report test API, and the
 * remediation audit. It reads the SAME compiled data the runtime renders.
 */
import type { PropType, Vec2, Vec3 } from '../worldTypes'
import { PROP_SOLIDITY } from '../propSolidity'
import { PROP_PLACEMENT } from '../propPlacement'
import {
  type CitizenRoute,
  type PlacementFailure,
  type SolidRect,
  aabbOverlapDepth,
  detectDuplicateCitizens,
  validateAnchorClearance,
  validateBaseContact,
  validateCameraClearance,
  validatePropVisualClip,
} from './placementValidation'
import { VISUAL_CLIP_TOLERANCE } from '../propPlacement'

/** Actual on-foot person half-width used for anchor clearance. */
export const PERSON_ANCHOR_RADIUS = 0.36

export interface BuildingLike {
  id: string
  position: Vec2
  size: Vec3
  door?: 'north' | 'south' | 'east' | 'west'
}
export interface PropLike {
  id: string
  type: PropType
  position: Vec2
  rotationY?: number
}
export interface CitizenLike {
  id: string
  position: Vec2
  waypoints: readonly Vec2[]
}
/** An authored point where a person/marker appears (idle, queue, sit, door…). */
export interface AnchorLike {
  id: string
  kind: string
  position: Vec2
}

export interface PlacementReportInput {
  sectorId: string
  buildings: readonly BuildingLike[]
  props: readonly PropLike[]
  citizens?: readonly CitizenLike[]
  /** Extra authored anchors beyond citizen positions (crosswalk waits, doors…). */
  anchors?: readonly AnchorLike[]
  /** Extra solids beyond buildings + solid props (walls, water). */
  extraSolids?: readonly SolidRect[]
}

export interface PlacementReport {
  sectorId: string
  failures: PlacementFailure[]
  counts: { props: number; citizens: number; anchors: number; solids: number }
}

/** Building footprint as an XZ AABB (size is [w,h,d]). */
export function buildingFootprint(b: BuildingLike): SolidRect {
  const hw = b.size[0] / 2
  const hd = b.size[2] / 2
  return { id: b.id, minX: b.position[0] - hw, maxX: b.position[0] + hw, minZ: b.position[1] - hd, maxZ: b.position[1] + hd }
}

/** Solid prop footprint (from PROP_SOLIDITY), or null for decorative props. */
export function propFootprint(p: PropLike): SolidRect | null {
  const s = PROP_SOLIDITY[p.type]
  if (!s.half) return null
  // Rotate the offset; use the rotated bounding half-extents (conservative).
  const rot = p.rotationY ?? 0
  const [ox, oz] = s.offset ?? [0, 0]
  const cx = p.position[0] + ox * Math.cos(rot) - oz * Math.sin(rot)
  const cz = p.position[1] + ox * Math.sin(rot) + oz * Math.cos(rot)
  const c = Math.abs(Math.cos(rot))
  const sn = Math.abs(Math.sin(rot))
  const ex = s.half[0] * c + s.half[2] * sn
  const ez = s.half[0] * sn + s.half[2] * c
  return { id: p.id, minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez }
}

/**
 * Validate one sector's authored placement. `supportSurfaceY` defaults to the
 * city ground (0); a raised-surface sector can pass its own.
 */
export function validateSectorPlacement(input: PlacementReportInput, supportSurfaceY = 0): PlacementReport {
  const failures: PlacementFailure[] = []
  const { sectorId } = input

  // Buildings: an authored box that reaches the diorama camera's own height is an authoring
  // failure, not a style choice — the camera then renders from inside it (issue #46 §2).
  for (const b of input.buildings) {
    const clearance = validateCameraClearance({ id: b.id, size: b.size }, sectorId)
    if (clearance) failures.push(clearance)
  }

  const buildingSolids = input.buildings.map(buildingFootprint)
  const propSolids = input.props.map(propFootprint).filter((r): r is SolidRect => r != null)
  const allSolids = [...buildingSolids, ...propSolids, ...(input.extraSolids ?? [])]

  // Props: base contact (float/sink) + visual clip through building facades.
  for (const p of input.props) {
    const spec = PROP_PLACEMENT[p.type]
    const base = validateBaseContact(p.id, spec, supportSurfaceY, sectorId)
    if (base) failures.push(base)
    // Wall/roof-mounted + wall-abutting props mount ON a building by design, so
    // a shallow host overlap is intended, not a facade clip (issue §7).
    if (spec.support === 'wall' || spec.support === 'roof' || spec.abutsBuilding) {
      // (mount validated by support mode / declared intent; no clip check)
    } else if (spec.canopy) {
      // Canopy props (trees): foliage legitimately overhangs a roof, so the
      // real facade-clip check is the TRUNK (collision) footprint — a tree
      // GROWING inside a building, not leaves draping over it (issue §7).
      const trunk = propFootprint(p)
      if (trunk) {
        for (const b of buildingSolids) {
          const depth = aabbOverlapDepth(trunk, b)
          if (depth > VISUAL_CLIP_TOLERANCE) {
            failures.push({
              kind: 'prop_clipping',
              entityId: p.id,
              otherId: b.id,
              sectorId,
              reason: `trunk clips building ${b.id} by ${depth.toFixed(2)}u`,
              correction: depth,
            })
            break
          }
        }
      }
    } else {
      const clip = validatePropVisualClip(
        { id: p.id, x: p.position[0], z: p.position[1], rotationY: p.rotationY ?? 0, type: p.type, sectorId },
        buildingSolids,
      )
      if (clip) failures.push(clip)
    }
  }

  // Citizens: near-duplicate start+route (lockstep), and start/waypoint anchors
  // must clear solids (a citizen must not be authored inside a wall/pole). A
  // citizen's own solid prop is excluded so a bench-sitter isn't self-flagged.
  const citizens = input.citizens ?? []
  failures.push(
    ...detectDuplicateCitizens(
      citizens.map((c): CitizenRoute => ({ id: c.id, position: c.position, waypoints: c.waypoints, sectorId })),
    ),
  )
  for (const c of citizens) {
    const anchor = validateAnchorClearance(
      { id: c.id, x: c.position[0], z: c.position[1], radius: PERSON_ANCHOR_RADIUS, kind: 'citizen', sectorId },
      buildingSolids, // vs buildings only (props are furniture a citizen can stand by)
    )
    if (anchor) failures.push(anchor)
  }

  // Extra anchors (crosswalk waits, doors, mission/interaction markers).
  for (const a of input.anchors ?? []) {
    const f = validateAnchorClearance(
      { id: a.id, x: a.position[0], z: a.position[1], radius: PERSON_ANCHOR_RADIUS, kind: a.kind, sectorId },
      allSolids,
    )
    if (f) failures.push(f)
  }

  return {
    sectorId,
    failures,
    counts: { props: input.props.length, citizens: citizens.length, anchors: (input.anchors ?? []).length, solids: allSolids.length },
  }
}
