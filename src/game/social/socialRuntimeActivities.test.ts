import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginActivity,
  cancelActivity,
  getActiveActivity,
  getRelationship,
  resetSocial,
  stepActivity,
} from './socialRuntime'
import { activityFromInvitation, favorActivity } from './socialActivities'

describe('social runtime — activity lifecycle (Slice 4)', () => {
  beforeEach(() => resetSocial())

  it('a hangout completes into activity_completed (affinity + trust up)', () => {
    const act = activityFromInvitation('inv1', 'npc_ravi_01', 'coffee', 2)
    expect(beginActivity(act)).toBe(true)
    expect(beginActivity(act)).toBe(false) // only one at a time
    const before = getRelationship('npc_ravi_01')

    expect(stepActivity(2, 12)?.step).toBe('together')
    expect(stepActivity(2, 12)).toBeNull() // together → done → completed + cleared
    expect(getActiveActivity()).toBeNull()

    const after = getRelationship('npc_ravi_01')
    expect(after.affinity).toBeGreaterThan(before.affinity)
    expect(after.trust).toBeGreaterThan(before.trust)
  })

  it('a favor completes into favor_completed (a bigger trust gain)', () => {
    beginActivity(favorActivity('npc_leo_01', 'snack', { id: 'apartment', label: 'x' }, 3, 0))
    const before = getRelationship('npc_leo_01').trust
    stepActivity(3, 10) // travel → deliver
    stepActivity(3, 10) // deliver → together
    expect(stepActivity(3, 10)).toBeNull() // together → done
    expect(getRelationship('npc_leo_01').trust).toBe(before + 15) // favor_completed delta
  })

  it('cancelling is a mild let-down (no_show)', () => {
    beginActivity(activityFromInvitation('inv2', 'npc_maya_01', 'food', 1))
    const before = getRelationship('npc_maya_01').trust
    cancelActivity(1, 12)
    expect(getActiveActivity()).toBeNull()
    expect(getRelationship('npc_maya_01').trust).toBeLessThan(before)
  })
})
