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
  // Sunrise Apartments — Building_Medium_2 @ 0.60
  {
    buildingAssetId: 'building_apartment_01',
    facade: 'south',
    facadeDistance: 3.98,
    rows: 5,
    columns: 4,
    spacing: [2.0, 2.4],
    start: [-3.0, 3.6],
    windowSize: [1.0, 1.25],
    emissiveIntensity: 1,
    seed: 11,
    litRatio: 0.55,
  },
  {
    buildingAssetId: 'building_apartment_01',
    facade: 'east',
    facadeDistance: 4.58,
    rows: 5,
    columns: 3,
    spacing: [2.3, 2.4],
    start: [-2.4, 3.6],
    windowSize: [1.0, 1.25],
    emissiveIntensity: 0.85,
    seed: 12,
    litRatio: 0.5,
  },
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
  // Nook Offices — Building_Large_2 @ 0.34 (rotated; small dense windows)
  {
    buildingAssetId: 'building_office_01',
    facade: 'east',
    facadeDistance: 2.89,
    rows: 4,
    columns: 4,
    spacing: [1.6, 1.7],
    start: [-2.4, 3.0],
    windowSize: [0.72, 0.95],
    emissiveIntensity: 1,
    seed: 31,
    litRatio: 0.6,
  },
  {
    buildingAssetId: 'building_office_01',
    facade: 'south',
    facadeDistance: 3.56,
    rows: 4,
    columns: 3,
    spacing: [1.8, 1.7],
    start: [-1.8, 3.0],
    windowSize: [0.72, 0.95],
    emissiveIntensity: 0.85,
    seed: 32,
    litRatio: 0.5,
  },
  // Townhomes (Residential Street) — Building_Medium_2 @ 0.465
  {
    buildingAssetId: 'building_townhomes_01',
    facade: 'south',
    facadeDistance: 3.1,
    rows: 4,
    columns: 3,
    spacing: [2.0, 2.0],
    start: [-2.0, 2.8],
    windowSize: [0.9, 1.1],
    emissiveIntensity: 0.9,
    seed: 51,
    litRatio: 0.5,
  },
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
