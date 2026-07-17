import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { CityBlock } from './CityBlock'

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
      expect(slot.length, `asset slot for ${id}`).toBe(1)
      // With no GLB enabled, the slot must contain the procedural meshes.
      expect(slot[0].findAllByType('Mesh').length).toBeGreaterThan(0)
    }
    await renderer.unmount()
  })

  it('GLB buildings get night window overlays; street props render with fallbacks', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    for (const id of [
      'building_apartment_01',
      'building_gym_01',
      'building_office_01',
      'building_tower_01',
    ]) {
      expect(
        renderer.scene.findAll((n) => n.props.name === `window-overlay:${id}`).length,
        `window overlay for ${id}`,
      ).toBe(1)
    }
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
