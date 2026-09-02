import { afterEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { VehicleAsset } from './VehicleAsset'
import { ASSET_MANIFEST_BY_ID, type AssetManifestEntry } from './assetManifest'
import { VEHICLE_DEFS } from '../vehicles/vehicleRegistry'
import { VehicleVisual } from '../vehicles/VehicleVisual'
import { registry } from '../world/runtimeRegistry'

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

function vehicleEntry(overrides: Partial<AssetManifestEntry>): AssetManifestEntry {
  return {
    id: 'vehicle_compact_car_01',
    label: 'Test car',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/compact_sedan_01.glb',
    fallbackKey: 'CarMesh',
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    positionOffset: [0, 0, 0],
    attribution: null,
    license: null,
    enabled: true,
    materialSlots: { paint: ['body'], wheel: ['tire'] },
    ...overrides,
  }
}

function Fallback() {
  return <mesh name="carmesh-fallback" />
}

afterEach(() => {
  useGLTFMock.mockReset()
  vi.restoreAllMocks()
})

describe('VehicleAsset (R3F, §5 one-shell GLB adapter)', () => {
  it('renders the CarMesh fallback when the class has no asset id', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={null} paint="#3aa6a0">
        <Fallback />
      </VehicleAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
    expect(useGLTFMock).not.toHaveBeenCalled()
    await renderer.unmount()
  })

  it('renders the fallback when the entry is disabled', async () => {
    // A class whose manifest entry is disabled keeps the CarMesh (injected here so
    // the test is independent of whether the real compact ships a GLB yet).
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#3aa6a0" entry={vehicleEntry({ enabled: false })}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
    expect(useGLTFMock).not.toHaveBeenCalled()
    await renderer.unmount()
  })

  it('projects the GLB and paints the body slot when enabled', async () => {
    const glbScene = new THREE.Group()
    glbScene.name = 'car-root'
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ name: 'body', color: '#ffffff' }),
    )
    glbScene.add(body)
    useGLTFMock.mockReturnValue({ scene: glbScene })

    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#ff0000" entry={vehicleEntry({})}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(useGLTFMock).toHaveBeenCalledWith(expect.stringContaining('compact_sedan_01.glb'))
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(0)
    // The cloned body material carries the requested paint (isolated, not the source).
    const root = renderer.scene
      .findAll((n) => (n.instance as THREE.Object3D)?.name === 'car-root')[0]
      .instance as THREE.Group
    let painted = ''
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m?.name === 'body') painted = m.color.getHexString()
    })
    expect(painted).toBe('ff0000')
    await renderer.unmount()
  })

  it('falls back to CarMesh (and warns dev-only) when the GLB fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useGLTFMock.mockImplementation(() => {
      throw new Error('404 model not found')
    })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#3aa6a0" entry={vehicleEntry({})}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vehicle_compact_car_01'), expect.any(Error))
    await renderer.unmount()
  })

  it('feeds the shared settle counters so assetsSettled() stays honest', async () => {
    const glbScene = new THREE.Group()
    glbScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'body' })))
    useGLTFMock.mockReturnValue({ scene: glbScene })
    const expected0 = registry.glbLandmarksExpected
    const active0 = registry.glbLandmarksActive
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#3aa6a0" entry={vehicleEntry({})}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(registry.glbLandmarksExpected).toBe(expected0 + 1)
    expect(registry.glbLandmarksActive).toBe(active0 + 1)
    await renderer.unmount()
    // Symmetric teardown — counters return to baseline (no leak across streaming).
    expect(registry.glbLandmarksExpected).toBe(expected0)
    expect(registry.glbLandmarksActive).toBe(active0)
  })
})

/**
 * Issue #40 Wave 1 §"Missing-file tests prove each class falls back to CarMesh".
 *
 * Every owned vehicle class now ships a real GLB body, so the fallback contract has to hold
 * PER CLASS, not just for the one class that happened to have a model first. These drive the
 * REAL manifest entries — not a synthetic fixture — so enabling a class without a working
 * file, or renaming a path, is caught here rather than as a hole in the world.
 */
describe('every owned vehicle class falls back to CarMesh when its GLB is missing (issue #40)', () => {
  const classes = VEHICLE_DEFS.map((d) => ({ defId: d.id, assetId: d.assetId! }))

  it('covers all four dealership classes', () => {
    expect(classes.map((c) => c.defId).sort()).toEqual(['veh_compact', 'veh_scooter', 'veh_sports', 'veh_van'])
    for (const c of classes) expect(ASSET_MANIFEST_BY_ID.get(c.assetId), `${c.defId} manifest entry`).toBeTruthy()
  })

  for (const { defId, assetId } of VEHICLE_DEFS.map((d) => ({ defId: d.id, assetId: d.assetId! }))) {
    it(`${defId}: a missing/failed ${assetId} model still renders the shell`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // Exactly what a deleted or 404ing file does inside useGLTF's suspense path.
      useGLTFMock.mockImplementation(() => {
        throw new Error(`404 ${assetId} not found`)
      })
      const renderer = await ReactThreeTestRenderer.create(
        <VehicleAsset assetId={assetId} paint="#3aa6a0" entry={ASSET_MANIFEST_BY_ID.get(assetId)}>
          <Fallback />
        </VehicleAsset>,
      )
      expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(assetId), expect.any(Error))
      await renderer.unmount()
    })
  }
})

/**
 * Issue #40 Codex review, finding 1 — no duplicate fittings on the GLB path.
 *
 * Every approved Wave 1 body contains its own wheels and lights in its single baked mesh, so the
 * unconditional procedural `CarFittings` sibling drew a second full set on top: four oversized
 * car wheels on a two-wheeled scooter, and headlight/taillight boxes over baked ones. These
 * assert the render tree itself, per branch, so the defect cannot come back silently.
 *
 * Counting rule: the procedural wheel is the only mesh built from a CylinderGeometry, and the
 * headlight/taillight boxes are the only ones using the shared light materials — so the branch
 * can be identified structurally rather than by name.
 */
describe('GLB bodies do not get duplicate procedural wheels or lights (issue #40)', () => {
  const wheels = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
    r.scene.findAll((n) => {
      const g = (n.instance as THREE.Mesh)?.geometry as THREE.BufferGeometry | undefined
      return g?.type === 'CylinderGeometry'
    }).length
  const taillights = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
    r.scene.findAll((n) => (n.instance as THREE.Object3D)?.name === 'taillight').length
  const occupants = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
    r.scene.findAll((n) => {
      const g = (n.instance as THREE.Mesh)?.geometry as THREE.BufferGeometry | undefined
      return g?.type === 'SphereGeometry'
    }).length

  function glbScene() {
    const g = new THREE.Group()
    g.name = 'glb-body'
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'baked_atlas' })))
    return g
  }

  it('the procedural fallback keeps the COMPLETE fittings — four wheels and both taillights', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId={null} color="#3aa6a0" showDriver showPassenger />,
    )
    expect(wheels(renderer), 'fallback wheels').toBe(4)
    expect(taillights(renderer), 'fallback taillights').toBe(2)
    expect(occupants(renderer), 'fallback occupants').toBe(2)
    await renderer.unmount()
  })

  it('a mounted GLB body adds NO procedural wheels or lights, but keeps its occupants', async () => {
    useGLTFMock.mockReturnValue({ scene: glbScene() })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId="vehicle_utility_van_01" color="#3aa6a0" showDriver showPassenger />,
    )
    // The model's own wheels and lamps are inside its mesh — nothing procedural may be layered
    // on top, or the render is a multi-wheel hybrid with a second pair of tail lamps.
    expect(wheels(renderer), 'no duplicate wheels over a GLB body').toBe(0)
    expect(taillights(renderer), 'no duplicate tail lamps over a GLB body').toBe(0)
    // ...but the one fitting the model genuinely lacks survives.
    expect(occupants(renderer), 'occupants kept').toBe(2)
    expect(renderer.scene.findAll((n) => (n.instance as THREE.Object3D)?.name === 'glb-body')).toHaveLength(1)
    await renderer.unmount()
  })

  it('a FAILED GLB falls back to the complete set — a broken model never yields a wheelless car', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useGLTFMock.mockImplementation(() => {
      throw new Error('404 model not found')
    })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId="vehicle_utility_van_01" color="#3aa6a0" showDriver />,
    )
    expect(wheels(renderer), 'fallback restores the wheels').toBe(4)
    expect(taillights(renderer), 'fallback taillights').toBe(2)
    await renderer.unmount()
  })

  it('a baked-atlas body is not tinted, while the fallback shell still paints', async () => {
    const scene = glbScene()
    useGLTFMock.mockReturnValue({ scene })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId="vehicle_utility_van_01" color="#ff0000" showDriver={false} />,
    )
    const root = renderer.scene
      .findAll((n) => (n.instance as THREE.Object3D)?.name === 'glb-body')[0]
      .instance as THREE.Group
    let tinted: string | null = null
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m?.name === 'baked_atlas') tinted = m.color.getHexString()
    })
    // White = untouched. Applying the paint here would recolor windows, lights and tyres too.
    expect(tinted, 'the baked atlas keeps its source paint').toBe('ffffff')
    await renderer.unmount()
  })
})
