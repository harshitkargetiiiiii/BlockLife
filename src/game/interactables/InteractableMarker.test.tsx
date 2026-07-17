import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { InteractableMarker } from './InteractableMarker'
import type { InteractableDef } from './interactableTypes'

const def: InteractableDef = {
  id: 'gym',
  kind: 'gym',
  name: 'Block Gym',
  position: [14, 0, -9.2],
  radius: 3,
  marker: true,
  icon: '💪',
}

describe('InteractableMarker (R3F)', () => {
  it('renders a ground ring and a label', async () => {
    const renderer = await ReactThreeTestRenderer.create(<InteractableMarker def={def} />)
    expect(renderer.scene.findAll((n) => n.props.name === 'marker:gym')).toHaveLength(1)
    expect(renderer.scene.findAll((n) => n.props.name === 'world-label:Block Gym')).toHaveLength(1)
    const meshes = renderer.scene.findAllByType('Mesh')
    expect(meshes.length).toBeGreaterThan(0)
    await renderer.unmount()
  })
})
