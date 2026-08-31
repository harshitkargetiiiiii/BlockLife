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
import type { MaterialSlotMap, MaterialVariant } from './assetVariants'

export type AssetCategory = 'city' | 'vehicles' | 'characters' | 'props'

/** Per-category browser budgets (issue #21 §11/§12) the asset-report gate enforces. */
export interface AssetBudget {
  /** Max triangles for this asset (over → fails the report/perf gate). */
  maxTriangles?: number
  /** Max texture dimension in px (default policy 1024). */
  maxTexture?: number
}

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
  /**
   * Recolorable material slots (issue #21 §3): semantic slot → GLB material
   * names. Consumed by the variant system so one file backs many colors without
   * duplicating geometry (vehicle paint/wheel; buildings could expose facade/trim).
   */
  materialSlots?: MaterialSlotMap
  /** Named color/material presets over the declared slots (e.g. paint palette). */
  variants?: Record<string, MaterialVariant>
  /** Triangle/texture budget the asset-report gate enforces (§12). */
  budget?: AssetBudget
  /** Optional visual bounds (world units) for tooling/labels; render reads the GLB. */
  bounds?: { width: number; height: number; depth: number }
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
    // §6 palette slots: the recolorable façade + trim (windows/interior untouched).
    // Declaring slots only isolates the materials per instance (identity clone) — the
    // render is unchanged until a BuildingDef.paletteVariant is applied.
    materialSlots: { wall: ['MI_InteriorWall'], trim: ['MI_Trim_Green'] },
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
    materialSlots: { wall: ['MI_RedBrick_Pale', 'MI_Concrete'], trim: ['MI_Trim', 'MI_Trim_MetalConcrete'] },
    enabled: true,
  },
  {
    ...defaults,
    id: 'building_office_01',
    label: 'Nook Offices',
    category: 'city',
    // Issue #38 Wave 0: the owner-approved sprint office replaces the Quaternius pack model
    // on this id (the pack GLB stays — building_tower_01 still uses it). Model is
    // 5.244 × 9.999 × 5.338 with its origin at the base, so a UNIFORM 0.9501 matches the
    // authored 9.5 height exactly and lands 4.98 × 9.50 × 5.07 — strictly INSIDE the
    // authored 7×7 footprint. Colliders, entrance anchors, window overlays, labels and
    // occlusion still come from cityLayout, never from the model.
    glbPath: 'assets/models/city/arch_office_01.glb',
    fallbackKey: 'BuildingMesh',
    scale: [0.9501, 0.9501, 0.9501],
    rotation: [0, 0, 0],
    positionOffset: [0, 0, 0],
    labelHeight: 10.2,
    materialSlots: { wall: ['wall'] },
    enabled: true,
    budget: { maxTriangles: 60000 },
    attribution: 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), assembled + texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
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
    materialSlots: { wall: ['MI_InteriorWall'], trim: ['MI_Trim_Dark', 'MI_Trim_MetalConcrete'] },
    enabled: true,
  },
  {
    ...defaults,
    id: 'arch_residential_house_01',
    label: 'Residential house archetype',
    category: 'city',
    // Issue #25: reusable low-poly house archetype (Meshy image→3D, lowpoly textured — 7936
    // tris, 1K texture), projected onto many gameplay ids via BuildingDef.visual. Uniform
    // scale fills the [5,4,5] template footprint (model ~1.7×1.9×1.4); the model is
    // center-origin, so the offset raises its base to the ground. Colliders/anchors come from
    // cityLayout, never the model. Stage A: one calibration placement (building_house_r1); no
    // palette slots yet (tinting for the ~25-placement reuse is a Stage-B concern).
    glbPath: 'assets/models/city/arch_residential_house_01.glb',
    fallbackKey: 'BuildingMesh',
    scale: [2.95, 2.95, 2.95],
    positionOffset: [0, 2.81, 0],
    labelHeight: 6.2,
    enabled: true,
    budget: { maxTriangles: 60000 },
    attribution: 'Meshy AI — generated original low-poly asset (text→image→3D), texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
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
    // Issue #25: Meshy image→3D low-poly kiosk (4703 tris, 1K texture). Uniform scale + base
    // offset fit the ~1.7×2.2×0.5 kiosk footprint (center-origin model); the collider stays
    // in CityColliders, so a missing GLB falls back to JobKioskMesh with no gameplay change.
    glbPath: 'assets/models/props/prop_job_kiosk_01.glb',
    fallbackKey: 'JobKioskMesh',
    scale: [1.3, 1.3, 1.3],
    positionOffset: [0, 1.24, 0],
    enabled: true,
    attribution: 'Meshy AI — generated original low-poly asset (text→image→3D), texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
  },
  {
    ...defaults,
    id: 'building_townhomes_01',
    label: 'Residential apartment (Residential Street)',
    category: 'city',
    // Issue #21 §6: a production low-poly apartment GLB (~6.6k tris, 1K texture)
    // projected via LandmarkAsset. Colliders/anchors come from cityLayout (7×6×7
    // lot), never the model. Authored bbox 1.26×1.91×1.27, centered origin →
    // uniform ~5.5× fills the footprint; offset raises the base to the ground.
    glbPath: 'assets/models/city/blocklife_apartment_hq_01.glb',
    fallbackKey: 'BuildingMesh',
    scale: [5.5, 5.5, 5.5],
    positionOffset: [0, 5.2, 0],
    labelHeight: 11.5,
    enabled: true,
    budget: { maxTriangles: 60000 },
    attribution: 'Meshy AI — generated original low-poly asset (text→image→3D), texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
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
  // ---- Vehicles (issue #21 §5): a GLB body projects onto the ONE driving shell.
  // enabled:false keeps the procedural CarMesh until a real, licensed GLB is dropped
  // in and its material slots verified via the asset-report. Physics/footprint always
  // come from getActiveVehicleProjection(), never the model. ----
  {
    ...defaults,
    id: 'vehicle_compact_car_01',
    label: 'Compact Car (drivable shell)',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/compact_sedan_01.glb',
    fallbackKey: 'CarMesh',
    // Issue #38 Wave 0: the owner-approved sprint sedan body projects onto the SAME one
    // physical shell. Authored bbox 1.896×0.843×0.932 (length X, up Y) with its origin at
    // the wheels; yawed 90° so length runs along +z (the shell's nose axis) and scaled to
    // the CarMesh reference footprint 2.00×1.61×3.81. Physics, tuning, occupants, lights,
    // theft, ownership and save all still come from getActiveVehicleProjection().
    scale: [2.146, 1.91, 2.009],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 40000 },
    materialSlots: { paint: ['paint'] },
    attribution: 'Meshy AI — generated original low-poly asset (text→image→3D), normalized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
    bounds: { width: 2.0, height: 1.61, depth: 3.81 },
  },
  // Issue #21 §10: the other three ownable classes ship distinct GLB bodies (all
  // ≤12k tris, single normalized `paint` material). Projected onto the ONE shell
  // exactly like the Compact — physics/footprint always from getActiveVehicleProjection().
  // Scales fill the CarMesh reference footprint (~2×1.6×3.9); Vehicle.tsx's meshScale
  // then adapts to each class collider. Origin is at the wheels (remesh origin=bottom).
  {
    ...defaults,
    id: 'vehicle_scooter_01',
    label: 'City Scooter (drivable shell)',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/scooter_01.glb',
    fallbackKey: 'CarMesh',
    scale: [2.05, 1.22, 2.25],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 40000 },
    materialSlots: { paint: ['paint'] },
    attribution: 'Meshy AI — generated original low-poly asset (text→image→3D), remeshed + normalized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
    bounds: { width: 1.8, height: 1.6, depth: 3.9 },
  },
  {
    ...defaults,
    id: 'vehicle_utility_van_01',
    label: 'Utility Van (drivable shell)',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/utility_van_01.glb',
    fallbackKey: 'CarMesh',
    scale: [2.05, 1.52, 2.48],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 40000 },
    materialSlots: { paint: ['paint'] },
    attribution: 'Meshy AI — generated original low-poly asset (text→image→3D), remeshed + normalized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
    bounds: { width: 2.0, height: 1.6, depth: 3.9 },
  },
  {
    ...defaults,
    id: 'vehicle_sports_car_01',
    label: 'Premium Sports Car (drivable shell)',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/sports_car_01.glb',
    fallbackKey: 'CarMesh',
    scale: [2.05, 2.4, 2.32],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 40000 },
    materialSlots: { paint: ['paint'] },
    attribution: 'Meshy AI — generated original low-poly asset (text→image→3D), remeshed + normalized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
    bounds: { width: 2.0, height: 1.3, depth: 3.9 },
  },
  // ---- Characters (issue #21 §4): CANONICAL catalog row. The rig-specific detail
  // (skeleton/clips/slots/bounds) lives in characterManifest.ts CHARACTER_ASSETS; a
  // consistency test asserts each character id here matches that def. Characters render
  // through AnimatedCharacter, never LandmarkAsset, so `enabled` here is catalog-only. ----
  {
    ...defaults,
    id: 'blocklife_person',
    label: 'BlockLife person (default rig)',
    category: 'characters',
    glbPath: 'assets/models/characters/blocklife_person.glb',
    fallbackKey: 'blocklife_primitive',
    enabled: true,
    budget: { maxTriangles: 45000 },
    attribution: 'BlockLife — original in-repo authored rig (scripts/buildCharacterGlb.mjs)',
    license: 'Original (project license)',
  },
  {
    ...defaults,
    id: 'blocklife_female_01',
    label: 'Female civilian humanoid (§21 §4)',
    category: 'characters',
    glbPath: 'assets/models/characters/blocklife_female_01.glb',
    fallbackKey: 'blocklife_primitive',
    enabled: true,
    budget: { maxTriangles: 25000 },
    attribution: 'Meshy AI — generated original low-poly humanoid (text→image→3D→rig), remeshed + texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
  },
  {
    ...defaults,
    id: 'blocklife_male_01',
    label: 'Male civilian humanoid (§21 §4)',
    category: 'characters',
    glbPath: 'assets/models/characters/blocklife_male_01.glb',
    fallbackKey: 'blocklife_primitive',
    enabled: true,
    budget: { maxTriangles: 25000 },
    attribution: 'Meshy AI — generated original low-poly humanoid (text→image→3D→rig), remeshed + texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
  },
  // ---- Issue #38 Integration Wave 0: owner-approved sprint characters. Each ships as ONE
  // production GLB carrying all three semantic clips (Idle / Walk / Run) on the canonical
  // 24-bone c432d433d51d skeleton — assembled by scripts/asset-intake/buildWave0.mjs from the
  // three per-clip sprint sources, which share a byte-identical mesh/texture/skeleton. No second
  // character or animation system; the primitive fallback stays authoritative on load failure. ----
  {
    ...defaults,
    id: 'blocklife_kabir_01',
    label: 'Kabir Sen — player character (issue #38 Wave 0)',
    category: 'characters',
    glbPath: 'assets/models/characters/blocklife_kabir_01.glb',
    fallbackKey: 'blocklife_primitive',
    enabled: true,
    budget: { maxTriangles: 45000 },
    attribution: 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), assembled + texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
  },
  {
    ...defaults,
    id: 'blocklife_ravi_01',
    label: 'Ravi Sharma — named NPC npc_ravi_01 (issue #38 Wave 0)',
    category: 'characters',
    glbPath: 'assets/models/characters/blocklife_ravi_01.glb',
    fallbackKey: 'blocklife_primitive',
    enabled: true,
    budget: { maxTriangles: 25000 },
    attribution: 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), assembled + texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
  },
  // ---- Issue #38 Wave 0 prop: the park bench projects onto the EXISTING `bench` prop type.
  // Placements, solidity and collision stay in cityLayout/PROP_SOLIDITY; the procedural
  // <Bench /> remains the LandmarkAsset fallback child. No duplicate prop, no new collider. ----
  {
    ...defaults,
    id: 'prop_park_bench_01',
    label: 'Park bench (issue #38 Wave 0)',
    category: 'props',
    glbPath: 'assets/models/props/prop_park_bench_01.glb',
    fallbackKey: 'Bench',
    // Model 1.899 × 0.991 × 0.828, origin at its base. Uniform 0.7729 is the largest scale that
    // fits ENTIRELY inside the authored bench visual bounds (half [0.9, 0.32], vertical [0, 1.06])
    // in propPlacement.ts, so the placement validators keep passing unchanged.
    scale: [0.7729, 0.7729, 0.7729],
    rotation: [0, 0, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 10000 },
    materialSlots: { paint: ['bench'] },
    attribution: 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), assembled + texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
  },
  // NOTE (issue #27 H0): `human_gold_calibration_01` is intentionally NOT in this production manifest.
  // It is a not-yet-approved REVIEW asset kept outside public/ (dev-review-assets/) and loaded only
  // through the DEV review harness — see the note in characterManifest.ts. Not shipped in dist/.
]

export const ASSET_MANIFEST_BY_ID: ReadonlyMap<string, AssetManifestEntry> = new Map(
  ASSET_MANIFEST.map((e) => [e.id, e]),
)

const CATEGORIES: AssetCategory[] = ['city', 'vehicles', 'characters', 'props']

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}

function isHexColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
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
    // Issue #21 additive fields (all optional).
    if (e.budget) {
      if (e.budget.maxTriangles !== undefined && !(e.budget.maxTriangles > 0)) {
        errors.push(`${where}: budget.maxTriangles must be positive`)
      }
      if (e.budget.maxTexture !== undefined && !(e.budget.maxTexture > 0)) {
        errors.push(`${where}: budget.maxTexture must be positive`)
      }
    }
    if (e.materialSlots) {
      for (const [slot, names] of Object.entries(e.materialSlots)) {
        if (!Array.isArray(names) || names.length === 0 || names.some((n) => !n)) {
          errors.push(`${where}: materialSlots.${slot} must be a non-empty string[]`)
        }
      }
    }
    if (e.variants) {
      for (const [name, variant] of Object.entries(e.variants)) {
        for (const [slot, override] of Object.entries(variant)) {
          if (override.color !== undefined && !isHexColor(override.color)) {
            errors.push(`${where}: variant "${name}".${slot}.color must be #rrggbb`)
          }
          if (e.materialSlots && !(slot in e.materialSlots)) {
            errors.push(`${where}: variant "${name}" targets undeclared slot "${slot}"`)
          }
        }
      }
    }
    if (e.bounds && !(e.bounds.width > 0 && e.bounds.height > 0 && e.bounds.depth > 0)) {
      errors.push(`${where}: bounds must have positive width/height/depth`)
    }
  }
  return errors
}
