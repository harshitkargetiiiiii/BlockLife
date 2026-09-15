import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { BuildingMesh, Buildings } from './Buildings'
import { BUILDINGS } from './cityLayout'
import { ASSET_MANIFEST_BY_ID } from '../assets/assetManifest'
import { resolveBuildingVisual } from './buildingProjection'
import { registry } from './runtimeRegistry'
import { BuildingWindowOverlays } from './WindowOverlays'
import { WINDOW_OVERLAYS } from './windowOverlayData'

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

describe('issue #64 — the measured office pane grids light a stable, distinct subset at every placement', () => {
  /** Exact lit cells: Nook Offices keeps the authored seeds; each projected office renders with its overlaySeed. */
  const LIT: Record<string, { seed: number | undefined; east: string[]; south: string[] }> = {
    [ROW]: { seed: undefined, east: ['r0c0', 'r0c1', 'r0c2', 'r1c2'], south: ['r0c0', 'r0c1', 'r1c0', 'r1c1'] },
    's1_-1_n1': { seed: resolveBuildingVisual(BUILDINGS.find((b) => b.id === 's1_-1_n1')!)!.overlaySeed, east: ['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c2'], south: ['r0c0', 'r1c0'] },
    's1_-2_n1': { seed: resolveBuildingVisual(BUILDINGS.find((b) => b.id === 's1_-2_n1')!)!.overlaySeed, east: ['r0c1', 'r1c0', 'r1c2'], south: ['r0c0', 'r1c0', 'r1c1'] },
  }

  /** Every instanced glow mesh the overlay renders: facade, lit cells recovered from the ACTUAL instance matrices, and the matrices. */
  async function renderedGlow(seed: number | undefined) {
    const renderer = await ReactThreeTestRenderer.create(<BuildingWindowOverlays assetId={ROW} seed={seed} />)
    const meshes: { facade: string; cells: string[]; matrices: number[][] }[] = []
    ;(renderer.scene.instance as THREE.Object3D).traverse((o) => {
      const mesh = o as THREE.InstancedMesh
      if (!mesh.isInstancedMesh) return
      const facade = mesh.name.split(':').pop()!
      const def = WINDOW_OVERLAYS.find((d) => d.buildingAssetId === ROW && d.facade === facade)!
      const [matrix, position, rotation, scale] = [new THREE.Matrix4(), new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()]
      const cells: string[] = []
      const matrices: number[][] = []
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix)
        matrix.decompose(position, rotation, scale)
        // InstancedMesh stores matrices as Float32, so positions read back to ~5e-8 m, not 1e-9.
        const [lateral, normal] = facade === 'east' ? [position.z, position.x] : [position.x, position.z]
        const col = Math.round((lateral - def.start[0]) / def.spacing[0])
        const row = Math.round((position.y - def.start[1]) / def.spacing[1])
        expect([row >= 0 && row < def.rows, col >= 0 && col < def.columns], `${facade} instance ${i} is a grid cell`).toEqual([true, true])
        expect(lateral, `${facade} r${row}c${col} lateral`).toBeCloseTo(def.start[0] + col * def.spacing[0], 6)
        expect(position.y, `${facade} r${row}c${col} height`).toBeCloseTo(def.start[1] + row * def.spacing[1], 6)
        expect(normal, `${facade} r${row}c${col} plane`).toBeCloseTo(def.facadeDistance, 6)
        expect([scale.x, scale.y], `${facade} r${row}c${col} size`).toEqual(def.windowSize.map((v) => expect.closeTo(v, 6)))
        cells.push(`r${row}c${col}`)
        matrices.push(matrix.toArray())
      }
      meshes.push({ facade, cells, matrices })
    })
    await renderer.unmount()
    return meshes
  }

  it('renders exactly the pinned lit cells, identically on a second mount, with two glow meshes per placement', async () => {
    let instances = 0
    let draws = 0
    for (const [id, want] of Object.entries(LIT)) {
      const first = await renderedGlow(want.seed)
      expect(first.map((m) => m.facade).sort(), `${id} glow meshes`).toEqual(['east', 'south'])
      expect(first.find((m) => m.facade === 'east')!.cells, `${id} east lit cells`).toEqual(want.east)
      expect(first.find((m) => m.facade === 'south')!.cells, `${id} south lit cells`).toEqual(want.south)
      expect(await renderedGlow(want.seed), `${id} stable across mounts`).toEqual(first)
      instances += first.reduce((n, m) => n + m.cells.length, 0)
      draws += first.length
    }
    expect([instances, draws], 'lit instances / glow draws across Nook Offices and the two offices').toEqual([21, 6])
  })

  it('no two placements light the same cells on either facade', () => {
    for (const facade of ['east', 'south'] as const) {
      const patterns = Object.values(LIT).map((l) => l[facade].join(','))
      expect(new Set(patterns).size, `${facade} patterns distinct`).toBe(3)
      for (const p of patterns) expect(p.length, `${facade} pattern nonempty`).toBeGreaterThan(0)
    }
  })
})
