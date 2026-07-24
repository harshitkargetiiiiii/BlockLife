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
import { policeRuntime } from '../../police/policeRuntime'
import { getDrivenCarFootprint, trafficRuntime } from '../../traffic/trafficRuntime'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../../traffic/vehicleObstacles'
import type { EntityDescriptor } from './entityTypes'

const PERSON_RADIUS = 0.35

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
  // Dismounted police officers (own runtime, not npcPositions) — mirrored so the
  // detector surfaces police↔civilian and police↔solid overlaps. Their movement is
  // hard-clamped through the shared contract by `resolvePoliceOccupancy` (police
  // spacing + vehicle/solid clamps), so these overlaps are held to the same bar as
  // citizens — the 300s soak covers police with no `police_*` filter (§8).
  for (const unit of policeRuntime.units.values()) {
    if (unit.kind !== 'officer') continue
    out.push({
      id: unit.id,
      kind: 'police_officer',
      sectorId: null,
      x: unit.position[0],
      z: unit.position[1],
      radius: PERSON_RADIUS,
      moving: true,
      capabilities: ['renderable', 'occupancy'],
      sourceRef: 'policeRuntime.units',
    })
  }
}

/** Driven car (while driving) + ambient traffic cars — real oriented footprints. */
export function collectVehicleEntities(out: EntityDescriptor[]): void {
  const driven = getDrivenCarFootprint()
  if (driven) {
    out.push({
      id: driven.id,
      kind: 'driven_vehicle',
      sectorId: null,
      x: driven.position.x,
      z: driven.position.z,
      headingY: driven.heading,
      oriented: {
        x: driven.position.x,
        z: driven.position.z,
        halfLength: driven.halfLength,
        halfWidth: driven.halfWidth,
        headingY: driven.heading,
      },
      capabilities: ['renderable', 'solid', 'occupancy', 'navObstacle'],
      sourceRef: 'traffic.getDrivenCarFootprint',
    })
  }
  for (const car of trafficRuntime.cars.values()) {
    out.push({
      id: car.id,
      kind: 'ambient_vehicle',
      sectorId: null,
      x: car.x,
      z: car.z,
      headingY: car.heading,
      // Real heading from the traffic runtime → accurate oriented-SAT overlap.
      oriented: { x: car.x, z: car.z, halfLength: CAR_HALF_LENGTH, halfWidth: CAR_HALF_WIDTH, headingY: car.heading },
      capabilities: ['renderable', 'solid', 'occupancy', 'navObstacle'],
      sourceRef: 'trafficRuntime.cars',
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
