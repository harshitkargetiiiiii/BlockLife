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
  /**
   * Where the occupant indicators sit on THIS body (issue #40), in WORLD metres relative to the
   * vehicle's ground origin: x = lateral (+ right), y = up from the ground, z = longitudinal
   * (+z is the nose). Only consulted when the GLB body is the thing rendering — the procedural
   * fallback keeps CarMesh's own seat, so nothing changes when a model is missing.
   *
   * A GLB body is scaled to its own class footprint, so the single CarMesh seat position (tuned
   * for a 2.0 x 1.36 x 3.9 sedan) lands in a different place on every one of them — on the
   * scooter it landed INSIDE the bodywork and the rider was invisible, which is exactly what the
   * "occupied seat alignment" evidence exists to catch. Declaring the seat per asset is the
   * bounded fix: it is presentation data on the visual, and it changes no seat COUNT, occupancy
   * rule, ride eligibility or save field — `VehicleDef.seats` remains the gameplay authority.
   */
  occupants?: {
    driver: [number, number, number]
    passenger?: [number, number, number]
    /** Indicator sphere radius in world metres (CarMesh's is 0.24). */
    radius?: number
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
    // Holds the Building_Large_2 archetype at backdrop scale (one download, cloned scene);
    // façade faces east, toward the city. Since issue #38 Wave 0 moved Nook Offices onto its
    // own sprint GLB, this is the only placement of this pack model.
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
    // physical shell. Measured bbox 1.8963 × 0.8432 × 0.9320 (length X, up Y, width Z),
    // origin at the wheels (min Y = 0, so no vertical offset is needed).
    //
    // SCALE IS APPLIED IN LOCAL SPACE, BEFORE the 90° yaw — so local X drives world LENGTH
    // (+z, the shell's nose axis) and local Z drives world WIDTH. Getting that mapping
    // backwards produced a 1.87 m × 4.07 m shell (issue #38 Codex review, finding 4).
    //   scale.x = 3.81 / 1.8963 = 2.0092  -> world length 3.810
    //   scale.y = 1.61 / 0.8432 = 1.9094  -> world height 1.610
    //   scale.z = 2.00 / 0.9320 = 2.1459  -> world width  2.000
    // matching the CarMesh reference footprint 2.00 × 1.61 × 3.81 that the previous GLB hit.
    // `wave0Contract.test.ts` recomputes this projection so the axes cannot silently swap.
    // Physics, tuning, occupants, lights, theft, ownership and save all still come from
    // getActiveVehicleProjection().
    scale: [2.0092, 1.9094, 2.1459],
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
    // Issue #40 Wave 1: the owner-approved sprint scooter projects onto the SAME one physical
    // shell. Measured local bbox 1.8977 × 1.4394 × 0.9071 (length X, up Y, width Z), origin at
    // the wheels (min Y = 0), so no vertical offset is needed.
    //
    // TWO factors decide the rendered size, and both must be in the derivation:
    //   1. this scale, applied in LOCAL space BEFORE the 90° yaw — so local X drives world
    //      LENGTH and local Z drives world WIDTH (the axis swap issue #38's review caught on
    //      the sedan). The model's nose is at local −X, which the +π/2 yaw maps onto the
    //      shell's +z nose (CarMesh puts its headlights at z = +1.96).
    //   2. `shellMeshScale(veh_scooter.collider)` = [0.55, 0.909091, 0.55], which the one shell
    //      applies to its whole mesh group in WORLD axes. Ignoring it renders the body at 0.55×.
    //
    // So this scale is chosen to CANCEL that non-uniform factor — scale.i = k / meshScale — which
    // makes the RENDERED body exactly uniform (its authored proportions ship undistorted) at
    //   k = min(2·1.1·0.97 / 1.8977, 2·0.55·0.97 / 0.9071) = min(1.124519, 1.176276) = 1.1245192
    // → 2.1339 long × 1.6185 tall × 1.0200 wide, strictly inside the 2.2 × 1.1 class footprint.
    // `wave1Contract.test.ts` recomputes all of this from vehicleRegistry + shellMeshScale.
    scale: [2.0445, 1.2369, 2.0445],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 40000 },
    // Issue #40: this body is ONE BAKED ATLAS — windows, lights, tyres and trim live in the same
    // texture as the panels — so it exposes NO clean recolorable body slot. An explicitly EMPTY
    // map means "retain the source paint": the variant system isolates nothing and tints nothing,
    // instead of recoloring the whole atlas and falsely claiming per-panel paint. Customization
    // and save state are untouched — the selected paint is still stored, still shown in the
    // Garage, and still tints the procedural fallback shell. Re-authoring the body with real
    // material segmentation is what unlocks a real `paint` slot here.
    materialSlots: {},
    attribution: 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
    // The ACTIVE (driven) projection — see docs/ASSET_INTEGRATION_WAVE_1.md for the parked-mesh
    // divergence, which is a pre-existing renderer behaviour this wave does not change.
    bounds: { width: 1.02, height: 1.6185, depth: 2.1339 },
    // Rider seated on the scooter's saddle: centred laterally (single-track), just behind the
    // body's midpoint, head clear of the 1.62 m silhouette so it reads as a rider rather than
    // disappearing into the bodywork.
    occupants: { driver: [0, 1.28, -0.16], radius: 0.2 },
  },
  {
    ...defaults,
    id: 'vehicle_utility_van_01',
    label: 'Utility Van (drivable shell)',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/utility_van_01.glb',
    fallbackKey: 'CarMesh',
    // Issue #40 Wave 1. Measured local bbox 1.8979 × 1.2643 × 0.9323 (length X, up Y, width Z),
    // origin at the wheels. Same two-factor rule as the scooter above, with
    // `shellMeshScale(veh_van.collider)` = [1.2, 1.272727, 1.25].
    //
    // k = min(2·2.5·0.97 / 1.8979, 2·1.2·0.97 / 0.9323) = min(2.555456, 2.497050) = 2.4970503
    // WIDTH binds here, not length — this high-roof van is proportionally wider than the class
    // footprint's length:width ratio, so filling the length would have overhung the width.
    // → 4.7391 long × 3.1569 tall × 2.3279 wide, inside the 5.0 × 2.4 class footprint.
    // The 3.16 m height is the approved model's own high-roof-plus-roof-rack proportion carried
    // through undistorted (2.0× the compact's 1.61 m, close to a real Sprinter vs hatchback).
    scale: [1.9976, 1.9619, 2.0808],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 40000 },
    // Issue #40: this body is ONE BAKED ATLAS — windows, lights, tyres and trim live in the same
    // texture as the panels — so it exposes NO clean recolorable body slot. An explicitly EMPTY
    // map means "retain the source paint": the variant system isolates nothing and tints nothing,
    // instead of recoloring the whole atlas and falsely claiming per-panel paint. Customization
    // and save state are untouched — the selected paint is still stored, still shown in the
    // Garage, and still tints the procedural fallback shell. Re-authoring the body with real
    // material segmentation is what unlocks a real `paint` slot here.
    materialSlots: {},
    attribution: 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
    bounds: { width: 2.3279, height: 3.1569, depth: 4.7391 },
    // Two seats read at the WINDSCREEN APERTURE, which is where this body can actually show them.
    // Measured height profile along the van's length: the nose is 1.32 m, the raked windscreen
    // climbs from 2.13 m at z≈1.2 to the roof, and from z≈1.0 rearward the body is a closed
    // 3.15 m box. Occupants seated inside that cab (tried at z 0.72) are under an opaque roof and
    // behind baked-dark glass — invisible from the shipped isometric camera, which is exactly
    // what issue #40's "driver/passenger alignment" evidence has to show. So the indicators sit
    // at the glass line rather than behind it, spread wide enough that the near one does not
    // eclipse the far one. The sedan's 1.25 m seat would have put both down in the engine bay.
    occupants: { driver: [-0.62, 2.02, 1.38], passenger: [0.62, 2.02, 1.38], radius: 0.24 },
  },
  {
    ...defaults,
    id: 'vehicle_sports_car_01',
    label: 'Premium Sports Car (drivable shell)',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/sports_car_01.glb',
    fallbackKey: 'CarMesh',
    // Issue #40 Wave 1. Measured local bbox 1.8948 × 0.5636 × 0.8620 (length X, up Y, width Z),
    // origin at the wheels. Same two-factor rule as the scooter above, with
    // `shellMeshScale(veh_sports.collider)` = [1.05, 0.909091, 1.0].
    //
    // k = min(2·2.0·0.97 / 1.8948, 2·1.05·0.97 / 0.8620) = min(2.047710, 2.363109) = 2.0477095
    // → 3.8800 long × 1.1540 tall × 1.7650 wide, inside the 4.0 × 2.1 class footprint: longer
    // than the compact and markedly lower (1.15 m vs 1.61 m), which is the coupe silhouette.
    scale: [2.0477, 2.2524, 1.9501],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0, 0],
    enabled: true,
    budget: { maxTriangles: 40000 },
    // Issue #40: this body is ONE BAKED ATLAS — windows, lights, tyres and trim live in the same
    // texture as the panels — so it exposes NO clean recolorable body slot. An explicitly EMPTY
    // map means "retain the source paint": the variant system isolates nothing and tints nothing,
    // instead of recoloring the whole atlas and falsely claiming per-panel paint. Customization
    // and save state are untouched — the selected paint is still stored, still shown in the
    // Garage, and still tints the procedural fallback shell. Re-authoring the body with real
    // material segmentation is what unlocks a real `paint` slot here.
    materialSlots: {},
    attribution: 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo',
    license: 'Meshy AI generated asset (meshy.ai terms)',
    bounds: { width: 1.765, height: 1.154, depth: 3.88 },
    // Low cabin set back from the long nose: this coupe is only 1.15 m tall, so the sedan's
    // 1.25 m seat floated the occupants above the roof.
    occupants: { driver: [-0.34, 1.02, -0.22], passenger: [0.34, 1.02, -0.22], radius: 0.22 },
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
  // ---- Issue #38 Integration Wave 0 CANDIDATE characters. Each ships as ONE
  // production GLB carrying all three semantic clips (Idle / Walk / Run) on the canonical
  // 24-bone c432d433d51d skeleton — assembled by scripts/asset-intake/buildWave0.mjs from the
  // three per-clip sprint sources, which share a byte-identical mesh/texture/skeleton. No second
  // character or animation system; the primitive fallback stays authoritative on load failure.
  //
  // OWNER DECISION 2026-08-31: these carry ONE baked material and so cannot expose the
  // recolorable slots the save-backed player wardrobe and the issue #23 identity axes require.
  // They are therefore CANDIDATE assets — present, valid and loadable, but deliberately NOT the
  // player and NOT named by any NPC def. See CANDIDATE_CHARACTER_ASSET_IDS. ----
  {
    ...defaults,
    id: 'blocklife_kabir_01',
    label: 'Kabir Sen — candidate character (issue #38 Wave 0, not in a runtime slot)',
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
    label: 'Ravi Sharma — candidate character (issue #38 Wave 0, not in a runtime slot)',
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
