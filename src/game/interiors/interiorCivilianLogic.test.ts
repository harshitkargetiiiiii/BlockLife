import { describe, expect, it } from 'vitest'
import {
  avoidInterior,
  customerReaction,
  exitAnchor,
  hideSpots,
  stepCivilian,
  type CivilianActor,
  type InteriorLayout,
} from './interiorCivilianLogic'

// A convenience-store-shaped layout: 10×9 room with a shelf aisle + counter.
const LAYOUT: InteriorLayout = {
  origin: [260, 205],
  halfWidth: 5,
  halfDepth: 4.5,
  register: [258.6, 203],
  shelves: [{ x: 261.2, z: 203.5, halfW: 0.5, halfD: 1.6 }],
}

function actor(over: Partial<CivilianActor> = {}): CivilianActor {
  return {
    id: 'store:cust0',
    role: 'customer',
    reaction: 'flee',
    home: [263, 206],
    safe: exitAnchor(LAYOUT),
    pos: [263, 206],
    heading: Math.PI,
    crouch: 0,
    arrived: false,
    reported: false,
    ...over,
  }
}

/** Drive an actor for `seconds` of threat at a fixed dt, from a fixed threat. */
function run(a: CivilianActor, seconds: number, threatActive = true, threat: [number, number] = [260, 209]) {
  const dt = 1 / 30
  for (let t = 0; t < seconds; t += dt) {
    stepCivilian(a, { threatActive, threat, layout: LAYOUT, dt })
  }
}

/** Inside a solid rect (counter/shelf), inflated by the body radius? */
function insideSolid(x: number, z: number): boolean {
  const rects = [
    { x: 258.6, z: 203, halfW: 1.3, halfD: 0.55 },
    { x: 261.2, z: 203.5, halfW: 0.5, halfD: 1.6 },
  ]
  return rects.some((r) => Math.abs(x - r.x) < r.halfW + 0.3 && Math.abs(z - r.z) < r.halfD + 0.3)
}

describe('customerReaction', () => {
  it('is deterministic for a given id + index', () => {
    expect(customerReaction('a', 1)).toBe(customerReaction('a', 1))
  })
  it('always makes the first customer bolt (a guaranteed witness)', () => {
    for (let i = 0; i < 20; i++) expect(customerReaction(`store${i}:cust0`, 0)).toBe('flee')
  })
  it('seeds the remaining customers across hide/freeze', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) seen.add(customerReaction(`store:cust${i}`, 1))
    expect(seen).toEqual(new Set(['hide', 'freeze']))
  })
})

describe('anchors', () => {
  it('exit is centred in the south doorway, just inside', () => {
    const [ex, ez] = exitAnchor(LAYOUT)
    expect(ex).toBe(260)
    expect(ez).toBeCloseTo(205 + 4.5 - 0.7, 5)
  })
  it('hide spots always include the two back corners', () => {
    const spots = hideSpots(LAYOUT)
    expect(spots.length).toBeGreaterThanOrEqual(3) // one shelf + two corners
    // All hide spots are in the back half (north of centre).
    for (const [, z] of spots) expect(z).toBeLessThan(205)
  })
})

describe('avoidInterior', () => {
  it('ejects a point out of the counter rect', () => {
    const [x, z] = avoidInterior(LAYOUT, [258.6, 203])
    expect(insideSolid(x, z)).toBe(false)
  })
  it('keeps a point off the side/north walls', () => {
    expect(avoidInterior(LAYOUT, [999, 205])[0]).toBeLessThanOrEqual(265)
    expect(avoidInterior(LAYOUT, [260, -999])[1]).toBeGreaterThanOrEqual(200.5)
  })
  it('leaves the south doorway open but blocks the rest of the south wall', () => {
    // Through the gap (x≈origin): allowed past the wall.
    expect(avoidInterior(LAYOUT, [260, 214])[1]).toBeGreaterThan(209.5)
    // Off to the side: clamped back inside.
    expect(avoidInterior(LAYOUT, [264, 214])[1]).toBeLessThanOrEqual(209.5)
  })
})

describe('stepCivilian', () => {
  it('flee routes to the exit and marks reported once there', () => {
    const a = actor({ reaction: 'flee' })
    run(a, 6)
    const [ex, ez] = exitAnchor(LAYOUT)
    // Reached (or passed through) the doorway and reported after safety.
    expect(Math.hypot(a.pos[0] - ex, a.pos[1] - ez)).toBeLessThan(3)
    expect(a.reported).toBe(true)
  })

  it('hide routes to cover, crouches, and reports after safety', () => {
    const a = actor({ reaction: 'hide', safe: hideSpots(LAYOUT)[1] })
    run(a, 6)
    expect(a.arrived).toBe(true)
    expect(a.crouch).toBeGreaterThan(0.5)
    expect(a.reported).toBe(true)
  })

  it('freeze holds position, crouches, faces away, and never reports', () => {
    const a = actor({ reaction: 'freeze', pos: [263, 206], home: [263, 206] })
    run(a, 3)
    expect(a.pos[0]).toBeCloseTo(263, 5)
    expect(a.pos[1]).toBeCloseTo(206, 5)
    expect(a.crouch).toBeGreaterThan(0.5)
    expect(a.reported).toBe(false)
  })

  it('recovers home and stands up once the threat is over', () => {
    const a = actor({ reaction: 'flee' })
    run(a, 6) // flee out + report
    expect(a.reported).toBe(true)
    run(a, 8, false) // threat over → recover
    expect(Math.hypot(a.pos[0] - a.home[0], a.pos[1] - a.home[1])).toBeLessThan(0.5)
    expect(a.crouch).toBeLessThan(0.05)
    expect(a.reported).toBe(false) // re-armed for a future robbery
  })

  it('never comes to rest inside a solid (no phasing through counter/shelves)', () => {
    for (const reaction of ['flee', 'hide', 'freeze'] as const) {
      const a = actor({ reaction, pos: [259, 204], home: [259, 204], safe: reaction === 'flee' ? exitAnchor(LAYOUT) : hideSpots(LAYOUT)[0] })
      run(a, 8)
      expect(insideSolid(a.pos[0], a.pos[1])).toBe(false)
    }
  })
})
