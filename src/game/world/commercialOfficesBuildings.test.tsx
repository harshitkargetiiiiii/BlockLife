import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { BuildingMesh, Buildings } from './Buildings'
import { BUILDINGS } from './cityLayout'
import { ASSET_MANIFEST_BY_ID } from '../assets/assetManifest'
import { resolveBuildingVisual } from './buildingProjection'
import { registry } from './runtimeRegistry'

/**
 * Issue #63 — the RENDER-TREE half of the two-offices contract (the byte/data half is
 * `assets/commercialOfficesContract.test.ts`). Unlike the house and shop bodies, the office row carries
 * two emissive window-overlay grids, so this also proves they ride the SAME +π/2 projection as the body.
 */

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

const ROW = 'building_office_01'
const OFFICES: Record<string, string> = { 's1_-1_n1': 'Main St Offices', 's1_-2_n1': 'North Exchange' }

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

/** Every mesh under `root` as geometry + parameters, transform RELATIVE to `root`, material type, colour, roughness. */
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

describe('issue #63 — the office body renders once, with its window grids on the same projection', () => {
  for (const [id, label] of Object.entries(OFFICES)) {
    it(`${id}: a loaded office body replaces the procedural box, and its two overlay grids yaw with it`, async () => {
      useGLTFMock.mockReturnValue({ scene: glbScene() })
      const renderer = await ReactThreeTestRenderer.create(<Buildings only={[id]} />)
      const group = placementObject(renderer, id)
      expect(countNamed(group, `asset:${ROW}`), `${id} asset slot`).toBe(1)
      const slot = group.getObjectByName(`asset:${ROW}`)!
      expect(countNamed(slot, 'glb-root'), `${id} GLB body`).toBe(1)
      expect(countMeshes(slot), `${id} exactly one visible body`).toBe(1)
      // Calibration on the primitive, facing on the nested projection group.
      const model = group.getObjectByName('glb-root')!
      const entry = ASSET_MANIFEST_BY_ID.get(ROW)!
      expect(model.scale.toArray(), `${id} calibration`).toEqual(entry.scale)
      expect(model.parent!.rotation.y, `${id} body yaw`).toBeCloseTo(Math.PI / 2, 9)
      expect(model.parent!.scale.toArray(), `${id} body projection undistorted`).toEqual([1, 1, 1])
      // The two existing grids render once, under a group carrying the SAME yaw and no scale/offset.
      const overlays = group.getObjectByName(`window-overlay:${ROW}`)
      expect(overlays, `${id} overlay group`).toBeTruthy()
      expect(countNamed(group, `window-overlay:${ROW}`), `${id} one overlay group`).toBe(1)
      const overlayParent = overlays!.parent!
      expect(overlayParent.rotation.y, `${id} overlay yaw matches the body`).toBeCloseTo(resolveBuildingVisual(BUILDINGS.find((b) => b.id === id)!)!.rotationY, 9)
      expect(overlayParent.scale.toArray(), `${id} overlay projection undistorted`).toEqual([1, 1, 1])
      expect(overlayParent.position.toArray(), `${id} overlay projection offset`).toEqual([0, 0, 0])
      expect(countNamed(overlays!, `overlay-facade:${ROW}:east`) + countNamed(overlays!, `overlay-facade:${ROW}:south`), `${id} both facades`).toBe(2)
      expect(renderer.scene.findAll((n) => n.props.name === `world-label:${label}`).length, `${id} sign`).toBe(1)
      await renderer.unmount()
    })

    it(`${id}: a failed office body renders the COMPLETE original procedural building, with its sign`, async () => {
      useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
      const renderer = await ReactThreeTestRenderer.create(<Buildings only={[id]} />)
      const slot = placementObject(renderer, id).getObjectByName(`asset:${ROW}`)!
      expect(countNamed(slot, 'glb-root'), `${id} no model`).toBe(0)
      expect(renderer.scene.findAll((n) => n.props.name === `world-label:${label}`).length, `${id} sign on the fallback`).toBe(1)
      const failed = meshSignatures(slot)
      await renderer.unmount()

      const index = BUILDINGS.findIndex((b) => b.id === id)
      const def = BUILDINGS[index]
      const direct = await ReactThreeTestRenderer.create(<group name="reference"><BuildingMesh def={def} index={index} /></group>)
      const reference = meshSignatures(direct.scene.findAll((n) => n.props.name === 'reference')[0].instance as THREE.Object3D)
      await direct.unmount()
      expect(failed, `${id} fallback subtree equals the direct procedural building`).toEqual(reference)
      const [w, h, d] = def.size
      const boxes = failed.filter((s) => s.geometry === 'BoxGeometry').map((s) => s.parameters)
      expect(boxes, `${id} body`).toContainEqual({ width: w, height: h, depth: d, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
      expect(boxes, `${id} roof slab`).toContainEqual({ width: w + 0.5, height: 0.45, depth: d + 0.5, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
      expect(boxes, `${id} door`).toContainEqual({ width: 1.4, height: 2.2, depth: 0.12, widthSegments: 1, heightSegments: 1, depthSegments: 1 })
    })
  }
})
