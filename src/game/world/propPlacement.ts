import type { PropType } from './worldTypes'

/**
 * Canonical prop PLACEMENT model (World Integrity issue §7) — a LEAF module (no
 * runtime imports, like `propSolidity`) declaring, per prop type, the full
 * VISUAL envelope + base/support model that the meshes in `Props.tsx` actually
 * render. This is deliberately SEPARATE from `PROP_SOLIDITY` (collision): a
 * tree's foliage or an awning overhangs far past its trunk collider, and a
 * non-solid decal is still checked for floating/clipping. Placement validation
 * reads THIS; if a mesh in `Props.tsx` changes, this table must change with it
 * (a parity the visual tests + this table's authorship keep honest).
 *
 * Coordinates are in the prop's LOCAL frame (before its authored position +
 * rotationY). `vertical` is [minY, maxY] of the SOLID visual geometry — flat
 * ground decals (light pools, manhole/drain faces) are represented at their real
 * near-ground interval, never inflated. `minY` is the base-contact point.
 */
export type PropSupportMode = 'ground' | 'wall' | 'roof' | 'raised'

export interface PropPlacementSpec {
  /** Visual footprint half-extents in local XZ: [halfX, halfZ]. The full visual
   *  envelope (foliage, canopy, overhang) — may exceed PROP_SOLIDITY.half. */
  visualHalf: [number, number]
  /** Local-frame center offset [dx, dz] of the visual footprint (asymmetric props). */
  visualOffset?: [number, number]
  /** [minY, maxY] of the solid visual geometry. minY is the base contact point. */
  vertical: [number, number]
  /** Support mode. 'ground' → base (minY) must sit on the support surface within
   *  tolerance. 'wall'/'roof' → intentionally mounted above ground at minY (the
   *  ground-contact check is skipped; the mount is validated against a facing
   *  building instead). 'raised' → sits on an authored raised surface. */
  support: PropSupportMode
  /** Canopy prop (tree foliage): the elevated visual envelope legitimately
   *  OVERHANGS a roof/wall by design, so the building-clip check uses the TRUNK
   *  (collision) footprint — a real defect is the trunk growing inside a
   *  building, not foliage draping over it. A narrow, per-TYPE intent (issue §7),
   *  never a per-coordinate exemption. */
  canopy?: boolean
  /** Wall-abutting prop (AC condenser, utility meter): DESIGNED to sit flush
   *  against a building's exterior wall, so a shallow overlap with its host
   *  building is intended, not a facade clip — exempt from the building-clip
   *  check. Also a narrow, per-TYPE intent (issue §7). */
  abutsBuilding?: boolean
}

/** A ground prop's base within this of its support surface (world units) is
 *  contacting; below → sunken, above → floating. Small but forgiving of the
 *  sub-cm rounding in the authored meshes. */
export const BASE_CONTACT_TOLERANCE = 0.08

/** Visual overlap deeper than this into a building footprint is clipping (mere
 *  touching / adjacency — a bench against a wall — is tolerated). */
export const VISUAL_CLIP_TOLERANCE = 0.25

/**
 * Per-type canonical placement, transcribed from the meshes in `Props.tsx`.
 * `visualHalf` is the SOLID silhouette (flat light pools excluded from the XZ
 * envelope so a street lamp's glow decal doesn't read as a 1.7u clip).
 */
export const PROP_PLACEMENT: Record<PropType, PropPlacementSpec> = {
  // pole r0.1 + bulb r0.26 (glow decal excluded); pole base at ground.
  street_lamp: { visualHalf: [0.26, 0.26], vertical: [0, 4.11], support: 'ground' },
  // trunk r0.22 + foliage sphere r1.05 offset (0.35,0.15) → ~1.4 overhang.
  tree: { visualHalf: [1.4, 1.2], vertical: [0, 3.3], support: 'ground', canopy: true },
  park_tree: { visualHalf: [1.4, 1.2], vertical: [0, 3.5], support: 'ground', canopy: true },
  bench: { visualHalf: [0.9, 0.32], vertical: [0, 1.06], support: 'ground' },
  trash_can: { visualHalf: [0.32, 0.32], vertical: [0, 0.92], support: 'ground' },
  hydrant: { visualHalf: [0.2, 0.2], vertical: [0, 0.76], support: 'ground' },
  planter: { visualHalf: [0.7, 0.28], vertical: [0, 0.84], support: 'ground' },
  street_planter: { visualHalf: [0.7, 0.28], vertical: [0, 0.84], support: 'ground' },
  parked_car: { visualHalf: [1.0, 2.0], vertical: [0, 1.4], support: 'ground' },
  // cab (z1.55) + cargo (z-0.7, len3.2) → z span ~[-2.3, 2.2]; wheels at ground.
  parked_truck: { visualHalf: [1.15, 2.3], vertical: [0, 2.1], support: 'ground' },
  bollard: { visualHalf: [0.11, 0.11], vertical: [0, 0.9], support: 'ground' },
  cone: { visualHalf: [0.25, 0.25], vertical: [0, 0.56], support: 'ground' },
  utility_box: { visualHalf: [0.38, 0.28], vertical: [0, 1.07], support: 'ground' },
  stop_sign: { visualHalf: [0.42, 0.42], vertical: [0, 2.9], support: 'ground' },
  // stacked crates spread to (0.55,0.2) at scale, top box to Y1.3.
  crate: { visualHalf: [0.9, 0.7], visualOffset: [0.2, 0.1], vertical: [0, 1.3], support: 'ground' },
  barrel: { visualHalf: [0.35, 0.35], vertical: [0, 0.9], support: 'ground' },
  signboard: { visualHalf: [0.36, 0.22], vertical: [0, 1.0], support: 'ground' },
  flower_pot: { visualHalf: [0.26, 0.26], vertical: [0, 0.78], support: 'ground' },
  dumpster: { visualHalf: [0.97, 0.5], vertical: [0, 1.22], support: 'ground' },
  table_set: { visualHalf: [0.98, 0.5], vertical: [0, 0.65], support: 'ground' },
  ac_unit: { visualHalf: [0.45, 0.18], vertical: [0, 0.6], support: 'ground', abutsBuilding: true },
  // Flat ground decals — real near-ground interval, never inflated.
  manhole: { visualHalf: [0.46, 0.46], vertical: [0, 0.056], support: 'ground' },
  drain: { visualHalf: [0.3, 0.3], vertical: [0, 0.056], support: 'ground' },
  // pallet slab + a crate to Y0.78.
  pallet: { visualHalf: [0.6, 0.6], vertical: [0, 0.78], support: 'ground' },
  // Door lamp: a single box at Y2.5 — INTENTIONALLY wall-mounted, base at 2.42.
  porch_light: { visualHalf: [0.11, 0.07], vertical: [2.42, 2.58], support: 'wall' },
}
