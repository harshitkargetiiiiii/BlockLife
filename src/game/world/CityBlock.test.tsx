import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import type * as THREE from 'three'
import { CityBlock } from './CityBlock'
import { BUILDINGS } from './cityLayout'

/**
 * The placement groups each landmark row renders in: an id-keyed lot plus every `BuildingDef.visual`
 * projection of that row (issue #63's two offices, issue #53's apartment reuse, and so on), so a slot
 * and its night overlay grid appear under exactly those placements.
 *
 * Every placement an asset id renders under: its own id-keyed lot plus every `BuildingDef.visual`
 * projection of it. DERIVED from the layout rather than transcribed — a hardcoded table silently went
 * stale the moment issue #53 projected the apartment body onto two more lots.
 */
const placementsOf = (id: string) => {
  const placements = BUILDINGS.filter((b) => (b.visual?.assetId ?? b.id) === id).map((b) => b.id)
  return placements.length > 0 ? placements : [id]
}

/** The nearest ancestor whose name is one of `candidates` (the placement group a node renders under). */
function owningPlacement(node: THREE.Object3D, candidates: string[]): string | null {
  for (let p: THREE.Object3D | null = node.parent; p; p = p.parent) if (candidates.includes(p.name)) return p.name
  return null
}

// jsdom can't fetch GLB files; make every enabled landmark take the
// error path so its procedural fallback renders deterministically.
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: () => {
    throw new Error('no GLB loading in unit tests')
  },
}))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('CityBlock (R3F)', () => {
  it('renders the major landmarks', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    const names = [
      'building_apartment_01',
      'building_gym_01',
      'building_office_01',
      'food_truck_01',
      'park',
      'parking-lot',
      'roads',
      'props',
    ]
    for (const name of names) {
      const found = renderer.scene.findAll((node) => node.props.name === name)
      expect(found.length, `expected landmark "${name}"`).toBeGreaterThan(0)
    }
    await renderer.unmount()
  })

  it('renders street lamps, trees, benches and parked cars', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    const lampCount = renderer.scene.findAll((n) =>
      String(n.props.name ?? '').startsWith('prop_street_lamp'),
    ).length
    expect(lampCount).toBeGreaterThanOrEqual(8)
    expect(
      renderer.scene.findAll((n) => String(n.props.name ?? '').startsWith('prop_tree')).length,
    ).toBeGreaterThanOrEqual(5)
    expect(
      renderer.scene.findAll((n) => String(n.props.name ?? '').startsWith('prop_bench')).length,
    ).toBeGreaterThanOrEqual(2)
    expect(
      renderer.scene.findAll((n) => String(n.props.name ?? '').startsWith('vehicle_parked_car'))
        .length,
    ).toBeGreaterThanOrEqual(2)
    await renderer.unmount()
  })

  it('major landmarks render procedural fallbacks through their asset slots', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    const slotIds = [
      'building_apartment_01',
      'building_gym_01',
      'building_office_01',
      'building_tower_01',
      'food_truck_01',
      'prop_job_kiosk_01',
    ]
    for (const id of slotIds) {
      const slot = renderer.scene.findAll((n) => n.props.name === `asset:${id}`)
      const expected = placementsOf(id)
      expect(slot.length, `asset slot for ${id}`).toBe(expected.length)
      if (expected.length > 1 || expected[0] !== id) {
        expect(slot.map((s) => owningPlacement(s.instance as THREE.Object3D, expected)).sort(), `${id} slots render under exactly these placements`).toEqual([...expected].sort())
      }
      // With no GLB enabled, every slot must contain the procedural meshes.
      for (const s of slot) expect(s.findAllByType('Mesh').length, `${id} procedural meshes`).toBeGreaterThan(0)
    }
    await renderer.unmount()
  })

  it('GLB buildings get night window overlays; street props render with fallbacks', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    for (const id of ['building_gym_01', 'building_office_01', 'building_tower_01']) {
      const overlays = renderer.scene.findAll((n) => n.props.name === `window-overlay:${id}`)
      const expected = placementsOf(id)
      expect(overlays.length, `window overlay for ${id}`).toBe(expected.length)
      if (expected.length > 1 || expected[0] !== id) {
        expect(overlays.map((o) => owningPlacement(o.instance as THREE.Object3D, expected)).sort(), `${id} overlay grids render under exactly these placements`).toEqual([...expected].sort())
      }
    }
    // Issue #44 Wave 3: the apartment's approved body bakes its own windows, so its
    // Quaternius-era grid was suppressed — there must be no ghost grid left behind it.
    expect(
      renderer.scene.findAll((n) => n.props.name === 'window-overlay:building_apartment_01').length,
      'suppressed apartment overlay',
    ).toBe(0)
    // New decorative street props exist (fallbacks render — loader is mocked off).
    for (const prefix of ['prop_bollard', 'prop_ac_unit', 'prop_street_planter', 'prop_manhole', 'prop_drain']) {
      const found = renderer.scene.findAll((n) => String(n.props.name ?? '').startsWith(prefix))
      expect(found.length, `props with prefix ${prefix}`).toBeGreaterThan(0)
    }
    await renderer.unmount()
  })

  it('renders markers with labels for important places', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    expect(
      renderer.scene.findAll((n) => n.props.name === "world-label:Maya's Snack Truck").length,
    ).toBeGreaterThan(0)
    expect(
      renderer.scene.findAll((n) => n.props.name === 'world-label:Block Gym').length,
    ).toBeGreaterThan(0)
    await renderer.unmount()
  })
})
