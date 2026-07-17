import { useGameStore } from '../store/useGameStore'
import { registry } from './runtimeRegistry'
import type { Point2 } from './trafficAvoidance'
import { getDrivenCarFootprint, trafficRuntime } from '../traffic/trafficRuntime'
import {
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  type VehicleFootprint,
} from '../traffic/vehicleObstacles'

/**
 * Shared per-frame sensory input for every ambient car (loop or routed):
 * point obstacles (pedestrians, on-foot player) and vehicle footprints.
 * Scratch buffers are reused — safe because cars consume them sequentially
 * within one frame, never concurrently.
 */

const obstacleScratch: Point2[] = []
const vehicleScratch: VehicleFootprint[] = []
const footprintPool: VehicleFootprint[] = []

function pooledFootprint(index: number): VehicleFootprint {
  let f = footprintPool[index]
  if (!f) {
    f = {
      id: '',
      kind: 'ambient',
      position: { x: 0, z: 0 },
      heading: 0,
      halfLength: CAR_HALF_LENGTH,
      halfWidth: CAR_HALF_WIDTH,
      speed: 0,
    }
    footprintPool[index] = f
  }
  return f
}

/** Small point obstacles: pedestrians and the on-foot player. */
export function collectPointObstacles(): Point2[] {
  obstacleScratch.length = 0
  if (useGameStore.getState().mode === 'walking') {
    const p = registry.playerPosition
    obstacleScratch.push({ x: p.x, z: p.z })
  }
  for (const npc of registry.npcPositions.values()) {
    obstacleScratch.push({ x: npc.x, z: npc.z })
  }
  return obstacleScratch
}

/** Vehicle footprints: the player's car (driven OR parked) + other ambient cars. */
export function collectVehicleFootprints(selfId: string): VehicleFootprint[] {
  vehicleScratch.length = 0
  let n = 0
  const driven = getDrivenCarFootprint()
  if (driven) {
    const f = pooledFootprint(n++)
    f.id = driven.id
    f.kind = 'driven'
    f.position.x = driven.position.x
    f.position.z = driven.position.z
    f.heading = driven.heading
    f.speed = driven.speed
    vehicleScratch.push(f)
  }
  for (const car of trafficRuntime.cars.values()) {
    if (car.id === selfId) continue
    const f = pooledFootprint(n++)
    f.id = car.id
    f.kind = 'ambient'
    f.position.x = car.x
    f.position.z = car.z
    f.heading = car.heading
    f.speed = car.speed
    vehicleScratch.push(f)
  }
  return vehicleScratch
}
