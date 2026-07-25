import { describe, expect, it } from 'vitest'
import {
  activityFromInvitation,
  activityPrompt,
  advanceActivity,
  favorActivity,
  isComplete,
  nextStep,
  templateSteps,
} from './socialActivities'

describe('social activity templates (§ activities, Slice 4)', () => {
  it('maps invitation flavours to a template + a real world venue', () => {
    const coffee = activityFromInvitation('inv1', 'npc_ravi_01', 'coffee', 3)
    expect(coffee.template).toBe('hangout')
    expect(coffee.venueId).toBe('food_truck_01')
    expect(coffee.step).toBe('travel')

    expect(activityFromInvitation('i', 'npc_bruno_01', 'workout', 1).venueId).toBe('gym')
    expect(activityFromInvitation('i', 'npc_nisha_01', 'hangout', 1).template).toBe('meet')
  })

  it('a favor carries a real item + adds a delivery beat', () => {
    const favor = favorActivity('npc_maya_01', 'meal', { id: 'apartment', label: "Maya's place" }, 2, 0)
    expect(favor.template).toBe('favor')
    expect(favor.requiredItemId).toBe('meal')
    expect(templateSteps('favor')).toEqual(['travel', 'deliver', 'together', 'done'])
    expect(templateSteps('meet')).toEqual(['travel', 'together', 'done'])
  })

  it('advances linearly and reports completion', () => {
    let a = activityFromInvitation('inv', 'npc_ravi_01', 'coffee', 1) // hangout: travel→together→done
    expect(nextStep(a)).toBe('together')
    a = advanceActivity(a)
    expect(a.step).toBe('together')
    a = advanceActivity(a)
    expect(a.step).toBe('done')
    expect(isComplete(a)).toBe(true)
    // idempotent at the end
    expect(advanceActivity(a).step).toBe('done')
  })

  it('a favor goes travel → deliver → together → done', () => {
    let a = favorActivity('npc_leo_01', 'snack', { id: 'apartment', label: 'x' }, 1, 0)
    expect(a.step).toBe('travel')
    a = advanceActivity(a)
    expect(a.step).toBe('deliver')
    a = advanceActivity(a)
    expect(a.step).toBe('together')
    a = advanceActivity(a)
    expect(isComplete(a)).toBe(true)
  })

  it('prompts describe the current step', () => {
    const a = activityFromInvitation('inv', 'npc_ravi_01', 'coffee', 1)
    expect(activityPrompt(a, 'Ravi')).toMatch(/Head to .* to meet Ravi/i)
    expect(activityPrompt({ ...a, step: 'done' }, 'Ravi')).toMatch(/spent time with Ravi/i)
  })
})
