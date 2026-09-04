/**
 * Static 3D-placement + authoring integrity validators (World Integrity issue
 * §7/§8) — PURE functions over plain authored data, so they run in unit tests,
 * in the per-sector placement report, and (mirrored) in the runtime anomaly
 * scan. They OBSERVE + report; they never mutate authored data.
 *
 * Every check flags only GENUINE defects, not adjacency: a prop touching a wall
 * or a bench beside a building is fine; a canopy PENETRATING a facade past a
 * tolerance is a clip. Tolerances live with the data (`propPlacement`).
 */
import type { PropType, Vec2, Vec3 } from '../worldTypes'
import {
  BASE_CONTACT_TOLERANCE,
  PROP_PLACEMENT,
  VISUAL_CLIP_TOLERANCE,
  type PropPlacementSpec,
} from '../propPlacement'
import { buildingMassingTop } from '../buildingMassing'
import { CAMERA_EYE_HEIGHT, cameraClearanceOf, containsCameraEye } from '../../camera/cameraGeometry'

export type PlacementFailureKind =
  | 'prop_floating'
  | 'prop_clipping'
  | 'anchor_invalid'
  | 'duplicate_citizen'
  | 'route_corridor'
  | 'building_over_camera'

export interface PlacementFailure {
  kind: PlacementFailureKind
  /** Primary offending entity id. */
  entityId: string
  /** The conflicting obstacle/other entity, where there is one. */
  otherId?: string
  sectorId?: string | null
  /** Human-readable reason with the measured overlap/gap. */
  reason: string
  /** Required correction distance in world units, where meaningful. */
  correction?: number
}

/** Axis-aligned solid footprint (building / solid prop / furniture). */
export interface SolidRect {
  id: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

// ---- geometry helpers (pure) ---------------------------------------------

/** Signed penetration of a circle into an AABB: >0 means overlap depth. */
export function circleAabbPenetration(x: number, z: number, r: number, b: SolidRect): number {
  const cx = Math.max(b.minX, Math.min(x, b.maxX))
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ))
  const d = Math.hypot(x - cx, z - cz)
  if (d === 0) return r // centre inside the box — fully invalid
  return r - d
}

/** World-space AABB of a prop's visual box after its authored rotationY. An
 *  over-approximation (bounding the rotated box) — conservative for clip checks. */
export function propVisualWorldAabb(
  x: number,
  z: number,
  rotationY: number,
  spec: PropPlacementSpec,
): SolidRect {
  const [hx, hz] = spec.visualHalf
  const [ox, oz] = spec.visualOffset ?? [0, 0]
  const c = Math.abs(Math.cos(rotationY))
  const s = Math.abs(Math.sin(rotationY))
  const ex = hx * c + hz * s // rotated half-extent on X
  const ez = hx * s + hz * c // rotated half-extent on Z
  // Rotate the offset too.
  const cr = Math.cos(rotationY)
  const sr = Math.sin(rotationY)
  const wox = ox * cr - oz * sr
  const woz = ox * sr + oz * cr
  return { id: '', minX: x + wox - ex, maxX: x + wox + ex, minZ: z + woz - ez, maxZ: z + woz + ez }
}

/** Overlap DEPTH (min penetration on X/Z) of two AABBs; 0 = separated. */
export function aabbOverlapDepth(a: SolidRect, b: SolidRect): number {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
  if (ox <= 0 || oz <= 0) return 0
  return Math.min(ox, oz)
}

/** Distance from point p to segment [a,b]. */
export function pointSegmentDistance(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return Math.hypot(px - a[0], pz - a[1])
  let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz))
}

// ---- prop validators ------------------------------------------------------

/**
 * Base-contact: a ground prop's base (local minY, since the group renders at
 * the support surface Y) must sit on `supportSurfaceY` within tolerance —
 * otherwise it floats (base above) or sinks (base below). Wall/roof mounts are
 * intentionally above ground and validated by their mount, not here.
 */
export function validateBaseContact(
  entityId: string,
  spec: PropPlacementSpec,
  supportSurfaceY: number,
  sectorId: string | null = null,
): PlacementFailure | null {
  if (spec.support === 'wall' || spec.support === 'roof') return null
  const gap = spec.vertical[0] - supportSurfaceY
  if (gap > BASE_CONTACT_TOLERANCE) {
    return {
      kind: 'prop_floating',
      entityId,
      sectorId,
      reason: `base floats ${gap.toFixed(2)}u above its support surface`,
      correction: gap,
    }
  }
  if (gap < -BASE_CONTACT_TOLERANCE) {
    return {
      kind: 'prop_floating',
      entityId,
      sectorId,
      reason: `base sunk ${(-gap).toFixed(2)}u below its support surface`,
      correction: -gap,
    }
  }
  return null
}

/** Visual clip: a prop's full visual envelope must not PENETRATE a building
 *  facade past tolerance (touching / adjacency is fine). */
export function validatePropVisualClip(
  prop: { id: string; x: number; z: number; rotationY: number; type: PropType; sectorId?: string | null },
  buildings: readonly SolidRect[],
): PlacementFailure | null {
  const spec = PROP_PLACEMENT[prop.type]
  const box = propVisualWorldAabb(prop.x, prop.z, prop.rotationY, spec)
  for (const b of buildings) {
    const depth = aabbOverlapDepth(box, b)
    if (depth > VISUAL_CLIP_TOLERANCE) {
      return {
        kind: 'prop_clipping',
        entityId: prop.id,
        otherId: b.id,
        sectorId: prop.sectorId ?? null,
        reason: `visual geometry clips building ${b.id} by ${depth.toFixed(2)}u`,
        correction: depth,
      }
    }
  }
  return null
}

// ---- anchor validator -----------------------------------------------------

/**
 * Anchor clearance: an authored position where a person/marker appears must not
 * intersect a solid, using the actual body/footprint radius. Catches citizens
 * inside walls/poles, doorway anchors too close to a facade, crosswalk waits
 * inside furniture.
 */
export function validateAnchorClearance(
  anchor: { id: string; x: number; z: number; radius: number; kind: string; sectorId?: string | null },
  solids: readonly SolidRect[],
): PlacementFailure | null {
  for (const s of solids) {
    const pen = circleAabbPenetration(anchor.x, anchor.z, anchor.radius, s)
    if (pen > 0) {
      return {
        kind: 'anchor_invalid',
        entityId: anchor.id,
        otherId: s.id,
        sectorId: anchor.sectorId ?? null,
        reason: `${anchor.kind} anchor intersects ${s.id} — move ${pen.toFixed(2)}u clear`,
        correction: pen,
      }
    }
  }
  return null
}

// ---- GLB / fallback ground-contact parity --------------------------------

/**
 * GLB parity (§7): switching an asset between its GLB and its procedural
 * fallback must not move the apparent support (base) point outside tolerance —
 * otherwise the same prop floats with the GLB but sits with the fallback (or
 * vice-versa). Both contact points are the mesh min-Y AFTER the manifest
 * scale/rotation/offset; a bad pivot or offset is exactly what this catches.
 */
export function validateGroundContactParity(
  assetId: string,
  glbContactY: number,
  fallbackContactY: number,
  tolerance = BASE_CONTACT_TOLERANCE,
  sectorId: string | null = null,
): PlacementFailure | null {
  const drift = Math.abs(glbContactY - fallbackContactY)
  if (drift > tolerance) {
    return {
      kind: 'prop_floating',
      entityId: assetId,
      sectorId,
      reason: `GLB base contact drifts ${drift.toFixed(2)}u from the procedural fallback (bad pivot/offset)`,
      correction: drift,
    }
  }
  return null
}

/**
 * Camera clearance (issue #46 §2): an authored building box may never reach the height the
 * diorama camera flies at.
 *
 * `FollowCamera` is an ORTHOGRAPHIC camera at `subject + CAMERA_OFFSET`, so its eye is a real
 * point in the world at y = 18. A body that reaches it contains it, and the frame fills with
 * the inside of a roof — the exact failure Wave 3 (#44) shipped and only a screenshot caught,
 * with `tsc`, lint, 1,563 unit tests, the asset report, these validators, district
 * certification and 365 E2E tests all green.
 *
 * This is the authoring half of the invariant, and it is deliberately the HARD threshold
 * (`containsCameraEye`) rather than the softer `MAX_WORLD_RENDER_HEIGHT` a rendered visual body
 * is held to: an authored box is gameplay massing that a district may legitimately push tall,
 * whereas a projected GLB is presentation and has no reason to spend the clearance. The
 * matching gate for what actually renders lives in `assets/cameraClearance.test.ts`.
 *
 * The measured top is the box plus `BuildingMesh`'s roof slab; see `buildingMassing` for what
 * is deliberately outside it.
 */
export function validateCameraClearance(
  building: { id: string; size: Vec3 },
  sectorId: string | null = null,
): PlacementFailure | null {
  const top = buildingMassingTop(building.size[1])
  if (!containsCameraEye(top)) return null
  return {
    kind: 'building_over_camera',
    entityId: building.id,
    sectorId,
    reason: `massing reaches ${top.toFixed(2)}u, at or above the camera eye at ${CAMERA_EYE_HEIGHT}u — the camera renders from inside it`,
    correction: -cameraClearanceOf(top),
  }
}

// ---- duplicate-citizen detector ------------------------------------------

export interface CitizenRoute {
  id: string
  position: Vec2
  waypoints: readonly Vec2[]
  sectorId?: string | null
}

/**
 * Near-duplicate citizens: equivalent start AND waypoint sequence (the Slice-1
 * lockstep defect — shared start+route+speed → permanent co-location that the
 * occupancy resolver can't fix). Each pair reported once.
 */
export function detectDuplicateCitizens(
  citizens: readonly CitizenRoute[],
  posEps = 0.5,
): PlacementFailure[] {
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= posEps
  const out: PlacementFailure[] = []
  for (let i = 0; i < citizens.length; i++) {
    for (let j = i + 1; j < citizens.length; j++) {
      const a = citizens[i]
      const b = citizens[j]
      if (!near(a.position, b.position)) continue
      if (a.waypoints.length !== b.waypoints.length) continue
      if (!a.waypoints.every((wp, k) => near(wp, b.waypoints[k]))) continue
      out.push({
        kind: 'duplicate_citizen',
        entityId: a.id,
        otherId: b.id,
        sectorId: a.sectorId ?? null,
        reason: `shares start + ${a.waypoints.length}-waypoint route with ${b.id} (lockstep risk)`,
      })
    }
  }
  return out
}

// ---- route-corridor validator --------------------------------------------

/**
 * Route corridor: a walking/driving path's swept corridor (half-width from the
 * actual body/lane) must stay clear of solids — a building, pole, parked
 * vehicle or curb-edge intruding into the corridor is a defect.
 */
export function validateRouteCorridor(
  routeId: string,
  points: readonly Vec2[],
  halfWidth: number,
  solids: readonly SolidRect[],
  sectorId: string | null = null,
): PlacementFailure[] {
  const out: PlacementFailure[] = []
  for (const s of solids) {
    const cx = (s.minX + s.maxX) / 2
    const cz = (s.minZ + s.maxZ) / 2
    // Solid's own half-extent toward the path (bounding radius is conservative).
    const solidRadius = Math.hypot((s.maxX - s.minX) / 2, (s.maxZ - s.minZ) / 2)
    let minDist = Infinity
    for (let i = 0; i + 1 < points.length; i++) {
      minDist = Math.min(minDist, pointSegmentDistance(cx, cz, points[i], points[i + 1]))
    }
    const intrusion = halfWidth + solidRadius - minDist
    if (intrusion > VISUAL_CLIP_TOLERANCE) {
      out.push({
        kind: 'route_corridor',
        entityId: routeId,
        otherId: s.id,
        sectorId,
        reason: `route corridor intruded by ${s.id} (${intrusion.toFixed(2)}u into the ${halfWidth.toFixed(2)}u corridor)`,
        correction: intrusion,
      })
    }
  }
  return out
}
