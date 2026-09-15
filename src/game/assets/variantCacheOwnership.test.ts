import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  LANDMARK_GLB_ROOT_MARKER,
  NO_ASSET_SLOT,
  UNPLACED,
  checkVariantCacheOwnership,
  collectVariantCacheUsage,
  compareVariantCacheSnapshots,
  consumersOfVariantCacheKey,
  type VariantCacheExpectation,
  type VariantCacheOwnershipInput,
  type VariantCacheUsage,
} from './variantCacheOwnership'
import type { VariantCacheSnapshot } from './variantMaterialCache'

/**
 * Issue #67 — independent fixtures for the ownership gate. Every fixture is written by hand here: nothing is derived
 * from the checker, the city data or a running cache. The valid base is the healthy warmed shape (one shared office
 * entry; two projected offices whose MARKED model renders it; the direct Nook row on its own isolated material; the
 * Stage A house on its unnamed baked material); each negative changes one fact and must fail with its own code.
 */

const OFFICE = 'building_office_01'
const OFFICE_KEY = 'building_office_01|wall:wall|∅'
const WALL = { name: 'wall', uuid: 'u-wall', type: 'MeshStandardMaterial' }

function expectations(): VariantCacheExpectation[] {
  return [{ key: OFFICE_KEY, assetId: OFFICE, materialNames: ['wall'], placementIds: ['s1_-1_n1', 's1_-2_n1'] }]
}

function snapshot(entries: VariantCacheSnapshot['entries'] = [{ key: OFFICE_KEY, materials: [WALL] }]): VariantCacheSnapshot {
  return { keys: entries.length, materials: entries.reduce((n, e) => n + e.materials.length, 0), entries }
}

const model = (placementId: string, assetId: string, materials: { name: string; uuid: string }[]): VariantCacheUsage => ({
  placementId, assetId, modelAssetIds: [assetId], materials: materials.map((m) => ({ ...m, inModel: true })),
})

function usage(): VariantCacheUsage[] {
  return [
    model('building_house_r1', 'arch_residential_house_01', [{ name: '', uuid: 'u-house-baked' }]),
    model(OFFICE, OFFICE, [{ name: 'wall', uuid: 'u-nook-isolated' }]),
    model('s1_-1_n1', OFFICE, [{ name: 'wall', uuid: 'u-wall' }]),
    model('s1_-2_n1', OFFICE, [{ name: 'wall', uuid: 'u-wall' }]),
  ]
}

function input(over: Partial<VariantCacheOwnershipInput> = {}): VariantCacheOwnershipInput {
  const snap = over.snapshot ?? snapshot()
  return {
    stats: over.stats ?? { keys: snap.keys, materials: snap.materials },
    snapshot: snap,
    usage: over.usage ?? usage(),
    expectations: over.expectations ?? expectations(),
    noCacheAssetIds: over.noCacheAssetIds ?? ['arch_residential_house_01', 'prop_job_kiosk_01'],
  }
}

const codes = (problems: { code: string }[]) => [...new Set(problems.map((p) => p.code))].sort()
const withRecord = (i: number, record: VariantCacheUsage) => usage().map((u, j) => (j === i ? record : u))

describe('issue #67 — what passes', () => {
  it('ONE shared office entry rendered by both projected models; Nook keeps its isolated material', () => {
    expect(checkVariantCacheOwnership(input())).toEqual([])
    expect(consumersOfVariantCacheKey(snapshot(), usage(), OFFICE_KEY)).toEqual(['s1_-1_n1', 's1_-2_n1'])
  })

  it('a cold, empty cache passes but proves no sharing', () => {
    const cold = input({ snapshot: snapshot([]), usage: usage().slice(0, 2) })
    expect(checkVariantCacheOwnership(cold)).toEqual([])
    expect(consumersOfVariantCacheKey(cold.snapshot, cold.usage, OFFICE_KEY)).toEqual([])
  })

  it('a warmed key retained after its last consumer unmounted is valid membership', () => {
    const retained = input({ usage: usage().slice(0, 2) })
    expect(checkVariantCacheOwnership(retained)).toEqual([])
    expect(consumersOfVariantCacheKey(retained.snapshot, retained.usage, OFFICE_KEY)).toEqual([])
  })

  it('a projected slot with NO marked model root (loading/failed fallback) is not required to render the material', () => {
    const fallback: VariantCacheUsage = { placementId: 's1_-2_n1', assetId: OFFICE, modelAssetIds: [], materials: [{ name: '', uuid: 'u-proc', inModel: false }, { name: 'wall', uuid: 'u-proc-named', inModel: false }] }
    expect(checkVariantCacheOwnership(input({ usage: withRecord(3, fallback) }))).toEqual([])
    expect(consumersOfVariantCacheKey(snapshot(), withRecord(3, fallback), OFFICE_KEY)).toEqual(['s1_-1_n1'])
  })

  it('a faded consumer is attributed through the original its fade clone restores to', () => {
    const faded = withRecord(2, { ...usage()[2], materials: [{ name: 'wall', uuid: 'u-wall', fadeCloneUuid: 'u-fade-clone', inModel: true }] })
    expect(checkVariantCacheOwnership(input({ usage: faded }))).toEqual([])
    expect(consumersOfVariantCacheKey(snapshot(), faded, OFFICE_KEY)).toEqual(['s1_-1_n1', 's1_-2_n1'])
  })
})

describe('issue #67 — independent negatives: the cache entries', () => {
  it('rejects a key no authored projection derives, even one holding zero materials', () => {
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([snapshot().entries[0], { key: 'building_gym_01|trim:MI_Trim|wall:MI_Wall|∅', materials: [] }]) })))).toEqual(['unknown-key'])
  })

  it('rejects an altered slot signature or palette for the office as a different, unknown key', () => {
    for (const key of ['building_office_01|wall:wall,glass|∅', 'building_office_01|wall:wall|wall=#ff0000', 'building_office_01|wall:wall|']) {
      expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([{ key, materials: [WALL] }]) }))), key).toContain('unknown-key')
    }
  })

  it('rejects ANY entry for the Stage A house or kiosk, even when an expectation is supplied for it', () => {
    const houseKey = 'arch_residential_house_01|wall:MI_Wall|∅'
    const entries = [snapshot().entries[0], { key: houseKey, materials: [{ name: 'MI_Wall', uuid: 'u-house', type: 'MeshStandardMaterial' }] }]
    const houseExp = [...expectations(), { key: houseKey, assetId: 'arch_residential_house_01', materialNames: ['MI_Wall'], placementIds: ['building_house_r1'] }]
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot(entries), expectations: houseExp })))).toContain('forbidden-asset-key')
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([snapshot().entries[0], { key: 'prop_job_kiosk_01|body:kiosk|∅', materials: [] }]) })))).toEqual(['forbidden-asset-key', 'unknown-key'])
  })

  it('rejects a key listed twice (before any Map could merge it), and duplicate expectation/usage records', () => {
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([snapshot().entries[0], { key: OFFICE_KEY, materials: [{ ...WALL, uuid: 'u-wall-b' }] }]) })))).toContain('duplicate-key')
    expect(codes(checkVariantCacheOwnership(input({ expectations: [...expectations(), ...expectations()] })))).toContain('duplicate-expectation')
    expect(codes(checkVariantCacheOwnership(input({ usage: [...usage(), usage()[3]] })))).toEqual(['duplicate-usage'])
  })

  it('rejects an extra or wrongly named material in the shared set', () => {
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([{ key: OFFICE_KEY, materials: [{ ...WALL, name: 'glass', uuid: 'u-glass' }, WALL] }]) })))).toEqual(['unexpected-material'])
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([{ key: OFFICE_KEY, materials: [{ ...WALL, name: 'Wall' }] }]) })))).toEqual(['missing-material', 'uncached-projected-material', 'unexpected-material'])
  })

  it('rejects a shared set missing its declared material', () => {
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([{ key: OFFICE_KEY, materials: [] }]) })))).toEqual(['missing-material', 'uncached-projected-material'])
  })

  it('rejects the same material name allocated twice under one key', () => {
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([{ key: OFFICE_KEY, materials: [WALL, { ...WALL, uuid: 'u-wall-2' }] }]) })))).toEqual(['duplicate-material'])
  })

  it('rejects aggregate stats that disagree with the listed entries', () => {
    expect(codes(checkVariantCacheOwnership(input({ stats: { keys: 1, materials: 2 } })))).toEqual(['stats-mismatch'])
    expect(codes(checkVariantCacheOwnership(input({ snapshot: { ...snapshot(), keys: 0 } })))).toEqual(['stats-mismatch'])
  })
})

describe('issue #67 — independent negatives: who renders what', () => {
  it('rejects a MOUNTED office whose private clone was renamed "" — the model marker, not the name, decides', () => {
    const renamed = model('s1_-2_n1', OFFICE, [{ name: '', uuid: 'u-private-renamed' }])
    const p = checkVariantCacheOwnership(input({ usage: withRecord(3, renamed) }))
    expect(codes(p)).toEqual(['missing-material-usage'])
    expect(p[0].placementId).toBe('s1_-2_n1')
  })

  it('rejects a mounted projected model that lacks its declared material name', () => {
    expect(codes(checkVariantCacheOwnership(input({ usage: withRecord(3, model('s1_-2_n1', OFFICE, [{ name: 'window', uuid: 'u-window' }])) })))).toEqual(['missing-material-usage'])
  })

  it('rejects a projected model rendering a private copy instead of the shared material', () => {
    const p = checkVariantCacheOwnership(input({ usage: withRecord(3, model('s1_-2_n1', OFFICE, [{ name: 'wall', uuid: 'u-wall-private' }])) }))
    expect(codes(p)).toEqual(['uncached-projected-material'])
    expect(p[0].placementId).toBe('s1_-2_n1')
  })

  it('rejects one slot rendered with the shared AND a private material', () => {
    expect(codes(checkVariantCacheOwnership(input({ usage: withRecord(2, model('s1_-1_n1', OFFICE, [{ name: 'wall', uuid: 'u-wall' }, { name: 'wall', uuid: 'u-wall-private' }])) })))).toEqual(['duplicate-material', 'uncached-projected-material'])
  })

  it('rejects the cached material rendered by its own placement but outside the mounted model', () => {
    const outside: VariantCacheUsage = { placementId: 's1_-2_n1', assetId: OFFICE, modelAssetIds: [], materials: [{ name: 'wall', uuid: 'u-wall', inModel: false }] }
    expect(codes(checkVariantCacheOwnership(input({ usage: withRecord(3, outside) })))).toEqual(['cached-material-outside-model'])
  })

  it('rejects a slot whose model root is marked with a different asset', () => {
    const foreign: VariantCacheUsage = { ...usage()[3], modelAssetIds: [OFFICE, 'building_tower_01'] }
    expect(codes(checkVariantCacheOwnership(input({ usage: withRecord(3, foreign) })))).toEqual(['wrong-asset-usage'])
  })

  it('rejects a projected placement whose slot renders a different asset', () => {
    expect(codes(checkVariantCacheOwnership(input({ usage: withRecord(3, model('s1_-2_n1', 'building_tower_01', [{ name: 'MI_InteriorWall', uuid: 'u-tower' }])) })))).toEqual(['wrong-asset-usage'])
    expect(codes(checkVariantCacheOwnership(input({ usage: withRecord(3, model('s1_-2_n1', 'building_tower_01', [{ name: 'wall', uuid: 'u-wall' }])) })))).toEqual(['unknown-owner', 'wrong-asset-usage'])
  })

  it('rejects the direct Nook row rendering the cached material', () => {
    const p = checkVariantCacheOwnership(input({ usage: withRecord(1, model(OFFICE, OFFICE, [{ name: 'wall', uuid: 'u-wall' }])) }))
    expect(codes(p)).toEqual(['unknown-owner'])
    expect(p[0].placementId).toBe(OFFICE)
  })

  it('rejects an arbitrary asset that declares no slots (never scanned in full) rendering the cached material', () => {
    const shop = model('building_shop_c1', 'building_shop_01', [{ name: 'wall', uuid: 'u-wall' }])
    expect(codes(checkVariantCacheOwnership(input({ usage: [...usage(), shop] })))).toEqual(['unknown-owner'])
  })

  it('rejects the cached material on a mesh under no asset slot and no placement (an unknown wrapper)', () => {
    const stray: VariantCacheUsage = { placementId: UNPLACED, assetId: NO_ASSET_SLOT, modelAssetIds: [], materials: [{ name: 'wall', uuid: 'u-wall', inModel: false }] }
    const p = checkVariantCacheOwnership(input({ usage: [...usage(), stray] }))
    expect(codes(p)).toEqual(['unknown-owner'])
    expect(p[0].placementId).toBe(UNPLACED)
  })

  it('rejects a house or kiosk slot rendering a cached material', () => {
    expect(codes(checkVariantCacheOwnership(input({ usage: withRecord(0, model('building_house_r1', 'arch_residential_house_01', [{ name: 'wall', uuid: 'u-wall' }])) })))).toEqual(['forbidden-owner'])
  })

  it('rejects a mounted projected model whose shared set was never built', () => {
    expect(codes(checkVariantCacheOwnership(input({ snapshot: snapshot([]) })))).toEqual(['missing-key'])
  })
})

describe('issue #67 — collector: a marked model root is branch evidence on its own', () => {
  /** root > placement s1_-2_n1 > asset:building_office_01 > glb-root (optionally marked) > [mesh] */
  function scene(opts: { marked: boolean; mesh: 'none' | 'material-less' }): THREE.Group {
    const root = new THREE.Group()
    const placement = new THREE.Group()
    placement.name = 's1_-2_n1'
    const slotNode = new THREE.Group()
    slotNode.name = `asset:${OFFICE}`
    const glbRoot = new THREE.Group()
    glbRoot.name = 'glb-root'
    if (opts.marked) glbRoot.userData[LANDMARK_GLB_ROOT_MARKER] = OFFICE
    if (opts.mesh === 'material-less') {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
      ;(mesh as unknown as { material: THREE.Material | null }).material = null
      glbRoot.add(mesh)
    }
    root.add(placement)
    placement.add(slotNode)
    slotNode.add(glbRoot)
    return root
  }
  const scan = (root: THREE.Object3D) =>
    collectVariantCacheUsage(root, { placementIds: new Set(['s1_-2_n1']), assetIds: new Set([OFFICE]), cachedUuids: new Set(['u-wall']) })

  it('a marked root with no mesh, or only a material-less mesh, is a MOUNTED model with no materials — and fails', () => {
    for (const mesh of ['none', 'material-less'] as const) {
      const records = scan(scene({ marked: true, mesh }))
      expect(records, mesh).toEqual([{ placementId: 's1_-2_n1', assetId: OFFICE, modelAssetIds: [OFFICE], materials: [] }])
      const p = checkVariantCacheOwnership(input({ usage: [...usage().slice(0, 3), records[0]] }))
      expect(p.map((x) => [x.code, x.placementId]), mesh).toEqual([['missing-material-usage', 's1_-2_n1']])
    }
  })

  it('the same empty slot WITHOUT a marker is a genuine fallback and passes', () => {
    const records = scan(scene({ marked: false, mesh: 'none' }))
    expect(records).toEqual([{ placementId: 's1_-2_n1', assetId: OFFICE, modelAssetIds: [], materials: [] }])
    expect(checkVariantCacheOwnership(input({ usage: [...usage().slice(0, 3), records[0]] }))).toEqual([])
  })
})

describe('issue #67 — warmed remount identity', () => {
  it('passes only when every key keeps its material identities and nothing appears', () => {
    expect(compareVariantCacheSnapshots(snapshot(), snapshot(), expectations())).toEqual([])
  })

  it('rejects the same key and name with a changed uuid', () => {
    expect(codes(compareVariantCacheSnapshots(snapshot(), snapshot([{ key: OFFICE_KEY, materials: [{ ...WALL, uuid: 'u-wall-rebuilt' }] }]), expectations()))).toEqual(['rebuilt-key'])
  })

  it('rejects an extra allocation inside a key', () => {
    expect(codes(compareVariantCacheSnapshots(snapshot(), snapshot([{ key: OFFICE_KEY, materials: [WALL, { ...WALL, uuid: 'u-wall-2' }] }]), expectations()))).toEqual(['rebuilt-key'])
  })

  it('rejects a key disappearing from the process-lifetime cache', () => {
    expect(codes(compareVariantCacheSnapshots(snapshot(), snapshot([]), expectations()))).toEqual(['removed-key'])
  })

  it('rejects any key appearing across a remount by default, even an expected one', () => {
    expect(codes(compareVariantCacheSnapshots(snapshot([]), snapshot(), expectations()))).toEqual(['added-key'])
    expect(compareVariantCacheSnapshots(snapshot([]), snapshot(), expectations(), { allowAddedExpectedKeys: true })).toEqual([])
  })

  it('always rejects an appearing key that no authored projection derives, and duplicate listings', () => {
    const after = snapshot([snapshot().entries[0], { key: 'building_office_01|wall:wall|wall=#00ff00', materials: [{ ...WALL, uuid: 'u-green' }] }])
    expect(codes(compareVariantCacheSnapshots(snapshot(), after, expectations(), { allowAddedExpectedKeys: true }))).toEqual(['unknown-added-key'])
    expect(codes(compareVariantCacheSnapshots(snapshot(), snapshot([snapshot().entries[0], snapshot().entries[0]]), expectations()))).toEqual(['duplicate-key'])
  })
})
