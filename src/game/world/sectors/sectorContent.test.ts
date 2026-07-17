import { describe, expect, it } from 'vitest'
import { validateSectorRegistry } from './sectorRegistry'
import {
  getOwnedIds,
  getSectorContentIndex,
  getSectorContentSummary,
  getSectorForContent,
  getSectorForRoadSegment,
  validateSectorOwnership,
} from './sectorContent'
import { AMBIENT_CARS, BUILDINGS, PROPS } from '../cityLayout'
import { NPC_DEFS } from '../../../data/npcs'
import { AMBIENT_CITIZENS } from '../../citizens/ambientCitizenData'
import { getRoadGraph } from '../../traffic/routing/roadGraphBuilder'

describe('sector registry', () => {
  it('validates: unique ids/coords, grid-true bounds, labeled map sectors', () => {
    expect(validateSectorRegistry()).toEqual([])
  })
})

describe('sector content ownership', () => {
  it('passes full ownership validation', () => {
    expect(validateSectorOwnership()).toEqual([])
  })

  it('every building, prop, citizen, NPC and vehicle has exactly one owner', () => {
    const index = getSectorContentIndex()
    for (const b of BUILDINGS) expect(index.owners.get(b.id), b.id).toBeDefined()
    for (const p of PROPS) expect(index.owners.get(p.id), p.id).toBeDefined()
    for (const n of NPC_DEFS) expect(index.owners.get(n.id), n.id).toBeDefined()
    for (const c of AMBIENT_CITIZENS) expect(index.owners.get(c.id), c.id).toBeDefined()
    for (const v of AMBIENT_CARS) expect(index.owners.get(v.id), v.id).toBeDefined()
  })

  it('original city gameplay content lives in s0_0; kit content in its sector', () => {
    for (const npc of NPC_DEFS) expect(getSectorForContent(npc.id)).toBe('s0_0')
    for (const citizen of AMBIENT_CITIZENS) {
      // Kit-authored citizens carry their sector id as an id prefix; the
      // hand-authored gateway pair (polish pass), the Harbor Cross walkers
      // (crossings v1) and most destination-driven citizens live in the
      // gateway cell — two destination homes sit further north.
      const kit = citizen.id.match(/^(s-?\d+_-?\d+)_/)
      const northCells: Record<string, string> = {
        cit_dd_cafe_regular: 's0_-2',
        cit_dd_mart_regular: 's1_-2',
      }
      const gatewayCell =
        citizen.id.startsWith('cit_g_') ||
        citizen.id.startsWith('cit_hc_') ||
        citizen.id.startsWith('cit_dd_')
      const expected =
        kit?.[1] ?? northCells[citizen.id] ?? (gatewayCell ? 's0_-1' : 's0_0')
      expect(getSectorForContent(citizen.id), citizen.id).toBe(expected)
    }
    expect(getSectorForContent('building_apartment_01')).toBe('s0_0')
    expect(getSectorForContent('food_truck_01')).toBe('s0_0')
  })

  it('backdrop towers resolve to their shelf sectors', () => {
    expect(getSectorForContent('building_tower_01')).toBe('s-1_0') // (-76, -14)
    expect(getSectorForContent('building_tower_02')).toBe('s1_0') // (72, -12) boundary
    expect(getSectorForContent('building_tower_04')).toBe('s1_0') // (80, -35)
    expect(getSectorForContent('building_tower_05')).toBe('s-1_0') // (-76, 10)
  })

  it('every road segment has sector metadata with a consistent primary', () => {
    const graph = getRoadGraph()
    for (const id of graph.segments.keys()) {
      const meta = getSectorForRoadSegment(id)
      expect(meta, id).toBeDefined()
      expect(meta!.touchedSectorIds).toContain(meta!.primarySectorId)
    }
  })

  it('quest-relevant anchors resolve: Ravi, Maya, apartment entrance', () => {
    expect(getSectorForContent('npc_ravi_01')).toBe('s0_0')
    expect(getSectorForContent('npc_maya_01')).toBe('s0_0')
    expect(getSectorForContent('apartment')).toBe('s0_0') // the entrance interactable
  })

  it('content summaries report the migrated city', () => {
    const summary = getSectorContentSummary('s0_0')
    expect(summary.building).toBeGreaterThan(30)
    expect(summary.citizen).toBeGreaterThanOrEqual(50)
    expect(summary.namedNpc).toBe(NPC_DEFS.length)
    expect(getOwnedIds('s0_0', 'crossing').length).toBeGreaterThanOrEqual(6)
  })
})
