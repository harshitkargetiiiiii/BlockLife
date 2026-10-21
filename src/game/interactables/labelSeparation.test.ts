import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { STATIC_INTERACTABLES } from '../../data/interactables'
import { BUILDINGS } from '../world/cityLayout'
import { CAMERA_OFFSET } from '../camera/cameraGeometry'
import { projectedLabelHeight, resolveBuildingVisual } from '../world/buildingProjection'
import { getManifestEntry, hasRealModel } from '../assets/modelRegistry'
import { MARKER_LABEL_OFFSET } from './InteractableMarker'

/**
 * The Job Board marker label vs the Nook Offices building sign behind it.
 *
 * FollowCamera is ORTHOGRAPHIC at a fixed CAMERA_OFFSET, so the on-screen offset between two
 * world-anchored labels does not depend on where the player stands — an overlap is permanent
 * whenever both are in view. At the default marker height the two chips projected ~48 px apart
 * horizontally but only ~10 px apart vertically, so "Nook Offices" covered "Job Board".
 */

// FollowCamera's walking and driving zooms (pixels per world unit), and a label chip's height.
const ZOOM_WALKING = 34
const ZOOM_DRIVING = 28
const CHIP_HEIGHT_PX = 26

function screenDelta(a: THREE.Vector3, b: THREE.Vector3, zoom: number): { dx: number; dy: number } {
  const forward = new THREE.Vector3(...CAMERA_OFFSET).negate().normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward)
  const d = b.clone().sub(a)
  return { dx: d.dot(right) * zoom, dy: -d.dot(up) * zoom }
}

/** The building sign's world anchor, computed exactly as Buildings.tsx does. */
function buildingSignAnchor(id: string): THREE.Vector3 {
  const def = BUILDINGS.find((b) => b.id === id)!
  const visual = resolveBuildingVisual(def)
  const visualId = visual?.assetId ?? def.id
  const entry = getManifestEntry(visualId)
  const raw = hasRealModel(visualId) && entry?.labelHeight ? entry.labelHeight : def.size[1] + 1.6
  return new THREE.Vector3(def.position[0], projectedLabelHeight(visual, raw), def.position[1])
}

describe('Job Board label clears the Nook Offices sign', () => {
  const job = STATIC_INTERACTABLES.find((i) => i.id === 'job_board')!
  const office = buildingSignAnchor('building_office_01')
  const jobAnchor = (offset: number) => new THREE.Vector3(job.position![0], offset, job.position![2])

  it('the default marker height overlaps the sign (the case this guards)', () => {
    const { dy } = screenDelta(office, jobAnchor(MARKER_LABEL_OFFSET), ZOOM_WALKING)
    expect(Math.abs(dy)).toBeLessThan(CHIP_HEIGHT_PX)
  })

  for (const [mode, zoom] of [['walking', ZOOM_WALKING], ['driving', ZOOM_DRIVING]] as const) {
    it(`the Job Board label sits a full chip below the sign while ${mode}`, () => {
      const { dy } = screenDelta(office, jobAnchor(job.labelOffset ?? MARKER_LABEL_OFFSET), zoom)
      expect(dy).toBeGreaterThanOrEqual(CHIP_HEIGHT_PX)
    })
  }

  it('the label still floats in front of the kiosk, above the ground ring', () => {
    expect(job.labelOffset).toBeGreaterThan(1)
    expect(job.labelOffset).toBeLessThan(MARKER_LABEL_OFFSET)
  })
})
