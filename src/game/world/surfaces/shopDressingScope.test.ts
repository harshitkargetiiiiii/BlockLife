import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../cityLayout'
import type { BuildingDef } from '../worldTypes'
import { computeFacadeDetails, isShopDressingEligible, resolveFacadeStyle } from './facadeDetails'
import { computeRoofDetails } from './roofDetails'

/**
 * Scope of the hybrid shop dressing (the shop roof kit and the mirrored street-side shopfront).
 *
 * `resolveFacadeStyle` calls ANY labelled building up to 6.5 m a 'shop'. That caught
 * building_townhomes_01 ("Townhomes — coming soon", a residential row house), so its procedural
 * fallback — the body shown when the row-house GLB is missing — grew a rooftop housing, a skylight
 * and an awning on its east wall. The dressing is now gated on an explicit shop identity.
 */

const byId = (id: string): BuildingDef => {
  const def = BUILDINGS.find((b) => b.id === id)
  if (!def) throw new Error(`no building ${id}`)
  return def
}

/** Boxes on a side wall that is NOT the authored door's face: only the mirrored shopfront goes there. */
function offDoorFaceBoxes(def: BuildingDef) {
  const [w, , d] = def.size
  const doorFace = { east: '+x', west: '-x', south: '+z', north: '-z' }[def.door ?? 'south']
  return computeFacadeDetails(def).filter((b) => {
    if (b.role === 'trim') return false // the cornice wraps every wall
    const face =
      Math.abs(b.x) >= w / 2 - 1e-6 ? (b.x > 0 ? '+x' : '-x') : Math.abs(b.z) >= d / 2 - 1e-6 ? (b.z > 0 ? '+z' : '-z') : null
    return face !== null && face !== doorFace
  })
}

/** Lots that render a residential body (row house, houses, apartment), so their fallback is residential. */
const RESIDENTIAL_BODIES = new Set([
  'building_townhomes_01',
  'arch_house_01',
  'arch_house_01_compact',
  'arch_residential_house_01',
  'building_apartment_01',
])
const residential = BUILDINGS.filter((b) => RESIDENTIAL_BODIES.has(b.visual?.assetId ?? b.id))

/** Shops by explicit data: the approved shop body, lots authored onto it, and the two named procedural shops. */
const INTENDED_SHOPS = [
  'building_shop_01',
  'building_cafe_01',
  'building_shop_02',
  'building_market_01',
  'building_deli_s1',
  'building_gate_retail_01',
  's1_-1_n2',
  's1_-1_s1',
  's0_-2_shop',
  's1_-2_n2',
  's1_-2_s1',
  'building_commons_w1',
  's0_-2_cafe',
  's0_-2_pavilion', // Pier Kiosk: kept by owner decision through the named list
]

describe('hybrid shop dressing scope', () => {
  it('building_townhomes_01 is still styled a shop by the legacy heuristic (the case this guards)', () => {
    expect(resolveFacadeStyle(byId('building_townhomes_01'))).toBe('shop')
  })

  it('building_townhomes_01 gets no shop roof kit and no mirrored street-side shopfront', () => {
    const def = byId('building_townhomes_01')
    expect(isShopDressingEligible(def)).toBe(false)
    expect(computeRoofDetails(def)).toEqual([])
    expect(offDoorFaceBoxes(def)).toEqual([])
  })

  it('building_townhomes_01 keeps its legacy door-face facade (fascia, display, door frame, cornice)', () => {
    const roles = computeFacadeDetails(byId('building_townhomes_01')).map((b) => b.role)
    expect(roles.sort()).toEqual(['accent', 'dark', 'frame', 'trim'])
  })

  it('no lot rendering a residential body gets shop dressing', () => {
    expect(residential.length).toBeGreaterThanOrEqual(20)
    for (const def of residential) {
      expect(isShopDressingEligible(def), def.id).toBe(false)
      expect(computeRoofDetails(def), `${def.id} roof`).toEqual([])
      expect(offDoorFaceBoxes(def), `${def.id} side wall`).toEqual([])
    }
  })

  it('every intended shop keeps the quiet roof kit and the mirrored street-side shopfront', () => {
    for (const id of INTENDED_SHOPS) {
      const def = byId(id)
      expect(isShopDressingEligible(def), id).toBe(true)
      const roof = computeRoofDetails(def)
      expect(roof.map((b) => b.role).sort(), `${id} roof`).toEqual(['plant', 'skylight'])
      expect(offDoorFaceBoxes(def).map((b) => b.role).sort(), `${id} street side`).toEqual(['accent', 'dark'])
    }
  })

  it('Pier Kiosk is eligible through the named list and keeps the roof kit and street-side shopfront', () => {
    const def = byId('s0_-2_pavilion')
    expect(resolveFacadeStyle(def)).toBe('shop')
    expect(def.visual).toBeUndefined() // procedural: no shop-archetype mapping makes it eligible
    expect(isShopDressingEligible(def)).toBe(true)
    expect(computeRoofDetails(def).map((b) => b.role).sort()).toEqual(['plant', 'skylight'])
    expect(offDoorFaceBoxes(def).map((b) => b.role).sort()).toEqual(['accent', 'dark'])
  })

  it('Block Gym is styled a shop but is not one: no roof kit, no mirrored shopfront, legacy facade kept', () => {
    const def = byId('building_gym_01')
    expect(resolveFacadeStyle(def)).toBe('shop')
    expect(isShopDressingEligible(def)).toBe(false)
    expect(computeRoofDetails(def)).toEqual([])
    expect(offDoorFaceBoxes(def)).toEqual([])
    expect(computeFacadeDetails(def).map((b) => b.role).sort()).toEqual(['accent', 'dark', 'frame', 'trim'])
  })

  it('industrial lots keep the full rooftop plant and are never shop-dressed', () => {
    const industrial = BUILDINGS.filter((b) => resolveFacadeStyle(b) === 'industrial')
    expect(industrial.length).toBeGreaterThanOrEqual(4)
    for (const def of industrial) {
      expect(isShopDressingEligible(def), def.id).toBe(false)
      expect(computeRoofDetails(def).map((b) => b.role), def.id).toEqual(['plant', 'plant', 'duct', 'skylight', 'skylight'])
    }
  })
})
