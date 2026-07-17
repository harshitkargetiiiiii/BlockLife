import { afterEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { LandmarkAsset } from './LandmarkAsset'
import type { AssetManifestEntry } from './assetManifest'

// Controllable stand-in for drei's useGLTF so tests can exercise the load
// paths without any network or files.
const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

function entryWith(overrides: Partial<AssetManifestEntry>): AssetManifestEntry {
  return {
    id: 'building_gym_01',
    label: 'Test entry',
    category: 'city',
    glbPath: 'assets/models/city/building_gym_01.glb',
    fallbackKey: 'BuildingMesh',
    scale: [2, 2, 2],
    rotation: [0, Math.PI / 2, 0],
    positionOffset: [0, 0.5, 0],
    attribution: null,
    license: null,
    enabled: true,
    ...overrides,
  }
}

function Fallback() {
  return (
    <mesh name="procedural-fallback">
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#e0684b" />
    </mesh>
  )
}

afterEach(() => {
  useGLTFMock.mockReset()
  vi.restoreAllMocks()
})

describe('LandmarkAsset (R3F)', () => {
  it('renders the procedural fallback when the manifest entry is disabled', async () => {
    // Real manifest: the food truck has an entry but no enabled GLB.
    const renderer = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="food_truck_01" position={[1, 0, 2]}>
        <Fallback />
      </LandmarkAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'asset:food_truck_01')).toHaveLength(1)
    expect(renderer.scene.findAll((n) => n.props.name === 'procedural-fallback')).toHaveLength(1)
    expect(useGLTFMock).not.toHaveBeenCalled()
    await renderer.unmount()
  })

  it('setting enabled: false on an entry restores the fallback', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_gym_01" entry={entryWith({ enabled: false })}>
        <Fallback />
      </LandmarkAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'procedural-fallback')).toHaveLength(1)
    expect(useGLTFMock).not.toHaveBeenCalled()
    await renderer.unmount()
  })

  it('renders the fallback for ids with no manifest entry at all', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_never_registered_99">
        <Fallback />
      </LandmarkAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'procedural-fallback')).toHaveLength(1)
    expect(useGLTFMock).not.toHaveBeenCalled()
    await renderer.unmount()
  })

  it('renders the GLB scene with manifest transforms when loading succeeds', async () => {
    const glbScene = new THREE.Group()
    glbScene.name = 'glb-root'
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    glbScene.add(mesh)
    useGLTFMock.mockReturnValue({ scene: glbScene })

    const entry = entryWith({})
    const renderer = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_gym_01" entry={entry}>
        <Fallback />
      </LandmarkAsset>,
    )
    expect(useGLTFMock).toHaveBeenCalledWith(expect.stringContaining(entry.glbPath!))
    // Fallback is replaced by the loaded model...
    expect(renderer.scene.findAll((n) => n.props.name === 'procedural-fallback')).toHaveLength(0)
    // ...which is a clone of the GLTF scene, carrying the manifest transforms.
    const group = renderer.scene.findAll((n) => n.props.name === 'asset:building_gym_01')[0]
    const object = (group.instance as THREE.Group).getObjectByName('glb-root')
    expect(object).toBeTruthy()
    expect(object!.scale.x).toBe(2)
    expect(object!.position.y).toBe(0.5)
    let sawShadowMesh = false
    object!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        sawShadowMesh = true
        expect(o.castShadow).toBe(true)
      }
    })
    expect(sawShadowMesh).toBe(true)
    await renderer.unmount()
  })

  it('falls back and warns (dev-only) when the GLB fails to load — never crashes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // React also logs boundary-caught errors via console.error; keep output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useGLTFMock.mockImplementation(() => {
      throw new Error('404 model not found')
    })

    const renderer = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_gym_01" entry={entryWith({})}>
        <Fallback />
      </LandmarkAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'procedural-fallback')).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('building_gym_01'),
      expect.any(Error),
    )
    await renderer.unmount()
  })
})
