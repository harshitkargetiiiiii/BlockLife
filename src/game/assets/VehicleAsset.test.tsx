import { afterEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { VehicleAsset } from './VehicleAsset'
import type { AssetManifestEntry } from './assetManifest'
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
    glbPath: 'assets/models/vehicles/compact_car_01.glb',
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
    expect(useGLTFMock).toHaveBeenCalledWith(expect.stringContaining('compact_car_01.glb'))
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
