import { describe, expect, it } from 'vitest'
import {
  CROSSING_ART,
  CROSSWALK_VISUAL_SPECS,
  getCrossingArt,
  getCrossingArtForSector,
  getCrossingArtSummary,
  validateCrossingArt,
} from './crossingArt'
import { INTERSECTIONS } from '../../traffic/intersections/intersectionRegistry'
import { WALK_CROSSINGS } from '../../traffic/walkCrossings'

describe('crossing art compile', () => {
  it('covers every registered crossing and validates clean', () => {
    const expected = INTERSECTIONS.reduce((n, x) => n + x.crossings.length, 0) + WALK_CROSSINGS.length
    expect(CROSSWALK_VISUAL_SPECS).toHaveLength(expected)
    expect(validateCrossingArt()).toEqual([])
  })

  it('is deterministic with stable ids', () => {
    const again = CROSSING_ART.map((a) => ({
      id: a.spec.crossingId,
      stripes: a.stripes.map((s) => s.id),
      pads: a.pads.map((p) => p.id),
      furniture: a.furniture.map((f) => f.id),
    }))
    // Recomputing summaries from the same compiled data returns identical
    // shapes (compile happens once at module load; ids embed no counters).
    for (const entry of again) {
      const art = getCrossingArt(entry.id)!
      expect(art.stripes.map((s) => s.id)).toEqual(entry.stripes)
      expect(entry.stripes.every((id) => id.startsWith(entry.id))).toBe(true)
    }
  })

  it('bars run perpendicular to pedestrian travel (elongated along vehicle travel)', () => {
    for (const art of CROSSING_ART) {
      for (const s of art.stripes) {
        if (s.id.includes('edge')) continue
        if (art.spec.axis === 'x') expect(s.d, s.id).toBeGreaterThan(s.w)
        else expect(s.w, s.id).toBeGreaterThan(s.d)
      }
    }
  })

  it('stripes stay inside their crossing bounds (validated) and off the curb step', () => {
    expect(validateCrossingArt().filter((e) => e.includes('leaves the crossing'))).toEqual([])
    for (const art of CROSSING_ART) {
      const paintSpan = art.spec.span - 2.4
      for (const s of art.stripes) {
        const alongSpan = art.spec.axis === 'x' ? Math.abs(s.x - art.spec.center[0]) : Math.abs(s.z - art.spec.center[1])
        expect(alongSpan, s.id).toBeLessThanOrEqual(paintSpan / 2 + 0.01)
      }
    }
  })

  it('signalized and unsignalized styles differ', () => {
    const signalized = getCrossingArt('s0_-2_harbor_cross_cross_south')!
    const painted = getCrossingArt('s-1_-2_yard_rd_gate_walk')!
    expect(signalized.stripes.length).toBeGreaterThan(painted.stripes.length)
    expect(signalized.stripes.some((s) => s.material === 'wornStripe')).toBe(true)
    expect(painted.stripes.some((s) => s.id.includes('edge'))).toBe(true)
    expect(signalized.stripes.some((s) => s.id.includes('edge'))).toBe(false)
  })

  it('tactile pads sit exactly on curb anchors, outside the roadway', () => {
    for (const art of CROSSING_ART) {
      const tactiles = art.pads.filter((p) => p.kind === 'tactile')
      expect(tactiles).toHaveLength(2)
      for (const [i, pad] of tactiles.entries()) {
        expect([pad.x, pad.z]).toEqual([...art.spec.curbAnchors[i]])
      }
    }
    expect(validateCrossingArt().filter((e) => e.includes('roadway'))).toEqual([])
  })

  it('posts avoid waiting anchors, the crossing zone, and the roadway', () => {
    const errors = validateCrossingArt()
    expect(errors.filter((e) => e.includes('post'))).toEqual([])
    for (const art of CROSSING_ART) {
      expect(art.furniture).toHaveLength(2)
    }
  })

  it('stop lines remain behind every crossing band', () => {
    expect(validateCrossingArt().filter((e) => e.includes('stop line'))).toEqual([])
  })

  it('signal heads only attach to signalized crossings and carry their intersection', () => {
    for (const art of CROSSING_ART) {
      for (const f of art.furniture) {
        if (art.spec.kind === 'signalized') {
          expect(f.kind, f.id).toBe('signalPost')
          expect(f.intersectionId, f.id).toBe('s0_-2_harbor_cross')
        } else {
          expect(f.kind, f.id).toBe('unsignaledPost')
          expect(f.intersectionId, f.id).toBeUndefined()
        }
      }
    }
  })

  it('source refs and sector ownership are complete and resolvable', () => {
    for (const spec of CROSSWALK_VISUAL_SPECS) {
      expect(spec.sourceRef.sourceId, spec.crossingId).toBeTruthy()
      expect(spec.sectorIds.length, spec.crossingId).toBeGreaterThan(0)
      for (const sectorId of spec.sectorIds) {
        expect(
          getCrossingArtForSector(sectorId).some((a) => a.spec.crossingId === spec.crossingId),
          `${spec.crossingId} in ${sectorId}`,
        ).toBe(true)
      }
    }
  })

  it('the debug summary reports counts and positions', () => {
    const summary = getCrossingArtSummary('s0_-2_harbor_cross_cross_north')!
    expect(summary.kind).toBe('signalized')
    expect(summary.stripeCount).toBe(9)
    expect(summary.padPositions).toHaveLength(4)
    expect(summary.furniture).toHaveLength(2)
    expect(getCrossingArtSummary('nope')).toBeNull()
  })
})
