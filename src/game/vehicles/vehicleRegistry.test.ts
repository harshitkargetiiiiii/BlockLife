import { describe, expect, it } from 'vitest'
import {
  MAX_STREAMING_SAFE_SPEED,
  MIGRATION_VEHICLE_DEF_ID,
  VEHICLE_DEFS,
  getVehicleDef,
  isVehicleDefId,
  validateVehicleRegistry,
} from './vehicleRegistry'
import { RANK_ORDER, SKILL_IDS, type RankId, type SkillId } from '../careers/careerTypes'

describe('vehicle registry (issue #19 §1)', () => {
  it('validates clean with 4 distinct classes + a compact migration target', () => {
    expect(validateVehicleRegistry()).toEqual([])
    expect(new Set(VEHICLE_DEFS.map((d) => d.vehicleClass)).size).toBe(4)
    expect(getVehicleDef(MIGRATION_VEHICLE_DEF_ID)?.vehicleClass).toBe('compact')
    expect(isVehicleDefId('veh_compact')).toBe(true)
    expect(isVehicleDefId('nope')).toBe(false)
  })

  it('every referenced career rank / skill id exists in the real career authority', () => {
    for (const d of VEHICLE_DEFS) {
      if (d.requirement.minRank) expect(RANK_ORDER).toContain(d.requirement.minRank as RankId)
      if (d.requirement.minDrivingSkill !== undefined) expect(SKILL_IDS).toContain('driving' as SkillId)
    }
  })

  it('the Compact keeps the legacy tuning baseline; tiers stay streaming-safe', () => {
    const compact = getVehicleDef('veh_compact')!
    expect(compact.tuning.maxSpeed).toBe(14) // VEHICLE_TUNING baseline unchanged
    for (const d of VEHICLE_DEFS) {
      const perf = d.allowedUpgrades.includes('performance') ? 2 : 0
      expect(d.tuning.maxSpeed + perf).toBeLessThanOrEqual(MAX_STREAMING_SAFE_SPEED)
    }
  })

  it('the Van hauls the most; the Scooter the least (real cargo differences — §8)', () => {
    const cargo = (id: string) => getVehicleDef(id)!.cargoCapacity
    expect(cargo('veh_van')).toBeGreaterThan(cargo('veh_compact'))
    expect(cargo('veh_compact')).toBeGreaterThan(cargo('veh_scooter'))
  })

  it('the premium Sports car imposes a real rank + skill + income gate', () => {
    const sports = getVehicleDef('veh_sports')!
    expect(sports.requirement.minRank).toBe('experienced')
    expect(sports.requirement.minDrivingSkill).toBeGreaterThan(0)
    expect(sports.requirement.minRecentCareerIncome).toBeGreaterThan(0)
  })
})
