import { describe, it, expect } from 'vitest'
import { AMBIENT_CITIZENS, type AmbientCitizen } from './ambientCitizenData'
import { INTERSECTIONS } from '../traffic/intersections/intersectionRegistry'
import { findLoopWalkClearanceViolations, distSegBox, segIntersectsAabb, type Aabb } from './citizenPathClearance'

/**
 * Segment/AABB geometry — the junction-box clearance depends on a correct
 * segment-to-box distance. The earlier version only tested endpoints-inside and
 * therefore missed a segment that crosses straight THROUGH the box with both
 * endpoints outside; cases 1–3 below fail on that version and pass on the
 * slab-clipping one.
 */
describe('segment/AABB geometry (issue #31 validator)', () => {
  const box: Aabb = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }
  it('1. horizontal segment crossing the box, both endpoints outside → 0', () => {
    expect(segIntersectsAabb([-5, 5], [15, 5], box)).toBe(true)
    expect(distSegBox([-5, 5], [15, 5], box)).toBe(0)
  })
  it('2. vertical segment crossing the box, both endpoints outside → 0', () => {
    expect(distSegBox([5, -5], [5, 15], box)).toBe(0)
  })
  it('3. diagonal segment crossing the box → 0', () => {
    expect(distSegBox([-5, -5], [15, 15], box)).toBe(0)
  })
  it('4. tangent to an edge and to a corner → 0', () => {
    expect(distSegBox([-5, 0], [15, 0], box)).toBe(0) // runs along the bottom edge
    expect(distSegBox([12, 8], [8, 12], box)).toBe(0) // passes through corner (10,10)
  })
  it('5. outside but within JUNCTION_MARGIN → 0 < d < 2', () => {
    const d = distSegBox([11, 5], [13, 5], box) // 1.0 right of the x=10 edge
    expect(d).toBeGreaterThan(0)
    expect(d).toBeCloseTo(1, 5)
    expect(d).toBeLessThan(2)
  })
  it('6. outside and safely beyond JUNCTION_MARGIN → d ≥ 2', () => {
    expect(distSegBox([15, 5], [17, 5], box)).toBeCloseTo(5, 5)
    expect(segIntersectsAabb([15, 5], [17, 5], box)).toBe(false)
  })
  it('7. zero-length segment inside → 0', () => {
    expect(distSegBox([5, 5], [5, 5], box)).toBe(0)
  })
  it('8. zero-length segment outside → true point distance', () => {
    expect(distSegBox([15, 5], [15, 5], box)).toBeCloseTo(5, 5)
    expect(distSegBox([13, 5], [13, 5], box)).toBeCloseTo(3, 5)
  })
  it('near-but-outside diagonal that does NOT enter the box stays > 0', () => {
    // corner-skimming line just outside the (10,10) corner
    expect(segIntersectsAabb([11, 12], [12, 11], box)).toBe(false)
    expect(distSegBox([11, 12], [12, 11], box)).toBeGreaterThan(0)
  })
})

/**
 * Issue #31 — loop-walk citizens must clear stationary dwell points and
 * signalized-crossing wait spots, or they sweep back over a stationary citizen
 * every lap (the sustained person_person_overlap the 300s integrity soak caught
 * around Harbor Cross). General invariant, not a five-id patch.
 */
describe('citizen path clearance (issue #31)', () => {
  it('the authored city has ZERO loop-walk clearance violations', () => {
    const v = findLoopWalkClearanceViolations()
    expect(v, v.map((x) => `${x.citizenId} ${x.kind}: ${x.detail}`).join('\n')).toEqual([])
  })

  it('FAILS on the pre-fix Harbor Cross loops (regression guard — the validator really bites)', () => {
    // The exact authoring that produced the soak overlaps: both commuters circling
    // the Harbor Cross intersection ring, sharing the shuttles' dwell edges.
    const preFix: AmbientCitizen[] = AMBIENT_CITIZENS.map((c) => {
      if (c.id === 'cit_hc_loop_cw')
        return { ...c, position: [41, -152.9] as const, waypoints: [[41, -152.9], [55, -152.9], [55, -167.1], [41, -167.1]] as [number, number][] }
      if (c.id === 'cit_hc_loop_ccw')
        return { ...c, position: [54.1, -166.2] as const, waypoints: [[54.1, -166.2], [54.1, -153.8], [41.9, -153.8], [41.9, -166.2]] as [number, number][] }
      return c
    })
    const v = findLoopWalkClearanceViolations(preFix, INTERSECTIONS)
    const bad = new Set(v.map((x) => x.citizenId))
    expect(bad.has('cit_hc_loop_cw'), 'cw loop must be flagged pre-fix').toBe(true)
    expect(bad.has('cit_hc_loop_ccw'), 'ccw loop must be flagged pre-fix').toBe(true)
    // and it must specifically catch the intersection ring / crossing waits, not just any dwell
    expect(v.some((x) => x.kind === 'crossing_wait' || x.kind === 'junction_box')).toBe(true)
  })

  it('the corrected Harbor Cross commuters keep their role: two loop_walk pacers in the gateway, on parallel lanes', () => {
    const cw = AMBIENT_CITIZENS.find((c) => c.id === 'cit_hc_loop_cw')!
    const ccw = AMBIENT_CITIZENS.find((c) => c.id === 'cit_hc_loop_ccw')!
    for (const c of [cw, ccw]) {
      expect(c.behaviorType, `${c.id} stays a pacer`).toBe('loop_walk')
      expect(c.district).toBe('downtown_gateway')
      expect(c.archetype).toBe('Harbor Commuter')
      expect((c.waypoints ?? []).length, `${c.id} still walks a path`).toBeGreaterThanOrEqual(2)
    }
    // Two lanes, opposite travel, spaced > the 0.72 person-separation radius so they never lock step.
    const lanes = Math.abs(cw.waypoints![0][1] - ccw.waypoints![0][1])
    expect(lanes).toBeGreaterThan(0.9)
    expect(findLoopWalkClearanceViolations().filter((x) => x.citizenId.startsWith('cit_hc_loop'))).toEqual([])
  })
})
