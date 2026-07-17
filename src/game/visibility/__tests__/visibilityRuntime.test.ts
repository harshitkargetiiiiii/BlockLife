import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  clearAllFades,
  getActiveVisibilitySubject,
  registerOccluder,
  TELEPORT_DISTANCE,
  unregisterOccluder,
  visibilityRuntime,
} from '../visibilityRuntime'
import { getBuildingOccluderDescriptor } from '../occluderData'
import { swapToFadeMaterials } from '../materialFade'
import { createInitialGameState, useGameStore } from '../../store/useGameStore'
import { registry } from '../../world/runtimeRegistry'

function register(id: string) {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
  registerOccluder(
    getBuildingOccluderDescriptor({
      id,
      position: [0, 0],
      size: [6, 8, 6],
      color: '#888888',
      roofColor: '#555555',
    }),
    group,
  )
  return group
}

describe('visibility runtime', () => {
  beforeEach(() => {
    for (const id of [...visibilityRuntime.occluders.keys()]) unregisterOccluder(id)
    useGameStore.setState(createInitialGameState())
    visibilityRuntime.enabled = true
    visibilityRuntime.hasLastSubject = false
  })

  it('register/unregister maintains the descriptor cache and restores materials', () => {
    const group = register('building_a')
    expect(visibilityRuntime.descriptorCache).toHaveLength(1)
    const occ = visibilityRuntime.occluders.get('building_a')!
    const mesh = group.children[0] as THREE.Mesh
    const original = mesh.material
    swapToFadeMaterials(occ)
    expect(mesh.material).not.toBe(original)
    unregisterOccluder('building_a')
    expect(mesh.material).toBe(original) // unmount cleans up
    expect(visibilityRuntime.descriptorCache).toHaveLength(0)
  })

  it('clearAllFades restores every swapped occluder and resets state', () => {
    const groupA = register('building_a')
    register('building_b')
    const occA = visibilityRuntime.occluders.get('building_a')!
    swapToFadeMaterials(occA)
    occA.state.currentOpacity = 0.3
    occA.state.targetOpacity = 0.25
    clearAllFades()
    expect(occA.swapped).toBe(false)
    expect(occA.state.currentOpacity).toBe(1)
    expect((groupA.children[0] as THREE.Mesh).material).toBeDefined()
    expect(visibilityRuntime.hasLastSubject).toBe(false)
  })

  it('subject resolver: player on foot', () => {
    registry.playerPosition.set(5, 0.8, -3)
    const s = getActiveVisibilitySubject()!
    expect(s.kind).toBe('player')
    expect(s.x).toBe(5)
    expect(s.z).toBe(-3)
    expect(s.sampleHeights).toHaveLength(3)
    expect(s.minBlockedSamples).toBe(2)
  })

  it('subject resolver: driving uses the vehicle with vehicle dimensions', () => {
    useGameStore.setState({ mode: 'driving' })
    registry.vehiclePosition.set(20, 0.8, 10)
    const s = getActiveVisibilitySubject()!
    expect(s.kind).toBe('vehicle')
    expect(s.x).toBe(20)
    expect(s.radius).toBeGreaterThan(1)
    expect(s.minBlockedSamples).toBe(1)
  })

  it('subject resolver: apartment disables outdoor occlusion', () => {
    useGameStore.setState({ location: 'apartment' })
    expect(getActiveVisibilitySubject()).toBeNull()
  })

  it('teleport threshold is generous enough for normal movement', () => {
    // Fastest subject (car ~13 u/s) at a 100 ms frame moves ~1.3 units —
    // far below the threshold, so only real teleports trigger clearing.
    expect(TELEPORT_DISTANCE).toBeGreaterThan(5)
  })

  it('manifest occlusion overrides validate against the descriptor shape', () => {
    const desc = getBuildingOccluderDescriptor({
      id: 'building_no_manifest_entry',
      position: [0, 0],
      size: [6, 8, 6],
      color: '#888888',
      roofColor: '#555555',
    })
    expect(desc.enabled).toBe(true)
    expect(desc.minimumOpacity).toBeGreaterThan(0.1)
    expect(desc.minimumOpacity).toBeLessThan(0.5)
  })
})
