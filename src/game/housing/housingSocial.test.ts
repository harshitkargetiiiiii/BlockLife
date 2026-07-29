import { beforeEach, describe, expect, it } from 'vitest'
import { commitMove, getLease, mintFurnitureAsset, placeAsset, resetHousing } from './housingRuntime'
import { canHostActivity, guestAnchorFor, tierAtLeast } from './housingSocial'

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
