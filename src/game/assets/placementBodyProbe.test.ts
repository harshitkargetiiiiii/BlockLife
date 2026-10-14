import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { readPlacementBody } from './placementBodyProbe'
import { LANDMARK_GLB_ROOT_MARKER } from './variantCacheOwnership'

function placement(id: string, glbAssetId?: string): THREE.Group {
  const g = new THREE.Group()
  g.name = id
  const slot = new THREE.Group()
  slot.name = `asset:${glbAssetId ?? 'x'}`
  g.add(slot)
  if (glbAssetId) {
    const clone = new THREE.Group()
    clone.userData[LANDMARK_GLB_ROOT_MARKER] = glbAssetId
    clone.add(new THREE.Mesh())
    slot.add(clone)
  } else {
    slot.add(new THREE.Mesh()) // the procedural fallback: no marked clone
  }
  return g
}

describe('readPlacementBody', () => {
  it('reports the body mounted under THAT placement, not anywhere in the scene', () => {
    const scene = new THREE.Scene()
    scene.add(placement('building_tower_02', 'building_gate_hotel_01'))
    scene.add(placement('building_tower_05', 'building_apartment_01'))
    scene.add(placement('building_tower_03'))
    expect(readPlacementBody(scene, 'building_tower_02')).toEqual({ found: true, glbAssetIds: ['building_gate_hotel_01'] })
    expect(readPlacementBody(scene, 'building_tower_05')).toEqual({ found: true, glbAssetIds: ['building_apartment_01'] })
    // A placement drawing its procedural fallback has no marked clone, even though another
    // placement's GLB is mounted elsewhere in the same scene.
    expect(readPlacementBody(scene, 'building_tower_03')).toEqual({ found: true, glbAssetIds: [] })
  })

  it('distinguishes a missing placement from a fallback one', () => {
    expect(readPlacementBody(new THREE.Scene(), 'building_tower_02')).toEqual({ found: false, glbAssetIds: [] })
    expect(readPlacementBody(null, 'building_tower_02')).toEqual({ found: false, glbAssetIds: [] })
  })
})
