import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginActivity,
  cancelActivity,
  getActiveActivity,
  getConfirmedPlans,
  getInvitations,
  getRelationship,
  ingestSocialEvent,
  reconcileMissedInvitations,
  resetSocial,
  sendPlayerInvite,
  stepActivity,
} from './socialRuntime'
import { activityFromInvitation, favorActivity } from './socialActivities'

/** Meet Ravi (friendly) + a player invite he accepts → one confirmed plan. */
function confirmedPlanWithRavi(day = 2) {
  ingestSocialEvent({ id: 'met:npc_ravi_01', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
  sendPlayerInvite('npc_ravi_01', day, 10)
  return getConfirmedPlans().find((i) => i.actorId === 'npc_ravi_01' && i.status === 'accepted')!
}

describe('social runtime — activity + invitation lifecycle (Slice 4 / PR#14)', () => {
  beforeEach(() => resetSocial())

  it('a hangout runs the linked invitation accepted → active → completed', () => {
    const inv = confirmedPlanWithRavi()
    const act = activityFromInvitation(inv.id, inv.actorId, inv.activityKind, 2)
    const before = getRelationship('npc_ravi_01')

    expect(beginActivity(act)).toBe(true)
    expect(getInvitations().find((i) => i.id === inv.id)!.status).toBe('active') // linked → active
    expect(beginActivity(act)).toBe(false) // one at a time

    expect(stepActivity(2, 12)?.step).toBe('together')
    expect(stepActivity(2, 12)).toBeNull() // together → done
    expect(getActiveActivity()).toBeNull()
    expect(getInvitations().find((i) => i.id === inv.id)!.status).toBe('completed') // linked → completed

    const after = getRelationship('npc_ravi_01')
    expect(after.affinity).toBeGreaterThan(before.affinity)
    expect(after.trust).toBeGreaterThan(before.trust)
  })

  it('a completed invitation can NOT be restarted', () => {
    const inv = confirmedPlanWithRavi()
    beginActivity(activityFromInvitation(inv.id, inv.actorId, inv.activityKind, 2))
    stepActivity(2, 12)
    stepActivity(2, 12) // completed
    // A fresh activity for the same (now completed) invitation is refused.
    expect(beginActivity(activityFromInvitation(inv.id, inv.actorId, inv.activityKind, 2))).toBe(false)
    expect(getActiveActivity()).toBeNull()
  })

  it('a favor completes into favor_completed (a bigger trust gain)', () => {
    beginActivity(favorActivity('npc_leo_01', 'snack', { id: 'apartment', label: 'x' }, 3, 0))
    const before = getRelationship('npc_leo_01').trust
    stepActivity(3, 10) // travel → deliver
    stepActivity(3, 10) // deliver → together
    expect(stepActivity(3, 10)).toBeNull() // together → done
    expect(getRelationship('npc_leo_01').trust).toBe(before + 15) // favor_completed delta
  })

  it('cancelling flips the linked invitation to cancelled (a no_show)', () => {
    const inv = confirmedPlanWithRavi()
    beginActivity(activityFromInvitation(inv.id, inv.actorId, inv.activityKind, 2))
    const before = getRelationship('npc_ravi_01').trust
    cancelActivity(2, 12)
    expect(getActiveActivity()).toBeNull()
    expect(getInvitations().find((i) => i.id === inv.id)!.status).toBe('cancelled')
    expect(getRelationship('npc_ravi_01').trust).toBeLessThan(before)
  })

  it('an accepted plan ignored past its window is reconciled to missed (no_show), once', () => {
    const inv = confirmedPlanWithRavi()
    const before = getRelationship('npc_ravi_01').trust
    // Jump well past the proposed slot without ever starting it.
    const missed = reconcileMissedInvitations(inv.proposedDay + 2, 12)
    expect(missed).toBe(1)
    expect(getInvitations().find((i) => i.id === inv.id)!.status).toBe('missed')
    expect(getRelationship('npc_ravi_01').trust).toBeLessThan(before)
    // Idempotent: a second reconcile finds nothing (already missed).
    expect(reconcileMissedInvitations(inv.proposedDay + 3, 12)).toBe(0)
  })
})
