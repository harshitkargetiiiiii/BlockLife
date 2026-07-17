import { describe, expect, it } from 'vitest'
import { getRoutineForHour, moveTowards } from './npcBehavior'
import { NPC_BY_ID } from '../../data/npcs'

describe('npcBehavior', () => {
  it('resolves routines by hour', () => {
    const ravi = NPC_BY_ID['npc_ravi_01']
    expect(getRoutineForHour(ravi, 8).points[0]).toEqual([-8.5, -5])
    expect(getRoutineForHour(ravi, 14).points[0]).toEqual([13.5, -6.5])
  })

  it('handles routines that wrap past midnight', () => {
    const ravi = NPC_BY_ID['npc_ravi_01']
    // 18-6 evening/night block covers both 23:00 and 03:00
    expect(getRoutineForHour(ravi, 23)).toBe(getRoutineForHour(ravi, 3))
  })

  it('moveTowards steps toward the target without overshooting', () => {
    const r = moveTowards([0, 0], [10, 0], 1)
    expect(r.position[0]).toBeCloseTo(1)
    expect(r.arrived).toBe(false)
    expect(r.direction[0]).toBeCloseTo(1)
  })

  it('moveTowards snaps to the target when close', () => {
    const r = moveTowards([9.9, 0], [10, 0], 1)
    expect(r.position).toEqual([10, 0])
    expect(r.arrived).toBe(true)
  })
})
