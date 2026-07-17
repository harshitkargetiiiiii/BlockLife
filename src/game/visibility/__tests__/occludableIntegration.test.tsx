import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { Buildings } from '../../world/Buildings'
import { BUILDINGS } from '../../world/cityLayout'
import { unregisterOccluder, visibilityRuntime } from '../visibilityRuntime'
import { swapToFadeMaterials, applyFade, restoreOriginalMaterials } from '../materialFade'
import { MIN_OCCLUDER_HEIGHT_EXPORT_FOR_TESTS } from '../occluderData'

// jsdom can't fetch GLBs; every landmark falls back to the procedural mesh.
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: () => {
    throw new Error('no GLB loading in unit tests')
  },
}))
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('Occludable integration (R3F)', () => {
  beforeEach(() => {
    for (const id of [...visibilityRuntime.occluders.keys()]) unregisterOccluder(id)
  })
  afterEach(() => {
    for (const id of [...visibilityRuntime.occluders.keys()]) unregisterOccluder(id)
  })

  it('every tall building registers; unmount cleans the registry', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Buildings />)
    const tall = BUILDINGS.filter((b) => b.size[1] >= MIN_OCCLUDER_HEIGHT_EXPORT_FOR_TESTS)
    for (const def of tall) {
      expect(visibilityRuntime.occluders.has(def.id), `registered ${def.id}`).toBe(true)
    }
    // Procedural fallback meshes are discoverable for fading.
    const office = visibilityRuntime.occluders.get('building_office_01')!
    swapToFadeMaterials(office)
    expect(office.meshes!.length).toBeGreaterThan(3)
    // Fade + restore round-trip leaves materials pristine.
    const firstMesh = office.meshes![0].mesh
    const original = office.meshes![0].originalMaterial
    applyFade(office, 0.25)
    expect(firstMesh.material).not.toBe(original)
    restoreOriginalMaterials(office)
    expect(firstMesh.material).toBe(original)

    await renderer.unmount()
    expect(visibilityRuntime.occluders.size).toBe(0)
  })

  it('two buildings fade independently with no material leakage', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Buildings />)
    const a = visibilityRuntime.occluders.get('building_apartment_01')!
    const b = visibilityRuntime.occluders.get('building_gym_01')!
    swapToFadeMaterials(a)
    swapToFadeMaterials(b)
    applyFade(a, 0.3)
    applyFade(b, 0.8)
    const aMat = a.meshes![0].mesh.material as THREE.Material
    const bMat = b.meshes![0].mesh.material as THREE.Material
    expect(aMat).not.toBe(bMat)
    expect(aMat.opacity).toBeCloseTo(0.3)
    expect(bMat.opacity).toBeCloseTo(0.8)
    restoreOriginalMaterials(a)
    // b is still faded, a fully restored — no shared state.
    expect(b.swapped).toBe(true)
    expect(a.swapped).toBe(false)
    await renderer.unmount()
  })
})
