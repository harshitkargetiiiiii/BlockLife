import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BUILDINGS, JOB_KIOSK, PROPS } from '../world/cityLayout'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { VARIANT_CACHE_NO_CACHE_ASSET_IDS, deriveVariantCacheExpectations, variantCacheAuthoredPlacementIds, variantCacheScannedAssetIds } from './variantCacheExpectations'

/**
 * Issue #67 — the derived variant-cache universe for the CURRENT authored city, pinned by literals written here rather
 * than by the key generator the derivation uses, plus the GLB facts that make the pinned material set exact.
 */

const OFFICE_KEY_LITERAL = 'building_office_01|wall:wall|∅'

function glbJson(glbPath: string): { meshes: { primitives: { material?: number }[] }[]; materials?: { name?: string }[] } {
  const buf = readFileSync(`public/${glbPath}`)
  expect(buf.readUInt32LE(0), `${glbPath} glTF magic`).toBe(0x46546c67)
  const length = buf.readUInt32LE(12)
  expect(buf.readUInt32LE(16), `${glbPath} JSON chunk`).toBe(0x4e4f534a)
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'))
}

describe('issue #67 — derived variant-cache expectations', () => {
  it('the current city derives exactly ONE key: the office wall set shared by the two projected offices', () => {
    expect(deriveVariantCacheExpectations()).toEqual([
      { key: OFFICE_KEY_LITERAL, assetId: 'building_office_01', materialNames: ['wall'], placementIds: ['s1_-1_n1', 's1_-2_n1'] },
    ])
  })

  it('agrees with a raw read of the authored fields that does not use projection resolution or the key generator', () => {
    const raw = BUILDINGS.filter((b) => {
      const e = b.visual ? ASSET_MANIFEST_BY_ID.get(b.visual.assetId) : undefined
      return Boolean(e?.enabled && e.glbPath && e.materialSlots && Object.values(e.materialSlots).flat().length > 0)
    })
    expect(raw.map((b) => [b.id, b.visual!.assetId, b.visual!.paletteVariant ?? b.paletteVariant ?? null])).toEqual([
      ['s1_-1_n1', 'building_office_01', null],
      ['s1_-2_n1', 'building_office_01', null],
    ])
    expect(ASSET_MANIFEST_BY_ID.get('building_office_01')!.materialSlots).toEqual({ wall: ['wall'] })
  })

  it('the shipped office GLB has one mesh with one primitive referencing its sole material, named "wall"', () => {
    const entry = ASSET_MANIFEST_BY_ID.get('building_office_01')!
    expect(createHash('sha256').update(readFileSync(`public/${entry.glbPath}`)).digest('hex')).toBe('fb5b709ac0758d32f8a0e3af728c726424c3ae3fa666090a1faafc00e465f624')
    const json = glbJson(entry.glbPath!)
    expect(json.materials?.map((m) => m.name)).toEqual(['wall'])
    expect(json.meshes.map((m) => m.primitives.map((p) => p.material))).toEqual([[0]])
  })

  it('direct own-row landmarks with slots (Nook Offices, gym, tower) are never expected cache owners', () => {
    const owners = deriveVariantCacheExpectations().flatMap((e) => e.placementIds)
    for (const id of ['building_office_01', 'building_gym_01', 'building_tower_01']) {
      expect(BUILDINGS.find((b) => b.id === id)?.visual, `${id} is a direct row`).toBeUndefined()
      expect(owners, id).not.toContain(id)
    }
  })

  it('the Stage A calibration house and kiosk are pinned as no-cache assets and neither declares a recolorable slot', () => {
    expect(VARIANT_CACHE_NO_CACHE_ASSET_IDS).toEqual(['arch_residential_house_01', 'prop_job_kiosk_01'])
    for (const id of VARIANT_CACHE_NO_CACHE_ASSET_IDS) {
      const entry = ASSET_MANIFEST_BY_ID.get(id)!
      expect(entry.enabled, `${id} enabled`).toBe(true)
      expect(Object.values(entry.materialSlots ?? {}).flat(), `${id} declares no slot material`).toEqual([])
      expect(deriveVariantCacheExpectations().some((e) => e.assetId === id), `${id} derives no key`).toBe(false)
      // Its GLB materials are unnamed, so no runtime slot name could ever match them.
      expect((glbJson(entry.glbPath!).materials ?? []).map((m) => m.name ?? null), `${id} material names`).toEqual([null])
    }
    expect(BUILDINGS.filter((b) => b.visual?.assetId === 'arch_residential_house_01').length, 'the calibration house is a real projected consumer').toBeGreaterThan(0)
  })

  it('follows the authored palette: the same office with a palette derives a different key (not the observed one)', () => {
    const def = BUILDINGS.find((b) => b.id === 's1_-1_n1')!
    const tinted = { ...def, visual: { ...def.visual!, paletteVariant: { wall: { color: '#ff0000' } } } }
    expect(deriveVariantCacheExpectations([tinted]).map((e) => e.key)).toEqual(['building_office_01|wall:wall|wall=#ff0000'])
    expect(deriveVariantCacheExpectations([{ ...def, visual: undefined }])).toEqual([])
  })

  it('the usage scan covers every slot-declaring row plus the no-cache assets', () => {
    expect([...variantCacheScannedAssetIds()].sort()).toEqual(
      [...new Set([...VARIANT_CACHE_NO_CACHE_ASSET_IDS, ...[...ASSET_MANIFEST_BY_ID.values()].filter((e) => Object.values(e.materialSlots ?? {}).flat().length > 0).map((e) => e.id)])].sort(),
    )
    expect(variantCacheScannedAssetIds().has('building_office_01')).toBe(true)
  })

  it('placement attribution covers every authored building, street prop and the job kiosk, with no id shared between them', () => {
    const ids = variantCacheAuthoredPlacementIds()
    expect(ids.size, 'buildings + props + kiosk, all distinct').toBe(BUILDINGS.length + PROPS.length + 1)
    for (const id of ['s1_-1_n1', 'building_office_01', 'prop_bench_01', 'prop_bench_r1', JOB_KIOSK.id]) expect(ids.has(id), id).toBe(true)
    expect(PROPS.filter((p) => p.type === 'bench').length, 'many authored benches share one asset').toBeGreaterThan(1)
  })
})
