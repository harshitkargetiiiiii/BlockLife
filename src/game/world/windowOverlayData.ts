/**
 * Procedural emissive window overlays for GLB-skinned buildings.
 *
 * The Quaternius exports have no fake-interior shader, so their windows stay
 * dark at night. These defs place a small grid of unlit-material glow planes
 * a few centimeters off each visible façade — driven entirely by this data,
 * never by mesh geometry, and with zero collider/gameplay impact. Visibility
 * follows the same lamp-glow curve as the procedural neighbors, so overlays
 * are invisible by day and fade in through dusk.
 */
import { ASSET_MANIFEST_BY_ID } from '../assets/assetManifest'

export type FacadeDirection = 'north' | 'south' | 'east' | 'west'

export interface WindowOverlayDef {
  buildingAssetId: string
  /** Which side of the building this grid sits on (world axes). */
  facade: FacadeDirection
  /** Distance from the building center to the overlay plane, including a small anti-z-fight offset. */
  facadeDistance: number
  rows: number
  columns: number
  /** [lateral, vertical] distance between window centers. */
  spacing: [number, number]
  /** [lateral offset of the first column from center, height of the first row]. */
  start: [number, number]
  windowSize: [number, number]
  /** Brightness multiplier applied through the instance color. */
  emissiveIntensity: number
  /** Seed for the deterministic lit/unlit pattern. */
  seed: number
  /** Fraction of grid cells that are lit at night. */
  litRatio: number
}

/**
 * Tuned per building; the camera only ever sees the south (+z) and east (+x)
 * façades, so those are the only ones that get overlays.
 */
export const WINDOW_OVERLAYS: WindowOverlayDef[] = [
  // Sunrise Apartments — SUPPRESSED by issue #44 Wave 3. The two grids here were authored for
  // the Quaternius Building_Medium_2 body (9.06 x 15.0 x 7.86 @ 0.60) and are wrong for the
  // approved sprint apartment that replaced it on this id: the south plane at 3.98 would sit
  // 0.17 m INSIDE the new 8.30 m-deep facade and the east plane at 4.58 would float 0.09 m
  // OUTSIDE it — the replacement body is 5.54 m wide and 5.12 m deep against the pack model's
  // 9.06 x 7.86, so neither plane lands on a wall any more. Issue #44 allows realigning OR
  // suppressing a legacy grid; suppression is the honest option here, because this body bakes
  // its own windows into its single atlas, exactly like the row house and every other Wave-3
  // building, and like the issue #21 §6 apartment noted below. Proven day and night in
  // tests/visual/wave3-asset-visuals.spec.ts.
  // Block Gym — Building_Small_1 @ 0.62
  {
    buildingAssetId: 'building_gym_01',
    facade: 'south',
    facadeDistance: 3.45,
    rows: 3,
    columns: 3,
    spacing: [2.2, 2.6],
    start: [-2.2, 3.7],
    windowSize: [1.0, 1.2],
    emissiveIntensity: 1,
    seed: 21,
    litRatio: 0.65,
  },
  {
    buildingAssetId: 'building_gym_01',
    facade: 'east',
    facadeDistance: 3.92,
    rows: 3,
    columns: 3,
    spacing: [2.4, 2.6],
    start: [-3.0, 3.7],
    windowSize: [1.0, 1.2],
    emissiveIntensity: 0.85,
    seed: 22,
    litRatio: 0.55,
  },
  // Nook Offices — issue #38 Wave 0 office @ uniform 0.9501; issue #63 also projects this row onto
  // Main St Offices and North Exchange, whose projection groups carry these grids unchanged.
  //
  // Issue #64: these are measured PANE grids, not facade grids. The earlier 4 × 4 / 4 × 3 grids at
  // 2.51 / 2.55 sat just outside the whole-building bounding box, but the glazing is RECESSED
  // behind the piers, so their planes floated 0.03–0.46 m in front of the real surface and their
  // rows crossed the sign band, sills and parapet. Here, in calibrated model metres (the
  // model's own 0.9501 already applied, origin centred in plan), from the shipped bytes:
  // - east glass is planar at x ≈ 2.099–2.111, the big south window at z ≈ 2.092–2.094;
  // - each face's lower glazed floor is two pane rows (y ≈ 3.85–4.33 and 4.39–4.94) between
  //   raised mullions/transoms. The east face has three equal columns; the south face's big
  //   window has two lights (its narrow left light breaks the uniform spacing, so it stays dark);
  // - every rectangle is inset >= 5 cm inside one pane, and its plane sits 19–32 mm proud of the
  //   outermost surface at each sampled point (an 11 × 11 lattice over the rectangle, centre and
  //   corners included), below the frame, so jambs clip it at an angle.
  // The upper floor's glass carries baked vertical bars and muntins in the atlas, so glow there
  // would wash over window detailing; it is deliberately left dark. wave0Contract.test.ts pins
  // the pane table and re-measures every cell's sampled surface clearance against the GLB triangles.
  {
    buildingAssetId: 'building_office_01',
    facade: 'east',
    facadeDistance: 2.13,
    rows: 2,
    columns: 3,
    spacing: [1.05, 0.58],
    start: [-1.045, 4.09],
    windowSize: [0.74, 0.34],
    emissiveIntensity: 1,
    seed: 31,
    litRatio: 0.6,
  },
  {
    buildingAssetId: 'building_office_01',
    facade: 'south',
    facadeDistance: 2.12,
    rows: 2,
    columns: 2,
    spacing: [0.952, 0.58],
    start: [0.126, 4.085],
    windowSize: [0.65, 0.34],
    emissiveIntensity: 0.85,
    seed: 32,
    litRatio: 0.5,
  },
  // Residential apartment (Residential Street): the issue #21 §6 GLB bakes its own
  // windows into the texture, so no emissive night overlay is authored for it.
  // Backdrop tower — Building_Large_2 @ 0.48 (distant, sparser + dimmer)
  {
    buildingAssetId: 'building_tower_01',
    facade: 'east',
    facadeDistance: 4.06,
    rows: 5,
    columns: 4,
    spacing: [2.2, 2.3],
    start: [-3.3, 3.2],
    windowSize: [1.0, 1.25],
    emissiveIntensity: 0.75,
    seed: 41,
    litRatio: 0.45,
  },
  {
    buildingAssetId: 'building_tower_01',
    facade: 'south',
    facadeDistance: 5.0,
    rows: 5,
    columns: 3,
    spacing: [2.4, 2.3],
    start: [-2.4, 3.2],
    windowSize: [1.0, 1.25],
    emissiveIntensity: 0.7,
    seed: 42,
    litRatio: 0.4,
  },
]

/** Problems with the overlay data (empty = valid). Used by tests. */
export function validateWindowOverlays(defs: WindowOverlayDef[]): string[] {
  const errors: string[] = []
  for (const [i, d] of defs.entries()) {
    const where = `overlay[${i}] (${d.buildingAssetId}/${d.facade})`
    if (!ASSET_MANIFEST_BY_ID.has(d.buildingAssetId)) {
      errors.push(`${where}: unknown asset id`)
    }
    if (d.rows < 1 || d.columns < 1) errors.push(`${where}: rows/columns must be >= 1`)
    if (d.facadeDistance <= 0) errors.push(`${where}: facadeDistance must be positive`)
    if (d.litRatio <= 0 || d.litRatio > 1) errors.push(`${where}: litRatio must be in (0, 1]`)
    if (d.spacing.some((s) => s <= 0) || d.windowSize.some((s) => s <= 0)) {
      errors.push(`${where}: spacing and windowSize must be positive`)
    }
  }
  return errors
}
