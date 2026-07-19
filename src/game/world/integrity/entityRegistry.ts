/**
 * Semantic world-entity registry (module singleton, same two-tier discipline as
 * the rest of BlockLife: IDs/scalars only, never React/Three/Rapier objects).
 *
 * Two tiers behind ONE query surface (`listEntities`):
 *  - STATIC entities (buildings, props, anchors, world-UI) are registered by
 *    React on mount and removed on unmount. Registration is generation-guarded
 *    so a StrictMode double-mount or a sector remount cannot let a stale unmount
 *    delete the newer instance (see CONVENTIONS gotchas #2/#14).
 *  - DYNAMIC entities (people, vehicles) are mirrored every integrity tick from
 *    the existing runtimes via adapters (`syncDynamic`) — the runtime stays the
 *    lifecycle authority; the registry is a read model, so there is no second
 *    movement authority and no per-frame churn of long-lived descriptors.
 *
 * Deterministic: `listEntities` returns entries sorted by id. Bounded: a hard
 * cap guards against a leak turning into unbounded growth.
 */
import type { EntityDescriptor, EntityKind } from './entityTypes'

/** Hard upper bound — a leak trips a DEV assertion instead of growing forever. */
export const MAX_ENTITIES = 4000

interface StaticEntry {
  desc: EntityDescriptor
  generation: number
}

export interface EntityRegistryStats {
  total: number
  staticCount: number
  dynamicCount: number
  byKind: Record<string, number>
  duplicateRegistrations: number
  staleRejections: number
  overflowRejections: number
}

const staticEntries = new Map<string, StaticEntry>()
let dynamicEntries = new Map<string, EntityDescriptor>()

let duplicateRegistrations = 0
let staleRejections = 0
let overflowRejections = 0

function devWarn(message: string): void {
  if (import.meta.env.DEV) console.warn(`[integrity] ${message}`)
}

/**
 * Register (or update) a static entity. Generation-guarded: a registration with
 * a lower generation than the current entry is rejected as stale, so an old
 * mount's late effect cannot clobber a newer instance sharing the id.
 */
export function registerStaticEntity(desc: EntityDescriptor, generation = 0): void {
  const existing = staticEntries.get(desc.id)
  if (existing) {
    if (generation < existing.generation) {
      staleRejections++
      return
    }
    if (generation === existing.generation && existing.desc.kind !== desc.kind) {
      // Same id + generation but a different kind = a real duplicate-id bug.
      duplicateRegistrations++
      devWarn(`duplicate id "${desc.id}" (${existing.desc.kind} vs ${desc.kind})`)
    }
  }
  if (!existing && staticEntries.size + dynamicEntries.size >= MAX_ENTITIES) {
    overflowRejections++
    devWarn(`entity overflow (>${MAX_ENTITIES}) rejecting "${desc.id}"`)
    return
  }
  staticEntries.set(desc.id, { desc: { ...desc, generation }, generation })
}

/**
 * Remove a static entity, but only if the caller's generation is not older than
 * the stored one — a stale unmount cannot deregister a newer remount.
 */
export function unregisterStaticEntity(id: string, generation = 0): void {
  const existing = staticEntries.get(id)
  if (!existing) return
  if (generation < existing.generation) {
    staleRejections++
    return
  }
  staticEntries.delete(id)
}

/**
 * Replace the whole dynamic tier from adapters (called once per integrity tick).
 * The previous dynamic map is discarded wholesale — the source runtimes own the
 * lifecycle, so there is nothing to generation-guard here.
 */
export function syncDynamicEntities(descriptors: readonly EntityDescriptor[]): void {
  const next = new Map<string, EntityDescriptor>()
  for (const d of descriptors) {
    if (next.has(d.id)) {
      duplicateRegistrations++
      devWarn(`duplicate dynamic id "${d.id}"`)
      continue
    }
    if (next.size >= MAX_ENTITIES) {
      overflowRejections++
      continue
    }
    next.set(d.id, d)
  }
  dynamicEntries = next
}

/** One deterministic (id-sorted) view over both tiers. */
export function listEntities(): EntityDescriptor[] {
  const all: EntityDescriptor[] = []
  for (const e of staticEntries.values()) all.push(e.desc)
  for (const d of dynamicEntries.values()) all.push(d)
  all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return all
}

export function getEntity(id: string): EntityDescriptor | undefined {
  return staticEntries.get(id)?.desc ?? dynamicEntries.get(id)
}

export function listEntitiesByKind(kind: EntityKind): EntityDescriptor[] {
  return listEntities().filter((e) => e.kind === kind)
}

export function getRegistryStats(): EntityRegistryStats {
  const byKind: Record<string, number> = {}
  for (const e of staticEntries.values()) byKind[e.desc.kind] = (byKind[e.desc.kind] ?? 0) + 1
  for (const d of dynamicEntries.values()) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1
  return {
    total: staticEntries.size + dynamicEntries.size,
    staticCount: staticEntries.size,
    dynamicCount: dynamicEntries.size,
    byKind,
    duplicateRegistrations,
    staleRejections,
    overflowRejections,
  }
}

/** Clear everything (reset/load). Dynamic + static + counters. */
export function resetEntityRegistry(): void {
  staticEntries.clear()
  dynamicEntries = new Map()
  duplicateRegistrations = 0
  staleRejections = 0
  overflowRejections = 0
}
