import { describe, expect, it } from 'vitest'
import { PROP_PLACEMENT } from '../propPlacement'
import {
  type SolidRect,
  aabbOverlapDepth,
  circleAabbPenetration,
  detectDuplicateCitizens,
  propVisualWorldAabb,
  validateAnchorClearance,
  validateBaseContact,
  validateGroundContactParity,
  validatePropVisualClip,
  validateRouteCorridor,
} from './placementValidation'

const building = (id: string, minX: number, maxX: number, minZ: number, maxZ: number): SolidRect => ({
  id,
  minX,
  maxX,
  minZ,
  maxZ,
})

describe('geometry helpers', () => {
  it('circleAabbPenetration: outside → negative, inside → radius', () => {
    const b = building('b', -1, 1, -1, 1)
    expect(circleAabbPenetration(3, 0, 0.5, b)).toBeCloseTo(-1.5, 5) // 0.5 - 2
    expect(circleAabbPenetration(0, 0, 0.5, b)).toBe(0.5) // centre inside
    expect(circleAabbPenetration(1.3, 0, 0.5, b)).toBeCloseTo(0.2, 5) // grazes
  })

  it('aabbOverlapDepth: min penetration axis, 0 when separated', () => {
    expect(aabbOverlapDepth(building('a', 0, 2, 0, 2), building('b', 5, 6, 0, 2))).toBe(0)
    expect(aabbOverlapDepth(building('a', 0, 2, 0, 2), building('b', 1.5, 4, 0, 2))).toBeCloseTo(0.5, 5)
  })

  it('propVisualWorldAabb: rotating a long prop swaps its extents', () => {
    const spec = { visualHalf: [2, 0.5] as [number, number], vertical: [0, 1] as [number, number], support: 'ground' as const }
    const a = propVisualWorldAabb(0, 0, 0, spec)
    expect(a.maxX - a.minX).toBeCloseTo(4, 5)
    const r = propVisualWorldAabb(0, 0, Math.PI / 2, spec)
    expect(r.maxX - r.minX).toBeCloseTo(1, 5) // long axis now on Z
  })
})

describe('placement table sanity', () => {
  it('every prop type declares a placement spec, only porch_light is wall-mounted', () => {
    const wall = Object.entries(PROP_PLACEMENT).filter(([, s]) => s.support === 'wall').map(([t]) => t)
    expect(wall).toEqual(['porch_light'])
    // Every GROUND prop's base is at ~0 (the group renders on the ground).
    for (const s of Object.values(PROP_PLACEMENT)) {
      if (s.support === 'ground') expect(Math.abs(s.vertical[0])).toBeLessThanOrEqual(0.08)
    }
  })
})

// ---- the 7 required regression proofs -------------------------------------

describe('regression proof 1 — rooftop/lawn prop floating above its support', () => {
  it('flags a ground prop whose base is above the (raised) support surface', () => {
    const spec = PROP_PLACEMENT.bench // base 0, ground
    // A bench placed on a 3u-high rooftop but authored at ground → floats 3u below
    // the roof (its base is 3u under the support surface) → flagged.
    const f = validateBaseContact('roof_bench', spec, 3)
    expect(f?.kind).toBe('prop_floating')
    expect(f?.correction).toBeCloseTo(3, 5)
  })
  it('accepts a wall-mounted prop (porch_light) without a ground-contact failure', () => {
    expect(validateBaseContact('lamp', PROP_PLACEMENT.porch_light, 0)).toBeNull()
  })
})

describe('regression proof 2 — awning/slab clipping through a building facade', () => {
  it('flags a wide-canopy prop penetrating a building, tolerates mere adjacency', () => {
    const facade = building('shop', 0, 10, 0, 10)
    // Signboard visual half ~0.36; place it 0.2 INSIDE the facade → clips.
    const clipping = validatePropVisualClip({ id: 'awn_1', x: 9.9, z: 5, rotationY: 0, type: 'signboard' }, [facade])
    expect(clipping?.kind).toBe('prop_clipping')
    // …the same prop flush against the wall (touching) is fine.
    const flush = validatePropVisualClip({ id: 'awn_2', x: 10.35, z: 5, rotationY: 0, type: 'signboard' }, [facade])
    expect(flush).toBeNull()
  })
})

describe('regression proof 3 — citizen authored inside a wall or pole', () => {
  it('flags an idle anchor whose body intersects a solid', () => {
    const wall = building('bld_2', 0, 8, 0, 8)
    const f = validateAnchorClearance({ id: 'cit_x', x: 4, z: 4, radius: 0.36, kind: 'idle' }, [wall])
    expect(f?.kind).toBe('anchor_invalid')
    expect(f?.otherId).toBe('bld_2')
  })
})

describe('regression proof 4 — two citizens sharing equivalent start + route', () => {
  it('flags a near-duplicate start + waypoint sequence', () => {
    const dup = detectDuplicateCitizens([
      { id: 'cit_a', position: [10, 10], waypoints: [[12, 10], [12, 14]] },
      { id: 'cit_b', position: [10.1, 9.9], waypoints: [[12.05, 10], [11.95, 14.1]] },
      { id: 'cit_c', position: [40, 40], waypoints: [[42, 40]] }, // distinct
    ])
    expect(dup).toHaveLength(1)
    expect(dup[0].entityId).toBe('cit_a')
    expect(dup[0].otherId).toBe('cit_b')
  })
})

describe('regression proof 5 — crosswalk waiting point inside traffic furniture', () => {
  it('flags a crosswalk wait anchor intersecting a pole/box footprint', () => {
    const pole = building('lamp_pole', -0.2, 0.2, -0.2, 0.2) // a street-lamp pole
    const f = validateAnchorClearance({ id: 'xwalk_wait_n', x: 0, z: 0, radius: 0.36, kind: 'crosswalk_wait' }, [pole])
    expect(f?.kind).toBe('anchor_invalid')
    expect(f?.reason).toContain('crosswalk_wait')
  })
})

describe('regression proof 6 — doorway anchor too close to a building solid', () => {
  it('flags a door anchor whose clearance penetrates the facade', () => {
    const facade = building('office', 0, 20, 0, 20)
    // Door anchor 0.2u outside the facade but body radius 0.36 → penetrates 0.16.
    const f = validateAnchorClearance({ id: 'door_office', x: 20.2, z: 10, radius: 0.36, kind: 'doorway' }, [facade])
    expect(f?.kind).toBe('anchor_invalid')
    expect(f?.correction).toBeCloseTo(0.16, 2)
  })
})

describe('regression proof 7 — GLB and procedural fallback differ in ground contact', () => {
  it('flags a GLB whose base contact drifts from its fallback', () => {
    // GLB pivot leaves the mesh 0.3u above ground; fallback sits at 0 → drift.
    const f = validateGroundContactParity('prop_ac_unit_01', 0.3, 0)
    expect(f?.kind).toBe('prop_floating')
    expect(f?.correction).toBeCloseTo(0.3, 5)
    // A matching GLB (within tolerance) passes.
    expect(validateGroundContactParity('prop_bollard_01', 0.02, 0)).toBeNull()
  })
})

// ---- route corridor -------------------------------------------------------

describe('validateRouteCorridor', () => {
  it('flags a solid intruding into the swept path corridor, clears an open route', () => {
    const path: [number, number][] = [
      [0, 0],
      [20, 0],
    ]
    const blocker = building('planter', 9, 11, -0.5, 0.5) // straddles the path
    const blocked = validateRouteCorridor('route_1', path, 0.6, [blocker])
    expect(blocked).toHaveLength(1)
    expect(blocked[0].kind).toBe('route_corridor')
    const clear = validateRouteCorridor('route_2', path, 0.6, [building('far', 9, 11, 20, 22)])
    expect(clear).toHaveLength(0)
  })
})
