import type { Point2 } from '../world/trafficAvoidance'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import type {
  CarAgentView,
  CarSlowdownReason,
  CarTrafficState,
  CrosswalkStatusView,
  CrosswalkZone,
  PedestrianState,
} from './trafficTypes'
import { pointInZone } from './crosswalkUtils'
import {
  areVehicleFootprintsOverlapping,
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  type VehicleFootprint,
} from './vehicleObstacles'

/**
 * Live traffic agent state, mutated in useFrame by cars and NPCs and read by
 * the rules, the debug panel and the dev/test API. Module singleton on
 * purpose: this changes every frame and must never touch React state.
 */
export interface CarRuntime {
  id: string
  laneId: string
  x: number
  z: number
  heading: number
  speed: number
  targetSpeed: number
  state: CarTrafficState
  reason: CarSlowdownReason
  blockedTime: number
  lastHonkAt: number
}

export interface PedestrianRuntime {
  id: string
  x: number
  z: number
  state: PedestrianState
  waitingAtCrosswalkId: string | null
  crossingCrosswalkId: string | null
  waitTime: number
}

export const trafficRuntime = {
  cars: new Map<string, CarRuntime>(),
  pedestrians: new Map<string, PedestrianRuntime>(),
  /**
   * Deterministic signal clock: seconds of unpaused simulation time. The
   * pause-snap normally realigns to the cycle start (0); a dev/test pin
   * (setIntersectionElapsed) survives the snap so baselines can photograph
   * ANY phase — walk_all crossings, a specific green — deterministically.
   */
  signal: { elapsed: 0, pauseSeq: 0, pinned: null as number | null },
  /** Dev/test-only repositioning requests, consumed on the next frame. */
  carOverrides: new Map<string, { position: [number, number]; targetIndex?: number }>(),
  npcOverrides: new Map<string, { position: [number, number]; waypointIndex?: number }>(),
  /** Dev-only: DebugPanel shows per-crossing pedestrian queues when set. */
  pedestrianCrossingDebug: false,
}

/** The driven car's oriented footprint, or null when it doesn't exist yet. */
export function getDrivenCarFootprint(): VehicleFootprint | null {
  if (!registry.vehicleBody) return null
  const rot = registry.vehicleBody.rotation()
  return {
    id: 'vehicle_compact_car_01',
    kind: 'driven',
    position: { x: registry.vehiclePosition.x, z: registry.vehiclePosition.z },
    heading: 2 * Math.atan2(rot.y, rot.w),
    halfLength: CAR_HALF_LENGTH,
    halfWidth: CAR_HALF_WIDTH,
    speed: Math.abs(registry.flags.drivingSpeed),
  }
}

/** All vehicle footprints (driven + ambient) — for debug and test assertions. */
export function collectAllVehicleFootprints(): VehicleFootprint[] {
  const out: VehicleFootprint[] = []
  const driven = getDrivenCarFootprint()
  if (driven) out.push(driven)
  for (const car of trafficRuntime.cars.values()) {
    out.push({
      id: car.id,
      kind: 'ambient',
      position: { x: car.x, z: car.z },
      heading: car.heading,
      halfLength: CAR_HALF_LENGTH,
      halfWidth: CAR_HALF_WIDTH,
      speed: car.speed,
    })
  }
  return out
}

/** Ids of vehicle pairs whose footprints currently overlap (empty = healthy). */
export function findVehicleOverlaps(): [string, string][] {
  const all = collectAllVehicleFootprints()
  const overlaps: [string, string][] = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (areVehicleFootprintsOverlapping(all[i], all[j])) {
        overlaps.push([all[i].id, all[j].id])
      }
    }
  }
  return overlaps
}

// Scratch buffers reused every frame — no per-frame allocations.
const carViewScratch: CarAgentView[] = []
const pointScratch: Point2 = { x: 0, z: 0 }

/**
 * Every rolling car a pedestrian must respect: ambient cars plus the
 * player's car while it's being driven (heading from the yaw-only body).
 */
export function collectCarViews(): CarAgentView[] {
  carViewScratch.length = 0
  for (const car of trafficRuntime.cars.values()) {
    carViewScratch.push({
      position: { x: car.x, z: car.z },
      heading: car.heading,
      speed: car.speed,
    })
  }
  if (useGameStore.getState().mode === 'driving') {
    const rot = registry.vehicleBody?.rotation()
    const heading = rot ? 2 * Math.atan2(rot.y, rot.w) : 0
    const speed = registry.flags.drivingSpeed
    carViewScratch.push({
      position: { x: registry.vehiclePosition.x, z: registry.vehiclePosition.z },
      // Reversing car: it approaches whatever is behind it.
      heading: speed < 0 ? heading + Math.PI : heading,
      speed: Math.abs(speed),
    })
  }
  return carViewScratch
}

/**
 * Crosswalk status for the car rules: occupied while a pedestrian is
 * committed to crossing it or the on-foot player stands inside the zone;
 * flagged for courtesy when a pedestrian waits at its curb.
 */
export function getCrosswalkStatus(zone: CrosswalkZone): CrosswalkStatusView {
  let occupied = false
  let hasWaitingPedestrian = false
  for (const ped of trafficRuntime.pedestrians.values()) {
    if (ped.crossingCrosswalkId === zone.id) occupied = true
    if (ped.waitingAtCrosswalkId === zone.id) hasWaitingPedestrian = true
  }
  if (!occupied && useGameStore.getState().mode === 'walking') {
    pointScratch.x = registry.playerPosition.x
    pointScratch.z = registry.playerPosition.z
    if (pointInZone(pointScratch, zone)) occupied = true
  }
  return {
    id: zone.id,
    center: { x: zone.center[0], z: zone.center[1] },
    occupied,
    hasWaitingPedestrian,
  }
}
