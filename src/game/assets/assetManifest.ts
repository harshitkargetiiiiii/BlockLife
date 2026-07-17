/**
 * Asset manifest: the single source of truth mapping stable semantic asset
 * ids to (optional) GLB files under public/.
 *
 * The game never requires these files to exist. A GLB is only fetched when
 * BOTH `glbPath` is set AND `enabled` is true; in every other case — and
 * whenever a load fails — the procedural fallback renders instead.
 *
 * Workflow for adding a real asset (see README "Adding GLB assets"):
 *   1. Drop the file at the path in `glbPath` (or add a new entry).
 *   2. Record it in public/assets/ASSET_CREDITS.md (intake checklist).
 *   3. Fill `attribution` / `license` here.
 *   4. Flip `enabled` to true.
 */
export type AssetCategory = 'city' | 'vehicles' | 'characters' | 'props'

export interface AssetManifestEntry {
  /** Stable semantic id — matches layout data and collider definitions. */
  id: string
  /** Human-readable name for docs and tooling. */
  label: string
  category: AssetCategory
  /** Path under public/, e.g. 'assets/models/city/gym.glb'. Null = no file planned yet. */
  glbPath: string | null
  /** Name of the procedural component that renders when the GLB is absent. */
  fallbackKey: string
  /** Applied to the loaded GLB scene so models can be authored at any size. */
  scale: [number, number, number]
  /** Radians, applied to the loaded GLB scene. */
  rotation: [number, number, number]
  /** Local offset of the GLB scene inside its landmark group. */
  positionOffset: [number, number, number]
  /** Creator / attribution line. Fill in when the real asset lands. */
  attribution: string | null
  /** License identifier, e.g. 'CC0-1.0'. Fill in when the real asset lands. */
  license: string | null
  /** Master switch: false keeps the procedural fallback even if a file exists. */
  enabled: boolean
  /**
   * Height (world units) at which the floating sign should hover when this
   * GLB is active — real models are often taller than the primitive whose
   * height normally drives the label. Optional; fallback height is used
   * whenever the GLB isn't rendering.
   */
  labelHeight?: number
  /**
   * Per-asset visibility/occlusion overrides (Building Occlusion v1). Only
   * add when an asset genuinely needs it — defaults come from occluderData.
   */
  occlusion?: {
    enabled?: boolean
    mode?: 'wholeObject' | 'facadeOnly'
    minimumOpacity?: number
    excludeMaterialNames?: string[]
  }
}

const defaults = {
  scale: [1, 1, 1] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  positionOffset: [0, 0, 0] as [number, number, number],
  attribution: null,
  license: null,
  enabled: false,
}

/**
 * Landmarks wired through LandmarkAsset. `glbPath` documents where the future
 * file is expected to live; `enabled: false` keeps fallbacks active until a
 * real, licensed file is dropped in and recorded in ASSET_CREDITS.md.
 */
const QUATERNIUS = {
  attribution: 'Quaternius — Downtown City MegaKit [Standard] (quaternius.com)',
  license: 'CC0-1.0',
}

export const ASSET_MANIFEST: AssetManifestEntry[] = [
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'building_apartment_01',
    label: 'Sunrise Apartments (player home)',
    category: 'city',
    // Pack model: Building_Medium_2_001 (15.1 × 25 × 13.1). Scaled so the
    // footprint fills the 9×9 layout collider; façade faces +z (the door side).
    glbPath: 'assets/models/city/quaternius_building_medium_2.glb',
    fallbackKey: 'BuildingMesh',
    scale: [0.6, 0.6, 0.6],
    positionOffset: [0, 0.01, 3.58],
    labelHeight: 16.2,
    enabled: true,
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'building_gym_01',
    label: 'Block Gym',
    category: 'city',
    // Pack model: Building_Small_1 (12.5 × 17 × 14.5), depth-fit to 9×9.
    glbPath: 'assets/models/city/quaternius_building_small_1.glb',
    fallbackKey: 'BuildingMesh',
    scale: [0.62, 0.62, 0.62],
    positionOffset: [0.62, 0.01, 3.07],
    labelHeight: 11.8,
    enabled: true,
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'building_office_01',
    label: 'Nook Offices',
    category: 'city',
    // Pack model: Building_Large_2 (20.6 × 28 × 16.6) scaled to the 7×7
    // office footprint (~9.5 tall) and rotated so the façade faces west,
    // toward the job kiosk.
    glbPath: 'assets/models/city/quaternius_building_large_2.glb',
    fallbackKey: 'BuildingMesh',
    scale: [0.34, 0.34, 0.34],
    rotation: [0, -Math.PI / 2, 0],
    positionOffset: [-2.72, 0, -0.34],
    enabled: true,
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'building_tower_01',
    label: 'Backdrop tower (west)',
    category: 'city',
    // Reuses Building_Large_2 at backdrop scale (one download, cloned scene);
    // façade faces east, toward the city.
    glbPath: 'assets/models/city/quaternius_building_large_2.glb',
    fallbackKey: 'BuildingMesh',
    scale: [0.48, 0.48, 0.48],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [3.84, 0, 0.48],
    enabled: true,
  },
  {
    ...defaults,
    id: 'food_truck_01',
    label: "Maya's Snack Truck",
    category: 'city',
    glbPath: 'assets/models/city/food_truck_01.glb',
    fallbackKey: 'FoodTruckMesh',
  },
  {
    ...defaults,
    id: 'prop_job_kiosk_01',
    label: 'Job board kiosk',
    category: 'props',
    glbPath: 'assets/models/props/prop_job_kiosk_01.glb',
    fallbackKey: 'JobKioskMesh',
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'building_townhomes_01',
    label: 'Townhomes (future-use landmark, Residential Street)',
    category: 'city',
    // Reuses Building_Medium_2 at neighborhood scale — one download, cloned.
    glbPath: 'assets/models/city/quaternius_building_medium_2.glb',
    fallbackKey: 'BuildingMesh',
    scale: [0.465, 0.465, 0.465],
    positionOffset: [0, 0.01, 2.77],
    labelHeight: 12.4,
    enabled: true,
  },
  // ---- Street props (Quaternius pack, decorative — no colliders) ----
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'prop_ac_unit_01',
    label: 'Wall AC unit',
    category: 'props',
    glbPath: 'assets/models/props/quaternius_prop_acunit.glb',
    fallbackKey: 'ACUnitFallback',
    enabled: true,
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'prop_bollard_01',
    label: 'Sidewalk bollard',
    category: 'props',
    glbPath: 'assets/models/props/quaternius_prop_bollard.glb',
    fallbackKey: 'BollardFallback',
    enabled: true,
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'prop_street_planter_01',
    label: 'Concrete street planter',
    category: 'props',
    glbPath: 'assets/models/props/quaternius_prop_plantersingle.glb',
    fallbackKey: 'PlanterFallback',
    // Pack planter is 2×2 m — scaled to sit politely in front of shops.
    scale: [0.55, 0.55, 0.55],
    enabled: true,
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'prop_manhole_01',
    label: 'Manhole cover',
    category: 'props',
    glbPath: 'assets/models/props/quaternius_prop_manholecover.glb',
    fallbackKey: 'ManholeFallback',
    // Sits a hair above the asphalt plane to avoid z-fighting.
    positionOffset: [0, 0.012, 0],
    enabled: true,
  },
  {
    ...defaults,
    ...QUATERNIUS,
    id: 'prop_drain_01',
    label: 'Street drain',
    category: 'props',
    glbPath: 'assets/models/props/quaternius_prop_drain.glb',
    fallbackKey: 'DrainFallback',
    positionOffset: [0, 0.012, 0],
    enabled: true,
  },
]

export const ASSET_MANIFEST_BY_ID: ReadonlyMap<string, AssetManifestEntry> = new Map(
  ASSET_MANIFEST.map((e) => [e.id, e]),
)

const CATEGORIES: AssetCategory[] = ['city', 'vehicles', 'characters', 'props']

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** Returns a list of problems (empty = valid). Used by tests and dev tooling. */
export function validateManifest(entries: AssetManifestEntry[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    const where = `entry "${e.id || '(missing id)'}"`
    if (!e.id) errors.push(`${where}: id is required`)
    if (seen.has(e.id)) errors.push(`${where}: duplicate id`)
    seen.add(e.id)
    if (!e.label) errors.push(`${where}: label is required`)
    if (!CATEGORIES.includes(e.category)) errors.push(`${where}: invalid category "${e.category}"`)
    if (!e.fallbackKey) errors.push(`${where}: fallbackKey is required`)
    if (e.glbPath !== null) {
      if (!e.glbPath.startsWith('assets/')) {
        errors.push(`${where}: glbPath must be relative to public/ and start with "assets/"`)
      }
      if (!e.glbPath.endsWith('.glb') && !e.glbPath.endsWith('.gltf')) {
        errors.push(`${where}: glbPath must point to a .glb or .gltf file`)
      }
    }
    if (e.enabled && !e.glbPath) errors.push(`${where}: enabled without a glbPath`)
    if (!isVec3(e.scale)) errors.push(`${where}: scale must be [x, y, z]`)
    if (!isVec3(e.rotation)) errors.push(`${where}: rotation must be [x, y, z]`)
    if (!isVec3(e.positionOffset)) errors.push(`${where}: positionOffset must be [x, y, z]`)
  }
  return errors
}
