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
  // OUTSIDE it, and either way five rows of glow reach 13.2 m up a 24.3 m body — a ghost
  // overlay across the upper two thirds of the building. Issue #44 allows realigning OR
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
  // Nook Offices — issue #38 Wave 0 office @ uniform 0.9501.
  // Re-authored for the replacement model's measured footprint; the old Building_Large_2
  // @ 0.34 distances (2.89 east / 3.56 south) left these planes floating ~0.40 m and
  // ~1.03 m OUTSIDE the new facades (issue #38 Codex review, finding 5).
  //
  // Measured model 5.2440 × 9.9992 × 5.3379, centred in plan, so at 0.9501 the walls sit
  // at x = ±2.487..2.496 and z = ±2.532..2.540 under a 9.500 roof. Each plane sits a
  // ~0.02 m epsilon proud of its wall to avoid z-fighting, and every window — including
  // its half-width and the top row — stays inside the facade. wave0Contract.test.ts
  // asserts that containment against the same measured numbers.
  {
    buildingAssetId: 'building_office_01',
    facade: 'east',
    facadeDistance: 2.51,
    rows: 4,
    columns: 4,
    spacing: [1.3, 1.7],
    start: [-1.95, 3.0],
    windowSize: [0.72, 0.95],
    emissiveIntensity: 1,
    seed: 31,
    litRatio: 0.6,
  },
  {
    buildingAssetId: 'building_office_01',
    facade: 'south',
    facadeDistance: 2.55,
    rows: 4,
    columns: 3,
    spacing: [1.6, 1.7],
    start: [-1.6, 3.0],
    windowSize: [0.72, 0.95],
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
