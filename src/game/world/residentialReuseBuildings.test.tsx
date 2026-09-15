import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { BuildingMesh, Buildings } from './Buildings'
import { BUILDINGS } from './cityLayout'
import { ASSET_MANIFEST_BY_ID } from '../assets/assetManifest'
import { resolveBuildingVisual } from './buildingProjection'
import { registry } from './runtimeRegistry'
import { resolveGlbUrl } from '../assets/modelRegistry'

/**
 * Issue #55 — the RENDER-TREE half of the residential reuse contract (the byte/data half is
 * `assets/residentialReuseContract.test.ts` and `assets/residentialNext15Contract.test.ts`). For each
 * of the twenty-three newly mapped lots (the first five on `arch_house_01`, fifteen 5 x 5 lots on
 * `arch_residential_house_01` or the compact `arch_house_01_compact` calibration, and three compiled
 * townhouse lots on the Wave 3 row-house row `building_townhomes_01`; pinned in
 * `assets/residentialTownhouseContract.test.ts`) — and, for issue #60, the two compiled Marts on the
 * Wave 3 shop row `building_shop_01` (pinned in `assets/commercialMartsContract.test.ts`):
 *
 *  - a loaded archetype renders exactly ONE body, with no procedural shell or overlay grid behind it;
 *  - a failed load renders the COMPLETE procedural building the lot had before;
 *  - an authored sign survives both branches;
 *  - the archetype calibration sits on the primitive and the door yaw on the nested projection group.
 */

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

/** Placement id -> the archetype it projects. */
const MAPPED: Record<string, string> = {
  building_house_r4: 'arch_house_01',
  building_house_w4: 'arch_house_01',
  building_house_w6: 'arch_house_01',
  building_house_s4: 'arch_house_01',
  building_house_s6: 'arch_house_01',
  building_house_r3: 'arch_residential_house_01',
  building_house_w1: 'arch_residential_house_01',
  building_house_w3: 'arch_residential_house_01',
  building_house_s1: 'arch_residential_house_01',
  building_house_s3: 'arch_residential_house_01',
  building_house_s5: 'arch_residential_house_01',
  building_house_s7: 'arch_residential_house_01',
  's2_-1_n1': 'arch_residential_house_01',
  's2_-1_n3': 'arch_residential_house_01',
  's2_-1_s2': 'arch_residential_house_01',
  building_house_r5: 'arch_house_01_compact',
  building_house_w5: 'arch_house_01_compact',
  's2_-1_n2': 'arch_house_01_compact',
  's2_-1_s1': 'arch_house_01_compact',
  's2_-1_s3': 'arch_house_01_compact',
  's1_-1_s2': 'building_townhomes_01',
  's1_-2_s2': 'building_townhomes_01',
  's2_-1_n4': 'building_townhomes_01',
  // Issue #60: Main St Mart and North Mart on the Wave 3 shop row (commercialMartsContract.test.ts).
  's1_-1_s1': 'building_shop_01',
  's1_-2_s1': 'building_shop_01',
}

function glbScene(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'glb-root'
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
  return root
}

function placementObject(renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>, id: string): THREE.Object3D {
  const node = renderer.scene.findAll((n) => n.props.name === id)[0]
  expect(node, `placement group ${id}`).toBeTruthy()
  return node.instance as THREE.Object3D
}

function countNamed(root: THREE.Object3D, name: string): number {
  let n = 0
  root.traverse((o) => { if (o.name === name) n++ })
  return n
}

function countMeshes(root: THREE.Object3D): number {
  let n = 0
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++ })
  return n
}

/**
 * Every mesh under `root` as geometry type + parameters, transform RELATIVE to `root`, material type,
 * colour and roughness — sorted, so two subtrees compare as equal only if they draw the same house.
 */
function meshSignatures(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const inverseRoot = root.matrixWorld.clone().invert()
  const round = (n: number) => Math.round(n * 1e6) / 1e6
  const out: { geometry: string; parameters: unknown; matrix: number[]; material: string; color: string | null; roughness: number | null }[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as THREE.MeshStandardMaterial
    out.push({
      geometry: mesh.geometry.type,
      parameters: (mesh.geometry as THREE.BufferGeometry & { parameters?: unknown }).parameters ?? null,
      matrix: inverseRoot.clone().multiply(mesh.matrixWorld).elements.map(round),
      material: material.type,
      color: material.color ? material.color.getHexString() : null,
      roughness: typeof material.roughness === 'number' ? round(material.roughness) : null,
    })
  })
  return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

beforeEach(() => {
  registry.glbAssetState.clear()
  useGLTFMock.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('issue #55 — one reused house body renders, never two', () => {
  for (const [id, assetId] of Object.entries(MAPPED)) {
    it(`${id}: a loaded ${assetId} replaces the procedural house — no duplicate shell`, async () => {
      useGLTFMock.mockReturnValue({ scene: glbScene() })
      const renderer = await ReactThreeTestRenderer.create(<Buildings only={[id]} />)
      const group = placementObject(renderer, id)
      expect(countNamed(group, `asset:${assetId}`), `${id} asset slot`).toBe(1)
      const slot = group.getObjectByName(`asset:${assetId}`)!
      expect(countNamed(slot, 'glb-root'), `${id} GLB body`).toBe(1)
      expect(countMeshes(slot), `${id} exactly one visible body`).toBe(1)
      expect(
        renderer.scene.findAll((n) => String(n.props.name ?? '').startsWith('window-overlay:')).length,
        `${id} overlay grids`,
      ).toBe(0)
      const label = BUILDINGS.find((b) => b.id === id)!.label
      if (label) expect(renderer.scene.findAll((n) => n.props.name === `world-label:${label}`).length, `${id} sign`).toBe(1)
      await renderer.unmount()
    })

    it(`${id}: a failed ${assetId} renders the COMPLETE original procedural house`, async () => {
      useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
      const renderer = await ReactThreeTestRenderer.create(<Buildings only={[id]} />)
      const slot = placementObject(renderer, id).getObjectByName(`asset:${assetId}`)!
      expect(countNamed(slot, 'glb-root'), `${id} no model`).toBe(0)
      const failedLabel = BUILDINGS.find((b) => b.id === id)!.label
      if (failedLabel) expect(renderer.scene.findAll((n) => n.props.name === `world-label:${failedLabel}`).length, `${id} sign on the fallback`).toBe(1)
      const failed = meshSignatures(slot)
      await renderer.unmount()

      // The reference: BuildingMesh rendered directly for the SAME def at its ORIGINAL BUILDINGS
      // index (the index seeds the rooftop unit and lit-window pattern). A mesh count alone would
      // pass with a wall, roof or door missing; the whole signature list may not differ at all.
      const index = BUILDINGS.findIndex((b) => b.id === id)
      const def = BUILDINGS[index]
      const direct = await ReactThreeTestRenderer.create(<group name="reference"><BuildingMesh def={def} index={index} /></group>)
      const reference = meshSignatures(direct.scene.findAll((n) => n.props.name === 'reference')[0].instance as THREE.Object3D)
      await direct.unmount()
      expect(failed, `${id} fallback subtree equals the direct procedural house`).toEqual(reference)

      // ...and the structural parts are pinned explicitly, so an equal-but-broken reference cannot hide one.
      const [w, h, d] = def.size
      const boxes = failed.filter((s) => s.geometry === 'BoxGeometry').map((s) => s.parameters)
      expect(boxes, `${id} body`).toContainEqual({ width: w, height: h, depth: d, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
      expect(boxes, `${id} plinth`).toContainEqual({ width: w + 0.24, height: 0.6, depth: d + 0.24, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
      expect(boxes, `${id} roof slab`).toContainEqual({ width: w + 0.5, height: 0.45, depth: d + 0.5, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
      expect(boxes, `${id} door`).toContainEqual({ width: 1.4, height: 2.2, depth: 0.12, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
      expect(boxes, `${id} awning`).toContainEqual({ width: 2.4, height: 0.1, depth: 1.2, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
    })
  }

  it('each lot yaws its archetype onto its own door, undistorted', async () => {
    useGLTFMock.mockReturnValue({ scene: glbScene() })
    for (const [id, assetId] of Object.entries(MAPPED)) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      const visual = resolveBuildingVisual(BUILDINGS.find((b) => b.id === id)!)!
      expect(visual.assetId, `${id} archetype`).toBe(assetId)
      const renderer = await ReactThreeTestRenderer.create(<Buildings only={[id]} />)
      const model = placementObject(renderer, id).getObjectByName('glb-root')!
      expect(model.scale.toArray(), `${id} archetype scale`).toEqual(entry.scale)
      expect(model.position.toArray(), `${id} archetype base offset`).toEqual(entry.positionOffset)
      const projection = model.parent!
      expect(projection.rotation.y, `${id} projected yaw`).toBeCloseTo(visual.rotationY, 9)
      expect(projection.scale.toArray(), `${id} projection must not distort the body`).toEqual([1, 1, 1])
      expect(projection.position.toArray(), `${id} projection offset`).toEqual([0, 0, 0])
      await renderer.unmount()
    }
  })

  it('the compact row shares the red-house FILE but owns its own load branch', async () => {
    // Resource accounting for the calibrated alias: both rows resolve to ONE url (one cached parse,
    // no copied mesh or texture), each instance clones its own scene, and the per-asset branch
    // reference counts stay separate, so one row failing never reports the other as failed.
    useGLTFMock.mockReturnValue({ scene: glbScene() })
    const original = ASSET_MANIFEST_BY_ID.get('arch_house_01')!
    const compact = ASSET_MANIFEST_BY_ID.get('arch_house_01_compact')!
    expect(resolveGlbUrl(compact), 'one url for both rows').toBe(resolveGlbUrl(original))
    const renderer = await ReactThreeTestRenderer.create(<Buildings only={['building_house_w4', 'building_house_w5']} />)
    const urls = new Set(useGLTFMock.mock.calls.map((call) => call[0]))
    expect([...urls], 'every load asks for the same file').toEqual([resolveGlbUrl(original)])
    const w4 = placementObject(renderer, 'building_house_w4').getObjectByName('glb-root')!
    const w5 = placementObject(renderer, 'building_house_w5').getObjectByName('glb-root')!
    expect(w4, 'each placement owns its own cloned scene').not.toBe(w5)
    expect(registry.glbAssetState.get('arch_house_01')?.active, 'arch_house_01 branch').toBe(1)
    expect(registry.glbAssetState.get('arch_house_01_compact')?.active, 'compact branch').toBe(1)
    await renderer.unmount()
    expect(registry.glbAssetState.get('arch_house_01_compact')?.active ?? 0, 'released on unmount').toBe(0)
  })
})
