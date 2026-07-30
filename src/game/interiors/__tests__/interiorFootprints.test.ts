import { describe, expect, it } from 'vitest'
import { INTERIORS } from '../interiorRegistry'

/**
 * Every interior diorama (studio / loft / premium / the two stores) is ALWAYS mounted
 * at a fixed far-off-grid origin — the follow camera reveals whichever one the player
 * stands in. If two footprints overlap, one interior bleeds into the other's camera
 * view (this actually happened: the City Loft was authored at [200,262] on top of the
 * Waterfront kiosk [205,265], so the kiosk shot showed the loft's floor + a "Leave Home"
 * prompt). Guard it: no two interiors may share space, with a margin for the walls the
 * camera frames just past each room. See CONVENTIONS gotcha on interior placement.
 */
describe('interior footprints', () => {
  it('no two always-mounted interiors overlap (with wall/camera clearance)', () => {
    const MARGIN = 2
    const conflicts: string[] = []
    for (let a = 0; a < INTERIORS.length; a++) {
      for (let b = a + 1; b < INTERIORS.length; b++) {
        const A = INTERIORS[a]
        const B = INTERIORS[b]
        const dx = Math.abs(A.origin[0] - B.origin[0])
        const dz = Math.abs(A.origin[1] - B.origin[1])
        const needX = A.size.width / 2 + B.size.width / 2 + MARGIN
        const needZ = A.size.depth / 2 + B.size.depth / 2 + MARGIN
        // AABB overlap needs BOTH axes to be closer than the summed half-extents.
        if (dx < needX && dz < needZ) {
          conflicts.push(`${A.id} <-> ${B.id} overlap (dx=${dx} < ${needX}, dz=${dz} < ${needZ})`)
        }
      }
    }
    expect(conflicts).toEqual([])
  })
})
