import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { Buildings } from './Buildings'
import { Districts } from './Districts'
import { BUILDINGS } from './cityLayout'
import { ASSET_MANIFEST_BY_ID } from '../assets/assetManifest'
import { resolveBuildingVisual } from './buildingProjection'
import { visibilityRuntime } from '../visibility/visibilityRuntime'

/**
 * Issue #44 Wave 3 — the RENDER-TREE half of the building contract, which the byte-level
 * `wave3Contract.test.ts` cannot see:
 *
 *  - a successful GLB load renders exactly ONE visible body (the model), never the model plus
 *    the procedural building it replaced, and never a second GLB behind it;
 *  - a missing/corrupt GLB renders the COMPLETE original procedural building;
 *  - the label survives both branches and hangs at the projected height;
 *  - the reusable house archetype is one shared file mounted at four authored placements,
 *    each yawed onto its own door;
 *  - the garage's painted rolling-door decal is suppressed exactly while the approved body —
 *    which carries its own roller shutters — is the thing rendering.
 */

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

/** A stand-in for a loaded model: one named group holding one mesh, like every Wave 3 GLB. */
function glbScene(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'glb-root'
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
  return root
}

/** The nine pinned placements, and the manifest id each one actually renders. */
const CASES = [
  { placement: 'building_apartment_01', assetId: 'building_apartment_01', label: 'Sunrise Apartments' },
  { placement: 'building_shop_01', assetId: 'building_shop_01', label: 'Mini Mart' },
  { placement: 'building_house_01', assetId: 'arch_house_01', label: undefined },
  { placement: 'building_house_r2', assetId: 'arch_house_01', label: undefined },
  { placement: 'building_house_w2', assetId: 'arch_house_01', label: undefined },
  { placement: 'building_house_s2', assetId: 'arch_house_01', label: undefined },
  { placement: 'building_townhomes_01', assetId: 'building_townhomes_01', label: 'Townhomes — coming soon' },
  { placement: 'building_garage_01', assetId: 'building_garage_01', label: 'Garage — coming soon' },
  { placement: 'building_gate_hotel_01', assetId: 'building_gate_hotel_01', label: 'Hotel — coming soon' },
] as const

async function renderBuilding(placementId: string) {
  return ReactThreeTestRenderer.create(<Buildings only={[placementId]} />)
}

function placementObject(
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
  placementId: string,
): THREE.Object3D {
  const node = renderer.scene.findAll((n) => n.props.name === placementId)[0]
  expect(node, `placement group ${placementId}`).toBeTruthy()
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

beforeEach(() => {
  useGLTFMock.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('issue #44 Wave 3 — one building body renders, never two', () => {
  for (const { placement, assetId, label } of CASES) {
    it(`${placement}: a loaded GLB replaces the procedural body — no duplicate shell`, async () => {
      useGLTFMock.mockReturnValue({ scene: glbScene() })
      const renderer = await renderBuilding(placement)
      const group = placementObject(renderer, placement)

      // The placement group still exists under its AUTHORED id, and the body slot is inside it.
      expect(countNamed(group, `asset:${assetId}`), `${placement} asset slot`).toBe(1)
      const slot = group.getObjectByName(`asset:${assetId}`)!
      // Exactly one model mounted...
      expect(countNamed(slot, 'glb-root'), `${placement} GLB body`).toBe(1)
      // ...and NOTHING else renders inside the slot. The procedural BuildingMesh alone is a
      // dozen-plus meshes (box, plinth, roof, facade accents, windows, door, awning), so a
      // mesh count of exactly one is proof that no procedural shell survives behind the model
      // and that no second GLB was mounted alongside it.
      expect(countMeshes(slot), `${placement} exactly one visible body`).toBe(1)
      // No window-overlay grid rides along on a baked-atlas facade.
      expect(
        renderer.scene.findAll((n) => String(n.props.name ?? '').startsWith('window-overlay:')).length,
        `${placement} overlay grids`,
      ).toBe(0)
      // The sign is UI, not part of the asset — it survives the swap.
      if (label) {
        expect(
          renderer.scene.findAll((n) => n.props.name === `world-label:${label}`).length,
          `${placement} label`,
        ).toBe(1)
      }
      await renderer.unmount()
    })

    it(`${placement}: a failed GLB renders the COMPLETE original procedural building`, async () => {
      useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
      const renderer = await renderBuilding(placement)
      const group = placementObject(renderer, placement)
      const slot = group.getObjectByName(`asset:${assetId}`)!
      expect(countNamed(slot, 'glb-root'), `${placement} no model`).toBe(0)
      // The full procedural building comes back — body, plinth, roof and its detail meshes.
      expect(countMeshes(slot), `${placement} procedural fallback`).toBeGreaterThan(3)
      if (label) {
        expect(
          renderer.scene.findAll((n) => n.props.name === `world-label:${label}`).length,
          `${placement} label on the fallback branch`,
        ).toBe(1)
      }
      await renderer.unmount()
    })
  }
})

describe('issue #44 Wave 3 — the projected transform is what actually renders', () => {
  it('an id-keyed placement applies the manifest scale + yaw to the model only', async () => {
    useGLTFMock.mockReturnValue({ scene: glbScene() })
    for (const id of ['building_apartment_01', 'building_garage_01', 'building_gate_hotel_01']) {
      const entry = ASSET_MANIFEST_BY_ID.get(id)!
      const renderer = await renderBuilding(id)
      const model = placementObject(renderer, id).getObjectByName('glb-root')!
      // `useGLTF` is mocked, so the primitive IS the mocked scene: its own TRS is the
      // manifest's, applied directly with no intermediate projection group.
      expect(model.scale.toArray(), `${id} scale`).toEqual(entry.scale)
      expect(model.position.toArray(), `${id} offset`).toEqual(entry.positionOffset)
      expect(model.rotation.y, `${id} yaw`).toBeCloseTo(entry.rotation[1], 9)
      await renderer.unmount()
    }
  })

  it('the four house placements share ONE archetype file, each yawed onto its own door', async () => {
    const scene = glbScene()
    useGLTFMock.mockReturnValue({ scene })
    const entry = ASSET_MANIFEST_BY_ID.get('arch_house_01')!
    for (const id of ['building_house_01', 'building_house_r2', 'building_house_w2', 'building_house_s2']) {
      const def = BUILDINGS.find((b) => b.id === id)!
      const visual = resolveBuildingVisual(def)!
      const renderer = await renderBuilding(id)
      const group = placementObject(renderer, id)
      const model = group.getObjectByName('glb-root')!
      // The archetype's own uniform calibration lives on the primitive...
      expect(model.scale.toArray(), `${id} archetype scale`).toEqual(entry.scale)
      // ...and the per-placement facing lives on the NESTED projection group above it, so the
      // two compose by matrix rather than by adding Euler components.
      const projection = model.parent!
      expect(projection.rotation.y, `${id} projected yaw`).toBeCloseTo(visual.rotationY, 9)
      expect(projection.scale.toArray(), `${id} projection must not distort the body`).toEqual([1, 1, 1])
      expect(projection.position.toArray(), `${id} projection offset`).toEqual([0, 0, 0])
      await renderer.unmount()
    }
  })
})

describe('issue #44 Wave 3 — the garage keeps exactly one door representation', () => {
  it('the painted rolling-door decal is suppressed while the approved body renders', async () => {
    useGLTFMock.mockReturnValue({ scene: glbScene() })
    const renderer = await ReactThreeTestRenderer.create(<Districts />)
    // The approved repair-garage body carries its own pair of roller shutters, yawed onto the
    // authored west door, so the painted stand-in on the blank south wall must be gone...
    expect(visibilityRuntime.occluders.has('decals_garage_01'), 'garage door decal').toBe(false)
    // ...while the warehouse shutter and the gym poster — neither of which this wave touches —
    // are still registered and still fade with their buildings.
    expect(visibilityRuntime.occluders.has('decals_warehouse_01'), 'warehouse decal').toBe(true)
    expect(visibilityRuntime.occluders.has('decals_gym_01'), 'gym poster').toBe(true)
    await renderer.unmount()
  })
})
