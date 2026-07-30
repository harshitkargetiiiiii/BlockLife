import { beforeEach, describe, expect, it } from 'vitest'
import { commitMove, getLease, mintFurnitureAsset, placeAsset, resetHousing } from './housingRuntime'
import { canHostActivity, guestAnchorFor, homeInviteScheduleConflict, tierAtLeast } from './housingSocial'
import type { ScheduledShift } from '../careers/careerTypes'

describe('home hosting gates', () => {
  beforeEach(() => resetHousing(0))

  it('orders relationship tiers', () => {
    expect(tierAtLeast('trusted', 'friendly')).toBe(true)
    expect(tierAtLeast('friendly', 'trusted')).toBe(false)
    expect(tierAtLeast('close', 'close')).toBe(true)
  })

  it('refuses hosting with no suitable furniture', () => {
    // The starter studio can't seat a movie night (no TV / entertainment slot).
    expect(canHostActivity('movie_night').reason).toBe('missing_furniture')
  })

  it('allows coffee at home once a coffee table + seating are placed', () => {
    commitMove('city_loft', 0)
    placeAsset('lf_coffee', mintFurnitureAsset('coffee_table').assetId)
    placeAsset('lf_sofa', mintFurnitureAsset('sofa').assetId) // 3 seats
    expect(canHostActivity('coffee_home')).toEqual({ ok: true })
  })

  it('refuses hosting while the lease is delinquent', () => {
    commitMove('city_loft', 0)
    placeAsset('lf_coffee', mintFurnitureAsset('coffee_table').assetId)
    placeAsset('lf_sofa', mintFurnitureAsset('sofa').assetId)
    getLease().debt = 200
    getLease().status = 'delinquent'
    expect(canHostActivity('coffee_home').reason).toBe('delinquent')
  })

  it('provides a guest anchor for every property', () => {
    expect(guestAnchorFor('starter_studio')).not.toBeNull()
    expect(guestAnchorFor('city_loft')).not.toBeNull()
    expect(guestAnchorFor('premium_apartment')).not.toBeNull()
  })
})

describe('home-invite schedule conflict (round-2 review #1)', () => {
  const shift = (scheduledDay: number, startHour: number, durationHours = 4): Pick<ScheduledShift, 'scheduledDay' | 'startHour' | 'durationHours' | 'status'> =>
    ({ scheduledDay, startHour, durationHours, status: 'scheduled' })

  it('no conflict when the slot is free of shifts and plans', () => {
    expect(homeInviteScheduleConflict({ day: 2, hour: 14 }, [shift(2, 8)], [{ day: 2, hour: 20 }])).toBe(false)
  })

  it('conflicts when the visit falls inside a scheduled shift window', () => {
    // Shift day 2, 09:00–13:00; a 10:00 visit is inside it.
    expect(homeInviteScheduleConflict({ day: 2, hour: 10 }, [shift(2, 9)], [])).toBe(true)
  })

  it('conflicts when the visit overlaps an already-accepted plan', () => {
    // Accepted plan day 3 at 15:00; a visit at 16:00 overlaps the 2h plan window.
    expect(homeInviteScheduleConflict({ day: 3, hour: 16 }, [], [{ day: 3, hour: 15 }])).toBe(true)
  })

  it('ignores shifts that are already worked/cancelled (only scheduled/available block)', () => {
    const worked = { scheduledDay: 2, startHour: 9, durationHours: 4, status: 'completed' as const }
    expect(homeInviteScheduleConflict({ day: 2, hour: 10 }, [worked], [])).toBe(false)
  })
})
