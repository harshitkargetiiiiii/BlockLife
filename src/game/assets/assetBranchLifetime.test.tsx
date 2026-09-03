import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { LandmarkAsset } from './LandmarkAsset'
import { VehicleAsset } from './VehicleAsset'
import type { AssetManifestEntry } from './assetManifest'
import { getGlbBranch, isGlbBodyRendering, suppressProceduralDouble } from './modelRegistry'
import { registry } from '../world/runtimeRegistry'
import { assetGraphPending, isAssetGraphSettled, unresolvedInstances, ASSET_SETTLE_QUIET_MS } from './assetSettle'

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

/**
 * Issue #46 §4 — the GLB census has to be a LIVE count of mounted instances, not a tally of
 * everything that ever happened. `assetSettle.test.ts` proves the arithmetic; this file proves
 * the two real components actually keep to it through mount, failure, unmount and remount, with
 * several instances of the same asset id in play.
 */
function entry(overrides: Partial<AssetManifestEntry> = {}): AssetManifestEntry {
  return {
    id: 'building_office_01',
    label: 'Test body',
    category: 'city',
    glbPath: 'assets/models/city/arch_office_01.glb',
    fallbackKey: 'BuildingMesh',
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    positionOffset: [0, 0, 0],
    attribution: null,
    license: null,
    enabled: true,
    ...overrides,
  }
}
const Fallback = () => <mesh name="procedural-fallback" />
const counters = () => ({
  expected: registry.glbLandmarksExpected,
  active: registry.glbLandmarksActive,
  failed: registry.glbLandmarksFailed,
  epoch: registry.glbLandmarkEpoch,
  changedAt: registry.glbLandmarkChangedAt,
  unresolved: unresolvedInstances(registry.glbAssetState),
})

let base = { expected: 0, active: 0, failed: 0 }
beforeEach(() => {
  registry.glbAssetState.clear()
  useGLTFMock.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  base = { expected: registry.glbLandmarksExpected, active: registry.glbLandmarksActive, failed: registry.glbLandmarksFailed }
})
afterEach(() => vi.restoreAllMocks())

describe('issue #46 §4 — GLB census lifetime', () => {
  it('a FAILED landmark releases its count on unmount, so a slow remount stays pending', async () => {
    // 1. It fails.
    useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
    const failedRenderer = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_office_01" entry={entry()}><Fallback /></LandmarkAsset>,
    )
    expect(registry.glbLandmarksFailed, 'failure counted while mounted').toBe(base.failed + 1)
    expect(getGlbBranch('building_office_01')).toBe('failed')
    expect(isGlbBodyRendering('building_office_01')).toBe(false)

    // 2. It unmounts. THIS is the step the leak skipped.
    await failedRenderer.unmount()
    expect(registry.glbLandmarksFailed, 'failure released on unmount').toBe(base.failed)
    expect(registry.glbLandmarksExpected).toBe(base.expected)
    expect(getGlbBranch('building_office_01'), 'branch released too').toBeUndefined()

    // 3. A fresh instance mounts and its load is still in flight (Suspense never resolves).
    useGLTFMock.mockImplementation(() => { throw new Promise<never>(() => {}) })
    const slowRenderer = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_office_01" entry={entry()}><Fallback /></LandmarkAsset>,
    )
    const c = counters()
    expect(assetGraphPending(c), 'the in-flight instance is visible as pending').toBe(1)
    // …and no amount of quiet can open the gate while it is in flight. This is the regression:
    // a slow load is exactly when nothing moves the graph, so quiescence alone cannot save it.
    expect(isAssetGraphSettled(c, c.changedAt + ASSET_SETTLE_QUIET_MS * 100)).toBe(false)
    await slowRenderer.unmount()
  })

  it('isGlbBodyRendering means ACTIVE — not "has not failed"', async () => {
    // The regression: this used to be `branch !== 'failed'`, so it answered TRUE in the two
    // states where the PROCEDURAL body is what a screenshot would catch — nothing mounted, and
    // every instance still loading behind Suspense.
    expect(getGlbBranch('building_office_01'), 'nothing mounted').toBeUndefined()
    expect(isGlbBodyRendering('building_office_01'), 'nothing mounted -> not rendering').toBe(false)

    // LOADING: mounted, Suspense never resolves. The fallback is on screen.
    useGLTFMock.mockImplementation(() => { throw new Promise<never>(() => {}) })
    const loading = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_office_01" entry={entry()}><Fallback /></LandmarkAsset>,
    )
    expect(getGlbBranch('building_office_01'), 'still loading').toBeUndefined()
    expect(isGlbBodyRendering('building_office_01'), 'loading -> not rendering').toBe(false)
    // …while the SUPPRESSION policy stays optimistic, which is what keeps the garage door from
    // flashing over the model on every sector remount.
    expect(suppressProceduralDouble('building_office_01'), 'loading -> still suppress the stand-in').toBe(true)
    await loading.unmount()

    // ACTIVE.
    const glbScene = new THREE.Group()
    glbScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    useGLTFMock.mockReset()
    useGLTFMock.mockReturnValue({ scene: glbScene })
    const active = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_office_01" entry={entry()}><Fallback /></LandmarkAsset>,
    )
    expect(isGlbBodyRendering('building_office_01'), 'active -> rendering').toBe(true)
    expect(suppressProceduralDouble('building_office_01')).toBe(true)
    await active.unmount()

    // FAILED: both answers flip, and they agree.
    useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
    const failed = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="building_office_01" entry={entry()}><Fallback /></LandmarkAsset>,
    )
    expect(isGlbBodyRendering('building_office_01'), 'failed -> not rendering').toBe(false)
    expect(suppressProceduralDouble('building_office_01'), 'failed -> draw the stand-in').toBe(false)
    await failed.unmount()

    // A manifest id with no real model is false either way.
    expect(isGlbBodyRendering('not_a_manifest_id')).toBe(false)
    expect(suppressProceduralDouble('not_a_manifest_id')).toBe(false)
  })

  it('MIXED instances: one active sibling means the body IS rendering, and the stand-in stays off', async () => {
    const glbScene = new THREE.Group()
    glbScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    useGLTFMock.mockReturnValue({ scene: glbScene })
    const arch = entry({ id: 'arch_house_01', glbPath: 'assets/models/city/arch_house_01.glb' })
    const good = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="arch_house_01" entry={arch}><Fallback /></LandmarkAsset>,
    )
    useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
    const bad = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="arch_house_01" entry={arch}><Fallback /></LandmarkAsset>,
    )
    expect(isGlbBodyRendering('arch_house_01'), 'an active instance is on screen').toBe(true)
    expect(suppressProceduralDouble('arch_house_01')).toBe(true)
    await good.unmount()
    expect(isGlbBodyRendering('arch_house_01'), 'only the failed one is left').toBe(false)
    expect(suppressProceduralDouble('arch_house_01')).toBe(false)
    await bad.unmount()
  })

  it('a FAILED vehicle body releases its count on unmount too', async () => {
    useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
    const veh = entry({ id: 'vehicle_utility_van_01', category: 'vehicles', fallbackKey: 'CarMesh', glbPath: 'assets/models/vehicles/utility_van_01.glb' })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_utility_van_01" paint="#3aa6a0" entry={veh}><Fallback /></VehicleAsset>,
    )
    expect(registry.glbLandmarksFailed).toBe(base.failed + 1)
    expect(getGlbBranch('vehicle_utility_van_01')).toBe('failed')
    await renderer.unmount()
    expect(registry.glbLandmarksFailed, 'released').toBe(base.failed)
    expect(getGlbBranch('vehicle_utility_van_01')).toBeUndefined()
  })

  it('switching the body under a FAILED boundary releases the old id, not the new one', async () => {
    // The ONE shell projects whichever vehicle class is active, so this boundary's assetId
    // really does change under it. If the release used `this.props.assetId` at unmount time it
    // would decrement the NEW class's branch and strand the old one's; and without the key the
    // boundary would carry `state.failed` across, so a perfectly good body would render its
    // fallback forever.
    useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
    const van = entry({ id: 'vehicle_utility_van_01', category: 'vehicles', fallbackKey: 'CarMesh', glbPath: 'assets/models/vehicles/utility_van_01.glb' })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_utility_van_01" paint="#3aa6a0" entry={van}><Fallback /></VehicleAsset>,
    )
    expect(registry.glbLandmarksFailed).toBe(base.failed + 1)
    expect(getGlbBranch('vehicle_utility_van_01')).toBe('failed')

    // Swap the body. The new one loads fine.
    const glbScene = new THREE.Group()
    glbScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    useGLTFMock.mockReset()
    useGLTFMock.mockReturnValue({ scene: glbScene })
    const sports = entry({ id: 'vehicle_sports_car_01', category: 'vehicles', fallbackKey: 'CarMesh', glbPath: 'assets/models/vehicles/sports_car_01.glb' })
    await renderer.update(
      <VehicleAsset assetId="vehicle_sports_car_01" paint="#3aa6a0" entry={sports}><Fallback /></VehicleAsset>,
    )

    expect(getGlbBranch('vehicle_utility_van_01'), 'the OLD id let go of its failure').toBeUndefined()
    expect(getGlbBranch('vehicle_sports_car_01'), 'the NEW id is active, not inherited-failed').toBe('active')
    expect(registry.glbLandmarksFailed, 'no failure left counted').toBe(base.failed)
    expect(registry.glbLandmarksActive).toBe(base.active + 1)
    expect(isGlbBodyRendering('vehicle_sports_car_01')).toBe(true)

    await renderer.unmount()
    expect(registry.glbLandmarksActive).toBe(base.active)
    expect(registry.glbLandmarksFailed).toBe(base.failed)
    expect(registry.glbLandmarksExpected).toBe(base.expected)
  })

  it('one archetype, several placements: unmounting one does not clear the branch of the rest', async () => {
    // `arch_house_01` backs four houses and sector streaming mounts them independently. With a
    // single-valued branch map, the first to unmount told the world the others had stopped
    // rendering their GLB.
    const glbScene = new THREE.Group()
    glbScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    useGLTFMock.mockReturnValue({ scene: glbScene })
    const arch = entry({ id: 'arch_house_01', glbPath: 'assets/models/city/arch_house_01.glb' })
    const a = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="arch_house_01" entry={arch}><Fallback /></LandmarkAsset>,
    )
    const b = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="arch_house_01" entry={arch}><Fallback /></LandmarkAsset>,
    )
    expect(registry.glbLandmarksActive).toBe(base.active + 2)
    expect(getGlbBranch('arch_house_01')).toBe('active')

    await a.unmount()
    expect(registry.glbLandmarksActive).toBe(base.active + 1)
    expect(getGlbBranch('arch_house_01'), 'the surviving instance still holds the branch').toBe('active')
    expect(isGlbBodyRendering('arch_house_01')).toBe(true)

    await b.unmount()
    expect(registry.glbLandmarksActive).toBe(base.active)
    expect(getGlbBranch('arch_house_01'), 'released once the last instance is gone').toBeUndefined()
  })

  it('an ACTIVE instance outranks a failed sibling of the same id', async () => {
    // Mixed state: one placement's file 404s while another already committed. The body IS on
    // screen, so consumers that must not double up with the fallback have to see 'active'.
    const glbScene = new THREE.Group()
    glbScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    useGLTFMock.mockReturnValue({ scene: glbScene })
    const arch = entry({ id: 'arch_house_01', glbPath: 'assets/models/city/arch_house_01.glb' })
    const good = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="arch_house_01" entry={arch}><Fallback /></LandmarkAsset>,
    )
    useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
    const bad = await ReactThreeTestRenderer.create(
      <LandmarkAsset assetId="arch_house_01" entry={arch}><Fallback /></LandmarkAsset>,
    )
    expect(getGlbBranch('arch_house_01'), 'active wins over failed').toBe('active')
    expect(isGlbBodyRendering('arch_house_01')).toBe(true)
    await good.unmount()
    expect(getGlbBranch('arch_house_01'), 'only the failed one is left').toBe('failed')
    expect(isGlbBodyRendering('arch_house_01')).toBe(false)
    await bad.unmount()
    expect(getGlbBranch('arch_house_01')).toBeUndefined()
    expect(registry.glbLandmarksFailed).toBe(base.failed)
  })
})
