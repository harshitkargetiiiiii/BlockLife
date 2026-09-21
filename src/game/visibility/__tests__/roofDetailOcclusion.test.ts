import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../../world/cityLayout'
import { BUILDING_ROOF_EXTRA } from '../../world/buildingMassing'
import { resolveFacadeStyle } from '../../world/surfaces/facadeDetails'
import { computeRoofDetails } from '../../world/surfaces/roofDetails'
import { getBuildingOccluderDescriptor } from '../occluderData'
import { countBlockedSamples } from '../occlusionDetection'
import { CAMERA_OFFSET } from '../../camera/cameraGeometry'
import type { OccluderDescriptor, VisibilitySubject } from '../visibilityTypes'

/**
 * Hybrid dressing v1 — can the detector MISS the rooftop plant?
 *
 * The plant renders inside the building's `Occludable`, so it fades once the building is
 * detected. That proves participation, not detection: `getBuildingOccluderDescriptor` caps a
 * procedural building at `size[1] + BUILDING_ROOF_EXTRA` (h + 0.5), while the tallest housing
 * reaches h + 0.45 + 0.85 = h + 1.3. A sight line could in principle pass ABOVE the descriptor's
 * roof and still be stopped by the housing — the player would sit hidden behind real geometry
 * with no fade, which is exactly the class of defect issue #46 §3 closed for projected bodies.
 *
 * Existing thin fittings (the cornice, the generic AC unit, the water tank, the antenna) were
 * deliberately left out of the descriptor, so the question is specific to the new BULKY boxes.
 * Rather than argue from one screenshot, this sweeps subject positions all around each industrial
 * lot and asserts the property that matters: whenever a roof box blocks a sample, the building's
 * own descriptor blocks at least as many. Geometry, not assumption.
 */

const INDUSTRIAL = BUILDINGS.filter((b) => resolveFacadeStyle(b) === 'industrial')

/** A roof box as its own occluder, in world space, sitting on the slab. */
function roofBoxDescriptor(
  def: (typeof BUILDINGS)[number],
  box: ReturnType<typeof computeRoofDetails>[number],
): OccluderDescriptor {
  const base = getBuildingOccluderDescriptor(def)
  const slabTop = def.size[1] + BUILDING_ROOF_EXTRA - 0.05
  return {
    ...base,
    id: `${def.id}:roof`,
    bounds2D: {
      minX: def.position[0] + box.x - box.w / 2,
      maxX: def.position[0] + box.x + box.w / 2,
      minZ: def.position[1] + box.z - box.d / 2,
      maxZ: def.position[1] + box.z + box.d / 2,
    },
    minY: slabTop + box.y,
    maxY: slabTop + box.y + box.h,
  }
}

function subjectAt(x: number, z: number): VisibilitySubject {
  return {
    id: 'player',
    kind: 'player',
    x,
    z,
    groundY: 0,
    radius: 0.36,
    sampleHeights: [0.4, 1.0, 1.7],
    minBlockedSamples: 2,
  }
}

const cameraFor = (s: VisibilitySubject) => ({
  x: s.x + CAMERA_OFFSET[0],
  y: CAMERA_OFFSET[1],
  z: s.z + CAMERA_OFFSET[2],
})

describe('rooftop plant cannot hide a subject the building occluder misses', () => {
  it('has bulky boxes that really do stand above the descriptor roof', () => {
    // If they did not, this gate would pass vacuously.
    expect(INDUSTRIAL.length).toBeGreaterThanOrEqual(4)
    let above = 0
    for (const def of INDUSTRIAL) {
      const descTop = getBuildingOccluderDescriptor(def).maxY
      for (const box of computeRoofDetails(def)) {
        const top = def.size[1] + BUILDING_ROOF_EXTRA - 0.05 + box.y + box.h
        if (top > descTop) above++
      }
    }
    expect(above, 'roof boxes standing above the occluder roof').toBeGreaterThan(0)
  })

  it('sweeping every approach, no roof box ever blocks more than its building does', () => {
    let sampled = 0
    let roofBlocking = 0
    for (const def of INDUSTRIAL) {
      const building = getBuildingOccluderDescriptor(def)
      const boxes = computeRoofDetails(def).map((b) => roofBoxDescriptor(def, b))
      const [w, , d] = def.size
      // Ring the lot: every bearing, from hard against the wall out to well beyond it.
      for (let deg = 0; deg < 360; deg += 5) {
        const rad = (deg * Math.PI) / 180
        for (let gap = 0.5; gap <= 24; gap += 0.5) {
          const s = subjectAt(
            def.position[0] + Math.cos(rad) * (w / 2 + gap),
            def.position[1] + Math.sin(rad) * (d / 2 + gap),
          )
          const cam = cameraFor(s)
          const byBuilding = countBlockedSamples(cam, s, building)
          sampled++
          for (const box of boxes) {
            const byBox = countBlockedSamples(cam, s, box)
            if (byBox > 0) roofBlocking++
            expect(
              byBuilding,
              `${box.id} hides ${byBox} sample(s) at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) that the building occluder misses`,
            ).toBeGreaterThanOrEqual(byBox)
          }
        }
      }
    }
    expect(sampled, 'positions swept').toBeGreaterThan(5000)
    // The sweep must actually exercise the roof boxes, or it proves nothing.
    expect(roofBlocking, 'positions where a roof box blocks a sample').toBeGreaterThan(0)
  })
})
