/**
 * Adapters that MIRROR the existing runtimes into semantic entity descriptors
 * (issue §1 migration approach: "begin by mirroring existing runtimes through
 * adapters"). Read-only — the runtimes stay the lifecycle + mutation authority.
 * These run each integrity tick to rebuild the registry's view of the live world.
 *
 * Coverage this stretch: player + ambient citizens/NPCs (`registry.npcPositions`),
 * the driven car + ambient traffic (`registry.ambientCarPositions`), and tall
 * buildings (from the visibility occluder set). Police / interior civilians /
 * ejected drivers and precise ambient-car headings are folded in with the
 * universal-occupancy phase; documented in WORLD_INTEGRITY_AND_CERTIFICATION.md.
 */
import { registry } from '../runtimeRegistry'
import { visibilityRuntime } from '../../visibility/visibilityRuntime'
import { useGameStore } from '../../store/useGameStore'
import type { EntityDescriptor } from './entityTypes'

const PERSON_RADIUS = 0.35
const CAR_HALF_LENGTH = 2.1
const CAR_HALF_WIDTH = 0.95

/** Player + ambient citizens/named NPCs from `registry.npcPositions`. */
export function collectPeopleEntities(out: EntityDescriptor[]): void {
  const store = useGameStore.getState()
  // The player is off-foot while driving (represented by the vehicle instead).
  if (store.mode !== 'driving') {
    out.push({
      id: 'player',
      kind: 'player',
      sectorId: null,
      x: registry.playerPosition.x,
      z: registry.playerPosition.z,
      headingY: registry.playerHeading,
      radius: PERSON_RADIUS,
      moving: registry.flags.running,
      capabilities: ['renderable', 'occupancy'],
      sourceRef: 'runtimeRegistry.playerPosition',
    })
  }
  for (const [id, pos] of registry.npcPositions) {
    out.push({
      id,
      kind: 'ambient_citizen',
      sectorId: null,
      x: pos.x,
      z: pos.z,
      radius: PERSON_RADIUS,
      moving: registry.movingPersonIds.has(id),
      capabilities: ['renderable', 'occupancy'],
      sourceRef: 'runtimeRegistry.npcPositions',
    })
  }
}

/** Driven car (while driving) + ambient traffic cars. */
export function collectVehicleEntities(out: EntityDescriptor[]): void {
  const store = useGameStore.getState()
  if (store.mode === 'driving') {
    const p = registry.vehiclePosition
    out.push({
      id: 'player_vehicle',
      kind: 'driven_vehicle',
      sectorId: null,
      x: p.x,
      z: p.z,
      headingY: registry.playerHeading,
      oriented: { x: p.x, z: p.z, halfLength: CAR_HALF_LENGTH, halfWidth: CAR_HALF_WIDTH, headingY: registry.playerHeading },
      capabilities: ['renderable', 'solid', 'occupancy', 'navObstacle'],
      sourceRef: 'runtimeRegistry.vehiclePosition',
    })
  }
  for (const [id, pos] of registry.ambientCarPositions) {
    out.push({
      id,
      kind: 'ambient_vehicle',
      sectorId: null,
      x: pos.x,
      z: pos.z,
      // Heading not tracked for decorative ambient cars yet — approximated as
      // axis-aligned; refined with the traffic-integration phase.
      oriented: { x: pos.x, z: pos.z, halfLength: CAR_HALF_LENGTH, halfWidth: CAR_HALF_WIDTH, headingY: 0 },
      capabilities: ['renderable', 'solid', 'occupancy', 'navObstacle'],
      sourceRef: 'runtimeRegistry.ambientCarPositions',
    })
  }
}

/** Buildings mirrored from the visibility occluder set (footprint = its bounds). */
export function collectBuildingEntities(out: EntityDescriptor[]): void {
  for (const occ of visibilityRuntime.occluders.values()) {
    const d = occ.descriptor
    if (d.linkedTo) continue // decal group — not a real footprint
    const b = d.bounds2D
    if (b.minX === b.maxX || b.minZ === b.maxZ) continue // degenerate
    out.push({
      id: d.id,
      kind: 'building',
      sectorId: null,
      x: (b.minX + b.maxX) / 2,
      z: (b.minZ + b.maxZ) / 2,
      footprint: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
      minY: d.minY,
      maxY: d.maxY,
      capabilities: ['renderable', 'solid', 'occupancy', 'navObstacle', 'occluder', 'certifiable'],
      sourceRef: 'visibilityRuntime.occluders',
    })
  }
}

/** One snapshot of every mirrored entity for this integrity tick. */
export function collectAllEntities(): EntityDescriptor[] {
  const out: EntityDescriptor[] = []
  collectPeopleEntities(out)
  collectVehicleEntities(out)
  collectBuildingEntities(out)
  return out
}
