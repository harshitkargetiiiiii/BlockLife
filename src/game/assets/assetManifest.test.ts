import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST, validateManifest, type AssetManifestEntry } from './assetManifest'
import { getManifestEntry, shouldLoadGlb } from './modelRegistry'
import { BUILDINGS, FOOD_TRUCK, JOB_KIOSK, PROPS } from '../world/cityLayout'
import { STATIC_FOOTPRINTS } from '../world/collisionQuery'

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
    // Quaternius integration: four building landmarks + five street props.
    expect(enabled.map((e) => e.id).sort()).toEqual([
      'building_apartment_01',
      'building_gym_01',
      'building_office_01',
      'building_tower_01',
      'building_townhomes_01',
      'prop_ac_unit_01',
      'prop_bollard_01',
      'prop_drain_01',
      'prop_manhole_01',
      'prop_street_planter_01',
    ])
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
    // Landmarks that have no suitable pack model stay procedural-only.
    expect(shouldLoadGlb(getManifestEntry('food_truck_01'))).toBe(false)
    expect(shouldLoadGlb(getManifestEntry('prop_job_kiosk_01'))).toBe(false)
  })

  it('every manifest id maps to layout data, so colliders never depend on GLBs', () => {
    const layoutIds = new Set([
      ...BUILDINGS.map((b) => b.id),
      FOOD_TRUCK.id,
      JOB_KIOSK.id,
      ...PROPS.map((p) => p.id),
    ])
    for (const entry of ASSET_MANIFEST) {
      expect(layoutIds.has(entry.id), `${entry.id} missing from cityLayout`).toBe(true)
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
})
