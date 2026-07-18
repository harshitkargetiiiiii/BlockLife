import type { Vec2 } from '../world/worldTypes'
import { lerpAngle } from '../utils/math'
import { createRng, hashString } from '../traffic/routing/routeRng'

/**
 * Routed store-civilian behaviour (Robbery Pursuit & Getaway Polish v1). This
 * REPLACES the old "sink into the floor" duck with real, deterministic reactions
 * that route a cashier and customers to authored exit / hide anchors, or freeze
 * them in place, by STABLE per-actor personality. It is pure and unit-testable:
 * positions are seeded and stepped with the real clamped delta; there is NO nav
 * graph — just capped, best-effort seek + an interior-aware avoid nudge (the same
 * philosophy as the crowd/panic movement, not a second nav stack). Recovery is
 * implicit: when the robbery ends the actors walk home and un-crouch.
 */

export type CivilianRole = 'cashier' | 'customer'
/** How an actor reacts to a threat — chosen once, stably, per actor identity. */
export type CivilianReaction = 'flee' | 'freeze' | 'hide'

export interface CivilianActor {
  id: string
  role: CivilianRole
  reaction: CivilianReaction
  /** Idle post the actor returns to after the robbery (authored). */
  home: Vec2
  /** Where this actor routes to when threatened (exit for flee, cover for hide). */
  safe: Vec2
  pos: Vec2
  heading: number
  /** 0..1 visual crouch/hands-up, eased in on freeze/arrival. */
  crouch: number
  /** Reached its safe/home target (movement settles — no jitter). */
  arrived: boolean
  /** Idempotent: this actor has already raised the alarm after reaching safety. */
  reported: boolean
}

/** Interior geometry the avoid + anchors derive from (never hand-typed twice). */
export interface InteriorLayout {
  origin: Vec2
  halfWidth: number
  halfDepth: number
  /** Register/counter centre (a solid the actors must not walk through). */
  register: Vec2
  /** Shelf rects (also LOS blockers) — solids + hide cover. */
  shelves: readonly { x: number; z: number; halfW: number; halfD: number }[]
}

/** Half-width of the south doorway gap actors escape through. */
const DOOR_HALF = 1.1
/** Actor body radius kept off solids + walls. */
const ACTOR_R = 0.36
const ARRIVE_EPS = 0.18
/** Customer walk speed (units/s); the panic multiplier is folded in already. */
export const CIVILIAN_WALK_SPEED = 3.2

/** The inside-threshold exit point actors flee toward (centre of the doorway). */
export function exitAnchor(layout: InteriorLayout): Vec2 {
  return [layout.origin[0], layout.origin[1] + layout.halfDepth - 0.7]
}

/** Candidate hide spots: behind each shelf (away from the door), else back
 *  corners. Always returns at least the two back corners so hide never fails. */
export function hideSpots(layout: InteriorLayout): Vec2[] {
  const [ox, oz] = layout.origin
  const spots: Vec2[] = layout.shelves.map((s) => [s.x, s.z - (s.halfD + 0.7)] as Vec2)
  spots.push([ox - layout.halfWidth + 0.9, oz - layout.halfDepth + 0.9])
  spots.push([ox + layout.halfWidth - 0.9, oz - layout.halfDepth + 0.9])
  return spots
}

/** Deterministic customer homes (matches the authored idle posts, one source). */
export function customerHomes(layout: InteriorLayout): Vec2[] {
  const [ox, oz] = layout.origin
  return [
    [ox + layout.halfWidth - 1.6, oz + 1.2],
    [ox - layout.halfWidth + 1.4, oz + 0.4],
  ]
}

/**
 * Stable per-identity reaction for a customer. The first customer (index 0)
 * always bolts for the door — someone reliably flees, so every store (even the
 * no-fixed-alarm kiosk) has a witness who reports after reaching safety. The
 * rest are seeded (never Math.random) for a readable mix of hide / freeze.
 */
export function customerReaction(actorId: string, index: number): CivilianReaction {
  if (index === 0) return 'flee'
  const r = createRng(hashString(`civilian:${actorId}`))()
  return r < 0.5 ? 'hide' : 'freeze'
}

/**
 * Best-effort interior avoid: push a point out of the counter + shelf rects and
 * keep it off the perimeter walls, while leaving the south doorway gap open so a
 * fleeing actor can actually get out. Capped and side-effect free — no pathing.
 */
export function avoidInterior(layout: InteriorLayout, p: Vec2): Vec2 {
  let [x, z] = p
  // Push out of solid rects (counter + shelves), inflated by the body radius.
  const rects = [
    { x: layout.register[0], z: layout.register[1], halfW: 1.3, halfD: 0.55 },
    ...layout.shelves.map((s) => ({ x: s.x, z: s.z, halfW: s.halfW, halfD: s.halfD })),
  ]
  for (const r of rects) {
    const dx = x - r.x
    const dz = z - r.z
    const ox = r.halfW + ACTOR_R - Math.abs(dx)
    const oz = r.halfD + ACTOR_R - Math.abs(dz)
    if (ox > 0 && oz > 0) {
      // Inside: eject along the shallower axis (smallest push).
      if (ox < oz) x += dx >= 0 ? ox : -ox
      else z += dz >= 0 ? oz : -oz
    }
  }
  // Perimeter walls (leave the south doorway gap open).
  const [cx, cz] = layout.origin
  const minX = cx - layout.halfWidth + ACTOR_R
  const maxX = cx + layout.halfWidth - ACTOR_R
  const minZ = cz - layout.halfDepth + ACTOR_R
  const maxZ = cz + layout.halfDepth - ACTOR_R
  if (x < minX) x = minX
  if (x > maxX) x = maxX
  if (z < minZ) z = minZ
  if (z > maxZ) {
    // Only allow crossing the south wall through the doorway gap.
    if (Math.abs(x - cx) < DOOR_HALF) {
      // Let them keep going a little past the threshold, then stop just outside.
      if (z > cz + layout.halfDepth + 1.4) z = cz + layout.halfDepth + 1.4
    } else {
      z = maxZ
    }
  }
  return [x, z]
}

/** Fan of steer offsets (radians) tried each step so an actor SLIDES around a
 *  convex obstacle instead of stalling against it (escapes local minima — this
 *  is local steering, not a nav graph). */
const STEER_FAN = [0, 0.7, -0.7, 1.4, -1.4]

/**
 * Step one actor toward `target`, avoiding interior solids. Tries a small fan of
 * headings and keeps the avoided candidate that makes the most progress toward
 * the target, so a low counter or shelf is rounded rather than deadlocked on.
 */
function seek(
  actor: CivilianActor,
  target: Vec2,
  layout: InteriorLayout,
  speed: number,
  dt: number,
): boolean {
  const dx = target[0] - actor.pos[0]
  const dz = target[1] - actor.pos[1]
  const dist = Math.hypot(dx, dz)
  if (dist <= ARRIVE_EPS) {
    actor.pos = target
    return true
  }
  const base = Math.atan2(dx, dz)
  const step = Math.min(dist, speed * Math.min(dt, 0.1))
  let best: Vec2 = actor.pos
  let bestProgress = -Infinity
  for (const off of STEER_FAN) {
    const ang = base + off
    const cand = avoidInterior(layout, [
      actor.pos[0] + Math.sin(ang) * step,
      actor.pos[1] + Math.cos(ang) * step,
    ])
    // Progress = how much closer this candidate gets us to the target.
    const progress = dist - Math.hypot(target[0] - cand[0], target[1] - cand[1])
    if (progress > bestProgress) {
      bestProgress = progress
      best = cand
    }
  }
  actor.pos = best
  actor.heading = lerpAngle(actor.heading, base, dt * 10)
  return Math.hypot(target[0] - best[0], target[1] - best[1]) <= ARRIVE_EPS
}

export interface CivilianStepContext {
  /** A robbery is active in THIS store (drives flee/hide/freeze vs recover). */
  threatActive: boolean
  /** Threat (player) position, for facing on freeze. */
  threat: Vec2
  layout: InteriorLayout
  dt: number
}

/**
 * Advance one civilian. When threatened: flee → exit, hide → cover, freeze →
 * hold + face away, easing in a crouch. When safe: walk home + un-crouch. Sets
 * `reported` true the first time a flee/hide actor reaches safety (idempotent),
 * so the caller can raise a single witness alarm. Deterministic in (actor, ctx).
 */
export function stepCivilian(actor: CivilianActor, ctx: CivilianStepContext): void {
  const { layout, dt } = ctx
  if (!ctx.threatActive) {
    // Recover: stroll home, stand up, and re-arm reporting for a future robbery.
    actor.arrived = seek(actor, actor.home, layout, CIVILIAN_WALK_SPEED * 0.6, dt)
    actor.crouch = Math.max(0, actor.crouch - dt * 2)
    actor.reported = false
    return
  }
  switch (actor.reaction) {
    case 'flee': {
      actor.arrived = seek(actor, actor.safe, layout, CIVILIAN_WALK_SPEED, dt)
      break
    }
    case 'hide': {
      actor.arrived = seek(actor, actor.safe, layout, CIVILIAN_WALK_SPEED, dt)
      if (actor.arrived) actor.crouch = Math.min(1, actor.crouch + dt * 3)
      break
    }
    case 'freeze': {
      // Hold position, hands up, turned away from the threat.
      actor.arrived = true
      actor.crouch = Math.min(1, actor.crouch + dt * 3)
      const away = Math.atan2(actor.pos[0] - ctx.threat[0], actor.pos[1] - ctx.threat[1])
      actor.heading = lerpAngle(actor.heading, away, dt * 8)
      break
    }
  }
  // Report once, only after actually reaching safety (flee out / hide in cover).
  if (!actor.reported && actor.arrived && actor.reaction !== 'freeze') {
    actor.reported = true
  }
}
