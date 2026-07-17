import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { BuildingWindowOverlays } from './WindowOverlays'
import { validateWindowOverlays, WINDOW_OVERLAYS } from './windowOverlayData'
import { glbWindowGlowMaterial, updateGlowMaterials } from './materials'
import { getLampGlow } from '../simulation/worldMoodSystem'

const GLB_BUILDING_IDS = [
  'building_apartment_01',
  'building_gym_01',
  'building_office_01',
  'building_tower_01',
]

describe('window overlay data', () => {
  it('is valid', () => {
    expect(validateWindowOverlays(WINDOW_OVERLAYS)).toEqual([])
  })

  it('covers every GLB-skinned building', () => {
    for (const id of GLB_BUILDING_IDS) {
      expect(
        WINDOW_OVERLAYS.some((d) => d.buildingAssetId === id),
        `overlay defs for ${id}`,
      ).toBe(true)
    }
  })

  it('validation catches broken defs', () => {
    const good = WINDOW_OVERLAYS[0]
    const errors = validateWindowOverlays([
      { ...good, buildingAssetId: 'building_not_registered' },
      { ...good, rows: 0 },
      { ...good, litRatio: 0 },
      { ...good, facadeDistance: -1 },
    ])
    expect(errors.some((e) => e.includes('unknown asset id'))).toBe(true)
    expect(errors.some((e) => e.includes('rows/columns'))).toBe(true)
    expect(errors.some((e) => e.includes('litRatio'))).toBe(true)
    expect(errors.some((e) => e.includes('facadeDistance'))).toBe(true)
  })
})

describe('BuildingWindowOverlays (R3F)', () => {
  it('renders instanced glow planes for a GLB building', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <BuildingWindowOverlays assetId="building_apartment_01" />,
    )
    const group = renderer.scene.findAll(
      (n) => n.props.name === 'window-overlay:building_apartment_01',
    )
    expect(group).toHaveLength(1)
    // One InstancedMesh per façade, each with a lit subset of the grid.
    const scene = renderer.scene.instance as THREE.Group
    const instanced: THREE.InstancedMesh[] = []
    scene.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh)
    })
    expect(instanced.length).toBe(
      WINDOW_OVERLAYS.filter((d) => d.buildingAssetId === 'building_apartment_01').length,
    )
    for (const mesh of instanced) {
      expect(mesh.count).toBeGreaterThan(0)
      expect(mesh.material).toBe(glbWindowGlowMaterial)
    }
    await renderer.unmount()
  })

  it('renders nothing for buildings without overlay defs', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <BuildingWindowOverlays assetId="building_house_01" />,
    )
    expect(
      renderer.scene.findAll((n) =>
        String(n.props.name ?? '').startsWith('window-overlay:'),
      ),
    ).toHaveLength(0)
    await renderer.unmount()
  })

  it('is invisible by day and glowing at night (lamp-glow driven)', () => {
    updateGlowMaterials(getLampGlow(13)) // afternoon
    expect(glbWindowGlowMaterial.opacity).toBe(0)
    updateGlowMaterials(getLampGlow(23)) // night
    expect(glbWindowGlowMaterial.opacity).toBeGreaterThan(0.8)
    updateGlowMaterials(getLampGlow(19.5)) // dusk ramp
    expect(glbWindowGlowMaterial.opacity).toBeGreaterThan(0)
    expect(glbWindowGlowMaterial.opacity).toBeLessThan(0.9)
  })

  it('lit pattern is deterministic for a given seed', async () => {
    const a = await ReactThreeTestRenderer.create(
      <BuildingWindowOverlays assetId="building_gym_01" />,
    )
    const b = await ReactThreeTestRenderer.create(
      <BuildingWindowOverlays assetId="building_gym_01" />,
    )
    const counts = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) => {
      const out: number[] = []
      ;(r.scene.instance as THREE.Group).traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) out.push((o as THREE.InstancedMesh).count)
      })
      return out
    }
    expect(counts(a)).toEqual(counts(b))
    await a.unmount()
    await b.unmount()
  })
})
