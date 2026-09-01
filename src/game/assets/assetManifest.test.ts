import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STREET_PROP_ASSET_IDS } from '../world/propAssetIds'
import { ASSET_MANIFEST, validateManifest, type AssetManifestEntry } from './assetManifest'
import { getManifestEntry, shouldLoadGlb } from './modelRegistry'
import { BUILDINGS, FOOD_TRUCK, JOB_KIOSK, PROPS } from '../world/cityLayout'
import { STATIC_FOOTPRINTS } from '../world/collisionQuery'
import { CHARACTER_ASSETS } from '../characters/characterManifest'

const LANDMARK_IDS = [
  'building_apartment_01',
  'building_gym_01',
  'building_office_01',
  'building_tower_01',
  'food_truck_01',
  'prop_job_kiosk_01',
]

describe('asset manifest', () => {
  it('is valid', () => {
    expect(validateManifest(ASSET_MANIFEST)).toEqual([])
  })

  it('registers all target landmarks', () => {
    for (const id of LANDMARK_IDS) {
      expect(getManifestEntry(id), `manifest entry for ${id}`).toBeDefined()
    }
  })

  it('every enabled entry points at a file that exists under public/', () => {
    const enabled = ASSET_MANIFEST.filter((e) => shouldLoadGlb(e))
    // Quaternius landmark integration: four building landmarks + five street props.
    const landmarkEnabled = enabled.filter((e) => e.category === 'city' || e.category === 'props')
    // Quaternius landmarks + the Meshy townhome + issue #25 Stage A (the residential-house
    // archetype + the now-enabled job kiosk).
    expect(landmarkEnabled.map((e) => e.id).sort()).toEqual([
      'arch_residential_house_01',
      'building_apartment_01',
      'building_gym_01',
      'building_office_01',
      'building_tower_01',
      'building_townhomes_01',
      'prop_ac_unit_01',
      'prop_bollard_01',
      'prop_drain_01',
      'prop_job_kiosk_01',
      'prop_manhole_01',
      'prop_park_bench_01',
      'prop_street_planter_01',
    ])
    // Issue #21 §4 three enabled character rigs (default + female + male humanoids), plus the
    // two owner-approved issue #38 Wave 0 CANDIDATE rigs (Kabir, Ravi) — DEV review only, in
    // no runtime slot: they are single-baked-material and cannot carry the wardrobe/identity axes.
    expect(
      enabled
        .filter((e) => e.category === 'characters')
        .map((e) => e.id)
        .sort(),
    ).toEqual([
      'blocklife_female_01',
      'blocklife_kabir_01',
      'blocklife_male_01',
      'blocklife_person',
      'blocklife_ravi_01',
    ])
    // Every enabled GLB (landmarks + the character rig) points at a real file.
    for (const entry of enabled) {
      const file = join(process.cwd(), 'public', entry.glbPath!)
      expect(existsSync(file), `${entry.id}: missing file ${entry.glbPath}`).toBe(true)
    }
  })

  it('every enabled entry carries license and attribution metadata', () => {
    for (const entry of ASSET_MANIFEST.filter((e) => e.enabled)) {
      expect(entry.license, `${entry.id} license`).toBeTruthy()
      expect(entry.attribution, `${entry.id} attribution`).toBeTruthy()
    }
  })

  it('keeps procedural fallbacks registered for every entry, enabled or not', () => {
    for (const entry of ASSET_MANIFEST) {
      expect(entry.fallbackKey, `${entry.id} fallbackKey`).toBeTruthy()
    }
    // The food truck stays procedural-only (its GLB is a later harvest target); the job
    // kiosk is enabled in issue #25 Stage A (its fallback JobKioskMesh is still registered).
    expect(shouldLoadGlb(getManifestEntry('food_truck_01'))).toBe(false)
    expect(getManifestEntry('prop_job_kiosk_01')?.fallbackKey).toBe('JobKioskMesh')
  })

  it('every city/prop manifest id maps to layout data, so colliders never depend on GLBs', () => {
    const layoutIds = new Set([
      ...BUILDINGS.map((b) => b.id),
      FOOD_TRUCK.id,
      JOB_KIOSK.id,
      ...PROPS.map((p) => p.id),
    ])
    // Reusable visual archetypes (issue #25) are referenced via BuildingDef.visual.assetId,
    // never placed directly; each PLACEMENT keeps its own def.id collider, so the archetype
    // id itself needs no direct layout entry and a missing archetype GLB still cannot remove
    // a collider — the invariant holds through the placement.
    const archetypeIds = new Set([
      ...BUILDINGS.map((b) => b.visual?.assetId).filter((id): id is string => Boolean(id)),
      // Prop TYPE archetypes (issue #38): one GLB backs every placement of a type. The
      // placements keep their own def.id colliders and type-based PROP_SOLIDITY, so the
      // "a GLB can never remove a collider" invariant holds through the placement.
      ...Object.values(STREET_PROP_ASSET_IDS).filter((id): id is string => Boolean(id)),
    ])
    // City + prop GLBs must map to authored layout colliders (directly, or via a placement
    // that references them as an archetype), so a missing/broken GLB can never remove a
    // collider. Vehicles (issue #21 §5) get their collider from the ONE driving shell
    // (getActiveVehicleProjection), and characters from the character controller capsule —
    // never cityLayout — so they are correctly excluded here and covered by their own suites.
    for (const entry of ASSET_MANIFEST) {
      if (entry.category === 'vehicles' || entry.category === 'characters') continue
      expect(
        layoutIds.has(entry.id) || archetypeIds.has(entry.id),
        `${entry.id} missing from cityLayout`,
      ).toBe(true)
    }
    // The physics footprints exist without touching the manifest at all.
    expect(STATIC_FOOTPRINTS.length).toBeGreaterThan(0)
  })

  it('validation catches broken entries', () => {
    const good = ASSET_MANIFEST[0]
    const broken: AssetManifestEntry[] = [
      { ...good, id: 'dup' },
      { ...good, id: 'dup' },
      { ...good, id: 'no_label', label: '' },
      { ...good, id: 'bad_path', glbPath: '/absolute/wrong.glb' },
      { ...good, id: 'bad_ext', glbPath: 'assets/models/city/model.png' },
      { ...good, id: 'enabled_without_path', glbPath: null, enabled: true },
      { ...good, id: 'bad_scale', scale: [1, Number.NaN, 1] },
      {
        ...good,
        id: 'bad_category',
        category: 'weapons' as AssetManifestEntry['category'],
      },
    ]
    const errors = validateManifest(broken)
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true)
    expect(errors.some((e) => e.includes('label is required'))).toBe(true)
    expect(errors.some((e) => e.includes('start with "assets/"'))).toBe(true)
    expect(errors.some((e) => e.includes('.glb or .gltf'))).toBe(true)
    expect(errors.some((e) => e.includes('enabled without a glbPath'))).toBe(true)
    expect(errors.some((e) => e.includes('scale must be'))).toBe(true)
    expect(errors.some((e) => e.includes('invalid category'))).toBe(true)
  })

  it('validation catches broken issue-#21 fields (budget/variants/slots/bounds)', () => {
    const good = ASSET_MANIFEST[0]
    const broken: AssetManifestEntry[] = [
      { ...good, id: 'bad_budget', budget: { maxTriangles: -1 } },
      { ...good, id: 'empty_slot', materialSlots: { paint: [] } },
      {
        ...good,
        id: 'bad_variant_color',
        materialSlots: { paint: ['body'] },
        variants: { red: { paint: { color: 'red' } } },
      },
      {
        ...good,
        id: 'undeclared_slot',
        materialSlots: { paint: ['body'] },
        variants: { x: { wheel: { color: '#ffffff' } } },
      },
      { ...good, id: 'bad_bounds', bounds: { width: 0, height: 1, depth: 1 } },
    ]
    const errors = validateManifest(broken)
    expect(errors.some((e) => e.includes('budget.maxTriangles must be positive'))).toBe(true)
    expect(errors.some((e) => e.includes('materialSlots.paint must be a non-empty'))).toBe(true)
    expect(errors.some((e) => e.includes('color must be #rrggbb'))).toBe(true)
    expect(errors.some((e) => e.includes('undeclared slot'))).toBe(true)
    expect(errors.some((e) => e.includes('bounds must have positive'))).toBe(true)
  })

  it('registers the vehicle + character canonical rows with sane budgets (§4/§5)', () => {
    const car = getManifestEntry('vehicle_compact_car_01')
    expect(car?.category).toBe('vehicles')
    expect(car?.budget?.maxTriangles).toBe(40000)
    expect((car?.materialSlots?.paint ?? []).length).toBeGreaterThan(0)
    const person = getManifestEntry('blocklife_person')
    expect(person?.category).toBe('characters')
    expect(person?.budget?.maxTriangles).toBe(45000)
  })

  it('every character asset def has a matching canonical manifest row (§4)', () => {
    for (const [id, def] of Object.entries(CHARACTER_ASSETS)) {
      const entry = getManifestEntry(id)
      expect(entry, `manifest row for character ${id}`).toBeDefined()
      expect(entry!.category).toBe('characters')
      expect(entry!.glbPath).toBe(def.modelPath)
    }
  })
})
