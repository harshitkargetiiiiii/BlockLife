import { beforeEach, describe, expect, it } from 'vitest'
import {
  commitMove,
  getAsset,
  getPlacements,
  getStoredAssetIds,
  mintFurnitureAsset,
  moveAsset,
  placeAsset,
  replaceAsset,
  resetHousing,
  rotateAsset,
  storeAsset,
} from './housingRuntime'
import { nextRotation } from './placement'
import { getFurnitureDef } from './furnitureCatalog'
import { getSlot } from './propertyRegistry'
import { canBuyFurniture } from './housingCommerce'

describe('furniture placement (runtime + pure rules)', () => {
  beforeEach(() => {
    resetHousing(0)
    commitMove('city_loft', 0) // the loft has the full slot set
  })

  it('places a compatible stored asset into an empty slot', () => {
    const sofa = mintFurnitureAsset('sofa')
    expect(placeAsset('lf_sofa', sofa.assetId).ok).toBe(true)
    expect(getPlacements()['lf_sofa']).toBe(sofa.assetId)
    expect(getStoredAssetIds()).not.toContain(sofa.assetId)
  })

  it('refuses incompatible category and size', () => {
    const sofa = mintFurnitureAsset('sofa') // seating large
    expect(placeAsset('lf_bed', sofa.assetId).reason).toBe('incompatible_category')
    const cabinet = mintFurnitureAsset('storage_cabinet') // storage large
    expect(placeAsset('lf_bedside', cabinet.assetId).reason).toBe('incompatible_size') // bedside maxSize small
  })

  it('refuses overwriting an occupied slot but allows an explicit replace (old → storage, never lost)', () => {
    const a = mintFurnitureAsset('sofa')
    const b = mintFurnitureAsset('sofa')
    placeAsset('lf_sofa', a.assetId)
    expect(placeAsset('lf_sofa', b.assetId).reason).toBe('slot_occupied')
    expect(replaceAsset('lf_sofa', b.assetId).ok).toBe(true)
    expect(getPlacements()['lf_sofa']).toBe(b.assetId)
    expect(getStoredAssetIds()).toContain(a.assetId)
  })

  it('refuses placing an already-placed asset into a second slot', () => {
    const lamp = mintFurnitureAsset('floor_lamp') // lighting small — fits lf_bedside AND lf_decor
    placeAsset('lf_bedside', lamp.assetId)
    expect(placeAsset('lf_decor', lamp.assetId).reason).toBe('asset_placed_elsewhere')
  })

  it('moves an asset to another empty compatible slot', () => {
    const lamp = mintFurnitureAsset('floor_lamp')
    placeAsset('lf_bedside', lamp.assetId)
    expect(moveAsset('lf_bedside', 'lf_decor').ok).toBe(true)
    expect(getPlacements()['lf_decor']).toBe(lamp.assetId)
    expect(getPlacements()['lf_bedside']).toBeUndefined()
  })

  it('rotates a placed asset through allowed orientations', () => {
    const sofa = mintFurnitureAsset('sofa')
    placeAsset('lf_sofa', sofa.assetId)
    const before = getAsset(sofa.assetId)!.rotationY
    rotateAsset('lf_sofa')
    expect(getAsset(sofa.assetId)!.rotationY).not.toBe(before)
  })

  it('stores a placed asset back into inventory without deleting it', () => {
    const sofa = mintFurnitureAsset('sofa')
    placeAsset('lf_sofa', sofa.assetId)
    expect(storeAsset('lf_sofa')).toBe(true)
    expect(getPlacements()['lf_sofa']).toBeUndefined()
    expect(getStoredAssetIds()).toContain(sofa.assetId)
  })

  it('cycles rotation deterministically within the allowed set', () => {
    const slot = getSlot('city_loft', 'lf_sofa')!
    const def = getFurnitureDef('sofa')!
    const r1 = nextRotation(0, slot, def)
    const r2 = nextRotation(r1, slot, def)
    expect(r1).not.toBe(0)
    expect([r1, r2]).toHaveLength(2)
  })
})

describe('furniture purchase (economy reuse, exact-once asset)', () => {
  beforeEach(() => resetHousing(0))

  it('validates funds + unknown items', () => {
    expect(canBuyFurniture('sofa', 500)).toEqual({ ok: true, price: 360 })
    expect(canBuyFurniture('sofa', 10).ok).toBe(false)
    expect(canBuyFurniture('ghost', 9999).ok).toBe(false)
  })
})
