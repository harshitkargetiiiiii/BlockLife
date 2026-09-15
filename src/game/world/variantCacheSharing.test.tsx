import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { Buildings } from './Buildings'
import { BUILDINGS, JOB_KIOSK } from './cityLayout'
import { Props } from './Props'
import { registry } from './runtimeRegistry'
import { acquireTintedMaterials, variantCacheKey, variantCacheSnapshot, variantCacheStats } from '../assets/variantMaterialCache'
import {
  LANDMARK_GLB_ROOT_MARKER,
  UNPLACED,
  checkVariantCacheOwnership,
  collectVariantCacheUsage,
  compareVariantCacheSnapshots,
  consumersOfVariantCacheKey,
} from '../assets/variantCacheOwnership'
import { VARIANT_CACHE_NO_CACHE_ASSET_IDS, deriveVariantCacheExpectations, variantCacheAuthoredPlacementIds, variantCacheScannedAssetIds } from '../assets/variantCacheExpectations'

/**
 * Issue #67 — the positive half of the variant-cache contract, through the REAL render path (`Buildings` →
 * `LandmarkAsset` → the shared cache): two projected offices share ONE cached material object inside their MARKED model
 * roots, a direct row keeps its isolated slot, the Stage A house and a red house (an asset declaring no slots) create no
 * entry, and a genuine React unmount/remount keeps the cached identity. Then the same gate is shown failing on real
 * scene mutations, including a loaded office whose private clone is renamed "".
 *
 * No occlusion system runs here, so every consumer shows its unfaded material. The cache is never cleared: the first
 * assertion documents the cold state, and everything after it runs on the warmed process cache.
 */

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

const OFFICE_KEY = 'building_office_01|wall:wall|∅'
const OFFICES = ['s1_-1_n1', 's1_-2_n1']
const NOOK = 'building_office_01'
const HOUSE = 'building_house_r1'
const RED = BUILDINGS.find((b) => b.visual?.assetId === 'arch_house_01')!.id
const PLACEMENTS = [...OFFICES, NOOK, HOUSE, RED]

/** ONE source per file, as useGLTF's cache returns: the office mirrors its shipped GLB (one primitive, sole material "wall"). */
function source(materialName: string): { scene: THREE.Group; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' })
  material.name = materialName
  const scene = new THREE.Group()
  scene.name = 'glb-root'
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material))
  return { scene, material }
}
const OFFICE_SOURCE = source('wall')
// One unnamed-material house mock for both houses. It matches the Stage A house's shipped (unnamed) material; the red
// house's real material is `baked_atlas`, which the cached-material misuse mutation below does not depend on.
const HOUSE_SOURCE = source('')
const BENCH_SOURCE = source('bench') // mirrors the shipped bench GLB: its sole material is named bench, its declared slot

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

function slot(renderer: Renderer, placementId: string, assetId: string): THREE.Object3D {
  const group = renderer.scene.findAll((n) => n.props.name === placementId)[0]?.instance as THREE.Object3D
  expect(group, `placement ${placementId}`).toBeTruthy()
  const s = group.getObjectByName(`asset:${assetId}`)
  expect(s, `${placementId} slot`).toBeTruthy()
  return s!
}

function modelMeshes(renderer: Renderer, placementId: string, assetId: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  slot(renderer, placementId, assetId).traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).parent?.name === 'glb-root') out.push(o as THREE.Mesh) })
  return out
}

function gate(renderer: Renderer | null, placementIds: ReadonlySet<string> = variantCacheAuthoredPlacementIds()) {
  const snapshot = variantCacheSnapshot()
  const usage = collectVariantCacheUsage(renderer ? (renderer.scene.instance as THREE.Object3D) : null, {
    placementIds,
    assetIds: variantCacheScannedAssetIds(),
    cachedUuids: new Set(snapshot.entries.flatMap((e) => e.materials.map((m) => m.uuid))),
  })
  const expectations = deriveVariantCacheExpectations()
  const problems = checkVariantCacheOwnership({ stats: variantCacheStats(), snapshot, usage, expectations, noCacheAssetIds: VARIANT_CACHE_NO_CACHE_ASSET_IDS })
  return { snapshot, usage, expectations, problems, consumers: consumersOfVariantCacheKey(snapshot, usage, OFFICE_KEY) }
}
const pairs = (problems: { code: string; placementId?: string }[]) => problems.map((p) => [p.code, p.placementId ?? null])

beforeEach(() => {
  registry.glbAssetState.clear()
  useGLTFMock.mockReset()
  useGLTFMock.mockImplementation((url: string) => ({ scene: String(url).includes('arch_office_01') ? OFFICE_SOURCE.scene : String(url).includes('prop_park_bench_01') ? BENCH_SOURCE.scene : HOUSE_SOURCE.scene }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('issue #67 — the shared office material through the real render path', () => {
  it('two projected offices share ONE cached material, and a real unmount/remount keeps its identity', async () => {
    expect(variantCacheSnapshot().entries, 'cold cache: empty, which proves nothing yet').toEqual([])
    const officeSourceDispose = vi.spyOn(OFFICE_SOURCE.material, 'dispose')
    const houseSourceDispose = vi.spyOn(HOUSE_SOURCE.material, 'dispose')

    // ---- Warm: mount two eligible consumers plus a direct row and two houses.
    const first = await ReactThreeTestRenderer.create(<Buildings only={PLACEMENTS} />)
    const warmed = gate(first)
    expect(warmed.problems, 'warmed gate').toEqual([])
    expect(warmed.snapshot.entries.map((e) => [e.key, e.materials.map((m) => m.name)])).toEqual([[OFFICE_KEY, ['wall']]])
    expect(warmed.consumers, 'both projected offices render the cached material inside their models').toEqual(OFFICES)
    const cachedUuid = warmed.snapshot.entries[0].materials[0].uuid

    // Branch evidence: each mounted instance's own cloned root carries the DEV marker; the shared source never does.
    for (const [id, assetId] of [[OFFICES[0], NOOK], [OFFICES[1], NOOK], [NOOK, NOOK], [HOUSE, 'arch_residential_house_01'], [RED, 'arch_house_01']]) {
      const roots: THREE.Object3D[] = []
      slot(first, id, assetId).traverse((o) => { if (o.userData?.[LANDMARK_GLB_ROOT_MARKER] !== undefined) roots.push(o) })
      expect(roots.map((r) => [r.name, r.userData[LANDMARK_GLB_ROOT_MARKER]]), `${id} marked model root`).toEqual([['glb-root', assetId]])
      expect(roots[0], `${id} marker is on the instance clone`).not.toBe(assetId === NOOK ? OFFICE_SOURCE.scene : HOUSE_SOURCE.scene)
    }
    expect(OFFICE_SOURCE.scene.userData, 'shared office source unmarked').not.toHaveProperty(LANDMARK_GLB_ROOT_MARKER)
    expect(HOUSE_SOURCE.scene.userData, 'shared house source unmarked').not.toHaveProperty(LANDMARK_GLB_ROOT_MARKER)
    expect(warmed.usage.filter((u) => OFFICES.includes(u.placementId)).map((u) => [u.placementId, u.modelAssetIds, u.materials])).toEqual(
      OFFICES.map((id) => [id, [NOOK], [{ name: 'wall', uuid: cachedUuid, inModel: true }]]),
    )

    const [a, b, nook, house] = [modelMeshes(first, OFFICES[0], NOOK), modelMeshes(first, OFFICES[1], NOOK), modelMeshes(first, NOOK, NOOK), modelMeshes(first, HOUSE, 'arch_residential_house_01')]
    expect([a.length, b.length, nook.length, house.length], 'one model mesh per mounted placement').toEqual([1, 1, 1, 1])
    expect(a[0], 'each office renders its own scene clone').not.toBe(b[0])
    expect(a[0].material, 'both clones hold the SAME material object').toBe(b[0].material)
    const cached = a[0].material as THREE.MeshStandardMaterial
    expect(cached.uuid).toBe(cachedUuid)
    expect(cached, 'the shared material is not the immutable source').not.toBe(OFFICE_SOURCE.material)
    expect(nook[0].material, 'the direct Nook row keeps an isolated slot').not.toBe(cached)
    expect(nook[0].material).not.toBe(OFFICE_SOURCE.material)
    expect(house[0].material, 'the Stage A house renders its own material, no cache involvement').toBe(HOUSE_SOURCE.material)
    expect((OFFICE_SOURCE.scene.children[0] as THREE.Mesh).material, 'source mesh untouched').toBe(OFFICE_SOURCE.material)
    expect(OFFICE_SOURCE.material.color.getHexString(), 'source colour untouched').toBe('ffffff')
    const cachedDispose = vi.spyOn(cached, 'dispose')
    const nookDispose = vi.spyOn(nook[0].material as THREE.Material, 'dispose')

    // ---- Genuine React unmount.
    await first.unmount()
    expect(cachedDispose, 'the process-lifetime shared material is never disposed').not.toHaveBeenCalled()
    expect(nookDispose, 'the isolated direct-row clone is released by its own instance').toHaveBeenCalled()
    const retained = gate(null)
    expect(retained.snapshot, 'membership is retained after the last consumer unmounts').toEqual(warmed.snapshot)
    expect(retained.problems, 'retained membership without a consumer is valid').toEqual([])
    expect(retained.consumers).toEqual([])

    // ---- Genuine React remount of the same content.
    const second = await ReactThreeTestRenderer.create(<Buildings only={PLACEMENTS} />)
    const remounted = gate(second)
    expect(remounted.problems, 'remounted gate').toEqual([])
    expect(compareVariantCacheSnapshots(warmed.snapshot, remounted.snapshot, remounted.expectations), 'no rebuild, no growth').toEqual([])
    expect(remounted.consumers).toEqual(OFFICES)
    const [a2, b2, nook2] = [modelMeshes(second, OFFICES[0], NOOK)[0], modelMeshes(second, OFFICES[1], NOOK)[0], modelMeshes(second, NOOK, NOOK)[0]]
    expect([a2 === a[0], b2 === b[0]], 'the remount built new scene clones').toEqual([false, false])
    expect(a2.material, 'which reuse the SAME cached material object').toBe(cached)
    expect(b2.material).toBe(cached)
    expect(nook2.material, 'the direct row allocated a fresh isolated clone').not.toBe(nook[0].material)
    expect(nook2.material).not.toBe(cached)
    const walls = new Set<string>()
    ;(second.scene.instance as THREE.Object3D).traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if ((o as THREE.Mesh).isMesh && m?.name === 'wall') walls.add(m.uuid)
    })
    expect(walls.size, 'live "wall" materials: the one shared set + the one isolated Nook clone').toBe(2)
    expect(OFFICE_SOURCE.material.color.getHexString()).toBe('ffffff')

    await second.unmount()
    expect(cachedDispose).not.toHaveBeenCalled()
    expect(officeSourceDispose, 'the shared office source material is never disposed across mount/unmount/remount').not.toHaveBeenCalled()
    expect(houseSourceDispose, 'the shared house source material is never disposed across mount/unmount/remount').not.toHaveBeenCalled()
  })

  it('street props and the kiosk attribute to their OWN authored ids: repeated benches pass, a duplicated slot and cached misuse still fail', async () => {
    const BENCHES = ['prop_bench_01', 'prop_bench_02']
    const authored = variantCacheAuthoredPlacementIds()
    expect([...BENCHES, JOB_KIOSK.id].map((id) => authored.has(id))).toEqual([true, true, true])
    const renderer = await ReactThreeTestRenderer.create(
      <group>
        <Buildings only={PLACEMENTS} />
        <Props only={BENCHES} kiosk />
      </group>,
    )
    const healthy = gate(renderer)
    expect(healthy.problems, 'repeated bench slots of one asset are distinct authored placements').toEqual([])
    const benchRecords = healthy.usage.filter((u) => u.assetId === 'prop_park_bench_01')
    expect(benchRecords.map((u) => [u.placementId, u.modelAssetIds, u.materials.map((m) => m.name)]), 'one marked bench model per authored bench').toEqual(
      BENCHES.map((id) => [id, ['prop_park_bench_01'], ['bench']]),
    )
    expect(new Set(benchRecords.flatMap((u) => u.materials.map((m) => m.uuid))).size, 'the direct slot path isolates each bench material').toBe(2)
    expect(healthy.usage.filter((u) => u.assetId === JOB_KIOSK.id).map((u) => u.placementId), 'the kiosk under its own id').toEqual([JOB_KIOSK.id])
    expect(healthy.usage.some((u) => u.placementId === UNPLACED), 'nothing left unplaced').toBe(false)

    // Root cause of native-v1 (exit 4): attributing with building ids only collapses both benches into (unplaced).
    expect(pairs(gate(renderer, new Set(BUILDINGS.map((b) => b.id))).problems), 'the v3 building-only id set reproduces the native failure').toEqual([['duplicate-usage', UNPLACED]])

    // A genuinely duplicated slot under ONE authored bench still fails.
    const bench = slot(renderer, BENCHES[0], 'prop_park_bench_01')
    const duplicate = bench.clone(true)
    bench.parent!.add(duplicate)
    expect(pairs(gate(renderer).problems)).toEqual([['duplicate-usage', BENCHES[0]]])
    bench.parent!.remove(duplicate)
    expect(gate(renderer).problems).toEqual([])

    // Unrelated cached-material misuse on a bench still fails, attributed to that bench.
    const [benchMesh] = modelMeshes(renderer, BENCHES[1], 'prop_park_bench_01')
    const own = benchMesh.material
    benchMesh.material = modelMeshes(renderer, OFFICES[0], NOOK)[0].material
    expect(pairs(gate(renderer).problems)).toEqual([['unknown-owner', BENCHES[1]]])
    benchMesh.material = own
    expect(gate(renderer).problems).toEqual([])
    await renderer.unmount()
  })

  it('the same gate fails on real scene mutations, and passes again once each is undone', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Buildings only={PLACEMENTS} />)
    expect(gate(renderer).problems).toEqual([])
    const [b] = modelMeshes(renderer, OFFICES[1], NOOK)
    const shared = b.material as THREE.Material

    // A private copy on a loaded office, same name.
    const privateCopy = shared.clone()
    b.material = privateCopy
    expect(pairs(gate(renderer).problems)).toEqual([['uncached-projected-material', OFFICES[1]]])

    // The reviewer's false pass: a loaded office whose private clone is renamed "". The marker says the model is mounted.
    privateCopy.name = ''
    expect(pairs(gate(renderer).problems)).toEqual([['missing-material-usage', OFFICES[1]]])
    b.material = shared
    privateCopy.dispose()
    expect(gate(renderer).problems).toEqual([])

    // A still-marked model root whose last mesh was removed: the marker says loaded, the material is gone — must fail.
    const glbRoot = b.parent!
    expect(glbRoot.userData[LANDMARK_GLB_ROOT_MARKER], 'the root keeps its marker').toBe(NOOK)
    glbRoot.remove(b)
    expect(pairs(gate(renderer).problems)).toEqual([['missing-material-usage', OFFICES[1]]])
    glbRoot.add(b)
    expect(gate(renderer).problems).toEqual([])

    // The cached material on the Stage A house, and on a red house whose asset declares no slots (never scanned in full).
    const [house] = modelMeshes(renderer, HOUSE, 'arch_residential_house_01')
    house.material = shared
    expect(pairs(gate(renderer).problems)).toEqual([['forbidden-owner', HOUSE]])
    house.material = HOUSE_SOURCE.material
    const [red] = modelMeshes(renderer, RED, 'arch_house_01')
    red.material = shared
    expect(pairs(gate(renderer).problems)).toEqual([['unknown-owner', RED]])
    red.material = HOUSE_SOURCE.material

    // The cached material on a stray mesh under no asset slot and no placement.
    const stray = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared)
    ;(renderer.scene.instance as THREE.Object3D).add(stray)
    expect(pairs(gate(renderer).problems)).toEqual([['unknown-owner', UNPLACED]])
    ;(renderer.scene.instance as THREE.Object3D).remove(stray)
    stray.geometry.dispose()
    expect(gate(renderer).problems).toEqual([])

    // An unapproved palette key for the same office.
    const before = variantCacheSnapshot()
    const red2 = { wall: { color: '#ff0000' } }
    acquireTintedMaterials(variantCacheKey('building_office_01', { wall: ['wall'] }, red2), OFFICE_SOURCE.scene, { wall: ['wall'] }, red2)
    const after = gate(renderer)
    expect([...new Set(after.problems.map((p) => p.code))]).toEqual(['unknown-key'])
    expect(compareVariantCacheSnapshots(before, after.snapshot, after.expectations, { allowAddedExpectedKeys: true }).map((p) => p.code)).toEqual(['unknown-added-key'])
    await renderer.unmount()
  })
})
