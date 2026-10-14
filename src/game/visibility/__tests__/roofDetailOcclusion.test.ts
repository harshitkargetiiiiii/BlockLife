import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../../world/cityLayout'
import { BUILDING_ROOF_EXTRA } from '../../world/buildingMassing'
import { resolveFacadeStyle } from '../../world/surfaces/facadeDetails'
import { computeRoofDetails } from '../../world/surfaces/roofDetails'
import { getBuildingOccluderDescriptor } from '../occluderData'
import { countBlockedSamples, isMeaningfullyOccluded } from '../occlusionDetection'
import { CAMERA_OFFSET } from '../../camera/cameraGeometry'
import type { OccluderDescriptor, VisibilitySubject } from '../visibilityTypes'

/**
 * Hybrid dressing — can the detector MISS the rooftop plant?
 *
 * The plant renders inside the building's `Occludable`, so it fades once the building is
 * detected. That proves participation, not detection: `getBuildingOccluderDescriptor` caps a
 * procedural building at `size[1] + BUILDING_ROOF_EXTRA` (h + 0.5), while the tallest housing
 * reaches h + 1.3 and even the quiet shop profile reaches h + 1.0. A sight line could in principle
 * pass ABOVE the descriptor's roof and still be stopped by the housing — the player would sit
 * hidden behind real geometry with no fade, which is exactly the class of defect issue #46 §3
 * closed for projected bodies. Existing thin fittings (cornice, AC unit, water tank, antenna) were
 * deliberately left out of the descriptor, so the question is specific to the new bulky boxes.
 *
 * SCOPE OF THIS GATE, precisely: a finite sampled envelope — bearings every 5°, radial gaps every
 * 0.5 m from 0.5 m to 24 m beyond the footprint, one subject profile (the shipped player sample
 * heights and `minBlockedSamples`) and the camera at the fixed `CAMERA_OFFSET` bearing. It is NOT
 * a proof over every ray, bearing, subject or camera state; it is a dense check of the approaches
 * a player actually walks, at the two properties that matter:
 *
 *   1. per sample height — a roof box never blocks a height the building's own occluder leaves
 *      clear (counts matching is not the same as the SAME sample being covered), and
 *   2. at the fade threshold — whenever the roof boxes together hide enough samples to warrant a
 *      fade, the building is `isMeaningfullyOccluded`, so the parent fade actually fires.
 */

const DRESSED = BUILDINGS.filter((b) => {
  const style = resolveFacadeStyle(b)
  return style === 'industrial' || style === 'shop'
})

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

const SAMPLE_HEIGHTS = [0.4, 1.0, 1.7]
const MIN_BLOCKED = 2

function subjectAt(x: number, z: number, heights: number[] = SAMPLE_HEIGHTS): VisibilitySubject {
  return {
    id: 'player',
    kind: 'player',
    x,
    z,
    groundY: 0,
    radius: 0.36,
    sampleHeights: heights,
    minBlockedSamples: MIN_BLOCKED,
  }
}

const cameraFor = (s: VisibilitySubject) => ({
  x: s.x + CAMERA_OFFSET[0],
  y: CAMERA_OFFSET[1],
  z: s.z + CAMERA_OFFSET[2],
})

/** Does this occluder block this ONE sample height? Uses the shipped detector, one height at a time. */
const blocksHeight = (
  cam: ReturnType<typeof cameraFor>,
  s: VisibilitySubject,
  occ: OccluderDescriptor,
  h: number,
) => countBlockedSamples(cam, subjectAt(s.x, s.z, [h]), occ) > 0

describe('rooftop plant cannot hide a subject the building occluder misses', () => {
  it('dresses both styles, with boxes that really stand above the descriptor roof', () => {
    // If no box stood above the cap, or a style were missing, this gate would pass vacuously.
    const styles = new Set(DRESSED.map((b) => resolveFacadeStyle(b)))
    expect(styles.has('industrial'), 'industrial lots under test').toBe(true)
    expect(styles.has('shop'), 'shop lots under test').toBe(true)
    expect(DRESSED.length).toBeGreaterThanOrEqual(7)

    const above = new Map<string, number>()
    for (const def of DRESSED) {
      const descTop = getBuildingOccluderDescriptor(def).maxY
      for (const box of computeRoofDetails(def)) {
        const top = def.size[1] + BUILDING_ROOF_EXTRA - 0.05 + box.y + box.h
        if (top > descTop) above.set(resolveFacadeStyle(def), (above.get(resolveFacadeStyle(def)) ?? 0) + 1)
      }
    }
    expect(above.get('industrial') ?? 0, 'industrial boxes above the occluder roof').toBeGreaterThan(0)
    expect(above.get('shop') ?? 0, 'shop boxes above the occluder roof').toBeGreaterThan(0)
  })

  it('over the sampled envelope, every roof-blocked sample is one the building also blocks', () => {
    let sampled = 0
    let roofBlockedSamples = 0
    let fadeThresholdCases = 0
    for (const def of DRESSED) {
      const building = getBuildingOccluderDescriptor(def)
      const boxes = computeRoofDetails(def).map((b) => roofBoxDescriptor(def, b))
      if (boxes.length === 0) continue
      const [w, , d] = def.size
      for (let deg = 0; deg < 360; deg += 5) {
        const rad = (deg * Math.PI) / 180
        for (let gap = 0.5; gap <= 24; gap += 0.5) {
          const s = subjectAt(
            def.position[0] + Math.cos(rad) * (w / 2 + gap),
            def.position[1] + Math.sin(rad) * (d / 2 + gap),
          )
          const cam = cameraFor(s)
          sampled++
          // Union across the roof boxes, per sample height.
          const unionBlocked = new Set<number>()
          for (const h of SAMPLE_HEIGHTS) {
            const box = boxes.find((b) => blocksHeight(cam, s, b, h))
            if (!box) continue
            unionBlocked.add(h)
            roofBlockedSamples++
            // 1. The SAME sample must be covered by the building's own occluder.
            expect(
              blocksHeight(cam, s, building, h),
              `${box.id} hides the ${h}u sample at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) and the building occluder does not`,
            ).toBe(true)
          }
          // 2. If the plant alone hides enough of the subject to warrant a fade, the parent must
          //    actually be faded — participation is worthless if the parent never triggers.
          if (unionBlocked.size >= MIN_BLOCKED) {
            fadeThresholdCases++
            expect(
              isMeaningfullyOccluded(cam, s, building),
              `roof plant hides ${unionBlocked.size} samples at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) without the building fading`,
            ).toBe(true)
          }
        }
      }
    }
    expect(sampled, 'positions in the sampled envelope').toBeGreaterThan(5000)
    // The envelope must actually exercise the plant, at both strengths, or it proves nothing.
    expect(roofBlockedSamples, 'samples hidden by a roof box').toBeGreaterThan(0)
    expect(fadeThresholdCases, 'positions where the plant alone reaches the fade threshold').toBeGreaterThan(0)
  })
})
