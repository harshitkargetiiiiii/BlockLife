import { beforeEach, describe, expect, it } from 'vitest'
import type { EntityDescriptor } from './entityTypes'
import {
  getEntity,
  getRegistryStats,
  listEntities,
  listEntitiesByKind,
  registerStaticEntity,
  resetEntityRegistry,
  syncDynamicEntities,
  unregisterStaticEntity,
} from './entityRegistry'

function building(id: string, x = 0, z = 0): EntityDescriptor {
  return { id, kind: 'building', sectorId: 'sector_a', x, z, capabilities: ['solid', 'occluder'] }
}
function person(id: string, x = 0, z = 0): EntityDescriptor {
  return { id, kind: 'ambient_citizen', sectorId: 'sector_a', x, z, radius: 0.35, capabilities: ['occupancy'] }
}

describe('entityRegistry', () => {
  beforeEach(() => resetEntityRegistry())

  it('registers, updates and removes static entities', () => {
    registerStaticEntity(building('b1', 1, 2))
    expect(getEntity('b1')?.x).toBe(1)
    registerStaticEntity(building('b1', 9, 9)) // update
    expect(getEntity('b1')?.x).toBe(9)
    unregisterStaticEntity('b1')
    expect(getEntity('b1')).toBeUndefined()
  })

  it('rejects a stale-generation unregister (newer remount survives)', () => {
    registerStaticEntity(building('b1'), 1) // gen 1 (old mount)
    registerStaticEntity(building('b1'), 2) // gen 2 (remount)
    unregisterStaticEntity('b1', 1) // stale cleanup from the old mount
    expect(getEntity('b1')).toBeDefined() // newer instance survives
    expect(getRegistryStats().staleRejections).toBe(1)
    unregisterStaticEntity('b1', 2) // current-generation cleanup
    expect(getEntity('b1')).toBeUndefined()
  })

  it('rejects a stale-generation re-registration', () => {
    registerStaticEntity(building('b1', 5, 5), 2)
    registerStaticEntity(building('b1', 0, 0), 1) // stale, lower gen
    expect(getEntity('b1')?.x).toBe(5) // newer kept
    expect(getRegistryStats().staleRejections).toBe(1)
  })

  it('flags a same-generation duplicate id of a different kind', () => {
    registerStaticEntity(building('dup'), 0)
    registerStaticEntity(person('dup'), 0)
    expect(getRegistryStats().duplicateRegistrations).toBe(1)
  })

  it('mirrors the dynamic tier wholesale each tick', () => {
    syncDynamicEntities([person('p1'), person('p2')])
    expect(listEntitiesByKind('ambient_citizen').map((e) => e.id)).toEqual(['p1', 'p2'])
    syncDynamicEntities([person('p2')]) // p1 gone
    expect(listEntitiesByKind('ambient_citizen').map((e) => e.id)).toEqual(['p2'])
  })

  it('dedupes duplicate dynamic ids within one sync', () => {
    syncDynamicEntities([person('p1', 0, 0), person('p1', 9, 9)])
    expect(listEntitiesByKind('ambient_citizen')).toHaveLength(1)
    expect(getEntity('p1')?.x).toBe(0) // first wins
    expect(getRegistryStats().duplicateRegistrations).toBe(1)
  })

  it('lists both tiers in deterministic id order', () => {
    registerStaticEntity(building('b_z'))
    registerStaticEntity(building('b_a'))
    syncDynamicEntities([person('p_m')])
    expect(listEntities().map((e) => e.id)).toEqual(['b_a', 'b_z', 'p_m'])
  })

  it('reports stats by kind and resets cleanly', () => {
    registerStaticEntity(building('b1'))
    syncDynamicEntities([person('p1'), person('p2')])
    const stats = getRegistryStats()
    expect(stats.total).toBe(3)
    expect(stats.staticCount).toBe(1)
    expect(stats.dynamicCount).toBe(2)
    expect(stats.byKind.building).toBe(1)
    expect(stats.byKind.ambient_citizen).toBe(2)
    resetEntityRegistry()
    expect(getRegistryStats().total).toBe(0)
    expect(listEntities()).toEqual([])
  })
})
