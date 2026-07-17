import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { Physics } from '@react-three/rapier'
import { Suspense } from 'react'
import { Vehicle } from './Vehicle'
import { CarMesh } from './CarMesh'

describe('Vehicle (R3F)', () => {
  it('CarMesh renders body, cabin, four wheels and lights', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CarMesh color="#3aa6a0" />)
    const group = renderer.scene.findAll((n) => n.props.name === 'car-mesh')
    expect(group).toHaveLength(1)
    const meshes = renderer.scene.findAllByType('Mesh')
    // body + cabin + 4 wheels + 2 headlights + 2 taillights
    expect(meshes.length).toBeGreaterThanOrEqual(10)
    await renderer.unmount()
  })

  it('the drivable Vehicle renders inside a physics world without crashing', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Suspense fallback={null}>
        <Physics paused>
          <Vehicle />
        </Physics>
      </Suspense>,
    )
    // Rapier's WASM init is async; give suspense a few frames to resolve.
    await ReactThreeTestRenderer.act(async () => {
      await new Promise((r) => setTimeout(r, 300))
      await renderer.advanceFrames(2, 16)
    })
    const car = renderer.scene.findAll((n) => n.props.name === 'vehicle_compact_car_01')
    expect(car.length).toBe(1)
    await renderer.unmount()
  })
})
