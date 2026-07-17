import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { AmbientAnimations } from './AmbientAnimations'
import { CityBlock } from './CityBlock'
import { SMOKE_TUNING } from './FoodTruck'
import { MARKER_RING } from '../interactables/InteractableMarker'

describe('AmbientAnimations (R3F)', () => {
  it('park birds are real silhouettes — no debug-arrow cone geometry anywhere', async () => {
    const renderer = await ReactThreeTestRenderer.create(<AmbientAnimations />)
    const scene = renderer.scene.instance as THREE.Group
    const birds: THREE.Object3D[] = []
    let coneCount = 0
    scene.traverse((o) => {
      if (o.name === 'park-bird') birds.push(o)
      const geom = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
      if (geom?.type === 'ConeGeometry') coneCount++
    })
    expect(birds.length).toBe(2)
    // Each bird: body + two wings.
    for (const bird of birds) {
      let meshes = 0
      bird.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++
      })
      expect(meshes).toBe(3)
    }
    expect(coneCount, 'no arrow-like cones in the park').toBe(0)
    await renderer.unmount()
  })

  it('the pond renders layered water (bank, water, shallow, shimmer, lilies)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CityBlock />)
    const scene = renderer.scene.instance as THREE.Group
    const layers = new Set<string>()
    scene.traverse((o) => {
      if (o.name.startsWith('pond-')) layers.add(o.name)
    })
    expect([...layers].sort()).toEqual([
      'pond-bank',
      'pond-lily',
      'pond-shallow',
      'pond-shimmer',
      'pond-water',
    ])
    await renderer.unmount()
  })

  it('food truck steam and marker rings stay soft (regression guards)', () => {
    // Steam: near-vertical, faint, slow — the old sideways drift read as a
    // weird "current" streaming out of Maya's truck.
    expect(SMOKE_TUNING.drift).toBeLessThanOrEqual(0.2)
    expect(SMOKE_TUNING.maxOpacity).toBeLessThanOrEqual(0.35)
    expect(SMOKE_TUNING.speed).toBeLessThanOrEqual(0.3)
    // Rings: dim and gentle, not an energy field.
    expect(MARKER_RING.idleOpacity).toBeLessThanOrEqual(0.3)
    expect(MARKER_RING.activeOpacity).toBeLessThanOrEqual(0.7)
    expect(MARKER_RING.pulseAmplitude).toBeLessThanOrEqual(0.05)
  })
})
