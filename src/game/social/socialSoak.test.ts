import { beforeEach, describe, expect, it } from 'vitest'
import {
  APPLIED_EVENT_ID_MAX,
  INVITATIONS_MAX,
  MEMORY_MAX_PER_NPC,
  MESSAGES_MAX_PER_CONTACT,
  REL_BOUNDS,
} from './socialTypes'
import { allSocialActorIds } from './socialActors'
import {
  beginActivity,
  getInvitations,
  getMemories,
  getMessages,
  getRelationship,
  ingestSocialEvent,
  reconcileOutreach,
  resetSocial,
  respondToInvitation,
  sendPlayerInvite,
  socialRuntime,
  socialSnapshot,
  stepActivity,
} from './socialRuntime'
import { noteCrimeWitnessed } from './socialConsequences'
import { registry } from '../world/runtimeRegistry'
import * as THREE from 'three'
import type { SocialEventKind } from './socialEvents'

/**
 * Bounded social lifecycle soak (issue #13 §soak). A deterministic, in-memory
 * run over many game-days exercising the WHOLE cast through the whole platform —
 * meetings, talks, check-ins, gifts, favours, invitations, NPC outreach,
 * activities, and witnessed crimes — while asserting every hard bound holds
 * throughout and nothing grows without limit. No randomness; reproducible.
 */
const CAST = allSocialActorIds()
const CYCLE: SocialEventKind[] = ['conversation', 'gift_liked', 'gift_neutral', 'check_in', 'crime_witnessed', 'favor_completed']

function assertInvariants(day: number) {
  for (const id of CAST) {
    const rel = getRelationship(id)
    for (const dim of ['familiarity', 'affinity', 'trust', 'fear'] as const) {
      expect(Number.isInteger(rel[dim]), `${id}.${dim} integer on day ${day}`).toBe(true)
      expect(rel[dim]).toBeGreaterThanOrEqual(REL_BOUNDS[dim].min)
      expect(rel[dim]).toBeLessThanOrEqual(REL_BOUNDS[dim].max)
    }
    expect(getMemories(id).length, `${id} memory bound`).toBeLessThanOrEqual(MEMORY_MAX_PER_NPC)
    expect(getMessages(id).length, `${id} message bound`).toBeLessThanOrEqual(MESSAGES_MAX_PER_CONTACT)
  }
  expect(getInvitations().length).toBeLessThanOrEqual(INVITATIONS_MAX)
  expect(socialRuntime.state.appliedEventIds.length).toBeLessThanOrEqual(APPLIED_EVENT_ID_MAX)
}

describe('social platform — bounded lifecycle soak', () => {
  beforeEach(() => {
    resetSocial()
    registry.npcPositions.clear()
    for (const id of CAST) registry.npcPositions.set(id, new THREE.Vector3(0, 0, 0))
  })

  it('holds every bound + covers the whole cast over 200 game-days', () => {
    // Everyone meets the player up front (so they are real contacts).
    for (const id of CAST) ingestSocialEvent({ id: `met:${id}`, kind: 'met', actorId: id, gameDay: 1, gameHour: 9 })

    let evSeq = 0
    for (let day = 1; day <= 200; day++) {
      for (let ci = 0; ci < CAST.length; ci++) {
        const id = CAST[ci]
        const kind = CYCLE[(day + ci) % CYCLE.length]
        if (kind === 'crime_witnessed') {
          noteCrimeWitnessed(`crime:${day}:${ci}`, [0, 0, 0], day, 12)
        } else {
          ingestSocialEvent({ id: `soak:${kind}:${id}:${day}:${evSeq++}`, kind, actorId: id, gameDay: day, gameHour: (day + ci) % 24 })
        }
      }
      // Phone: NPCs reach out; the player answers whatever is pending.
      reconcileOutreach(day, 10)
      for (const inv of getInvitations().filter((i) => i.status === 'pending')) {
        respondToInvitation(inv.id, day % 3 === 0 ? 'declined' : 'accepted', day, 11)
      }
      // Occasionally the player asks someone out + runs the hangout to completion.
      if (day % 5 === 0) {
        const target = CAST[day % CAST.length]
        sendPlayerInvite(target, day, 10)
      }
      if (day % 7 === 0) {
        beginActivity({ id: `soakact:${day}`, actorId: CAST[day % CAST.length], template: 'hangout', activityKind: 'coffee', venueId: 'food_truck_01', venueLabel: 'v', step: 'travel', startedDay: day })
        stepActivity(day, 12)
        stepActivity(day, 12) // together → done
      }
      if (day % 25 === 0) assertInvariants(day)
    }

    assertInvariants(200)
    // Cast coverage: every named actor ended as a known contact with memories.
    const snap = socialSnapshot()
    expect(snap.contactCount).toBe(CAST.length)
    for (const id of CAST) expect(getMemories(id).length).toBeGreaterThan(0)
    // Bounded totals, not unbounded growth.
    expect(snap.totalMemories).toBeLessThanOrEqual(MEMORY_MAX_PER_NPC * CAST.length)
    expect(snap.totalMessages).toBeLessThanOrEqual(MESSAGES_MAX_PER_CONTACT * CAST.length)
  })
})
