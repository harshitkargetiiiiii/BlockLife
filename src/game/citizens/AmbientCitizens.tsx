import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import {
  AMBIENT_CITIZENS,
  isCitizenActive,
  isCitizenOutInRain,
  type AmbientCitizen,
} from './ambientCitizenData'
import { isRaining, weatherRuntime } from '../weather/weatherSystem'
import { getNearestShelter } from '../weather/weatherData'
import type { Vec2 } from '../world/worldTypes'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { moveTowards } from '../npc/npcBehavior'
import { lerpAngle } from '../utils/math'
import { pushOutOfCircle } from '../world/trafficAvoidance'
import { resolvePersonSpacing } from '../world/personSeparation'
import { panicFleeStep } from '../combat/panicFlee'
import { getCrimeGameTime } from '../crime/crimeSystem'
import { CROSSWALKS, SIGNALLED_CROSSWALK_IDS, TRAFFIC_TUNING } from '../traffic/trafficData'
import { decidePedestrian } from '../traffic/pedestrianRules'
import { getPedestrianSignal, getPhaseAt, type PedestrianSignal } from '../traffic/signalRules'
import {
  INTERSECTION_CROSSWALK_IDS,
  INTERSECTION_CROSSWALK_ZONES,
  getIntersectionCrossingSignal,
  getIntersectionForCrossing,
} from '../traffic/intersections/intersectionRegistry'
import { WALK_CROSSING_ZONES } from '../traffic/walkCrossings'
import {
  collectCarViews,
  trafficRuntime,
  type PedestrianRuntime,
} from '../traffic/trafficRuntime'
import type { PedestrianState } from '../traffic/trafficTypes'
import { SpeechBubble } from '../ui3d/SpeechBubble'
import { gateEntitySimulation } from '../world/sectors/sectorSimulation'
import { DESTINATIONS_BY_ID } from './destinations/pedestrianDestinations'
import {
  activityDuration,
  beginNextTrip,
  initCitizenTrips,
  nearestGraphNode,
  recoverTrip,
  resetSingleTrip,
  resumeTrip,
  suspendTrip,
  tripRuntime,
} from './destinations/tripRuntime'
import { worldToSectorId } from '../world/sectors/worldGrid'

/** Live citizen snapshot for debug + the dev/test API. */
export interface CitizenRuntime {
  id: string
  district: string
  x: number
  z: number
  state: PedestrianState | 'hidden'
}

export const ambientCitizenRuntime = new Map<string, CitizenRuntime>()

/**
 * Panic override: a citizen marked by a nearby gunshot sprints AWAY from it
 * (faster than a normal walk), nudged out of any solids so they never flee
 * through a wall. Layered on after normal movement; they resume their route
 * when the panic window expires.
 */
function fleeGunfire(
  s: { pos: Vec2; walking: boolean; heading: number },
  def: AmbientCitizen,
  dt: number,
): void {
  panicFleeStep(s, def.id, def.walkSpeed ?? 1.4, dt, getCrimeGameTime())
}

/**
 * One etiquette, two signal sources: painted central crosswalks follow the
 * legacy shared cycle; signalized-intersection crossings follow their own
 * plan on the SAME global clock. The jaywalk failsafe scales with each
 * intersection's cycle — a 38s split-phase red is a normal wait there.
 */
const ALL_CROSSWALKS = [...CROSSWALKS, ...WALK_CROSSING_ZONES, ...INTERSECTION_CROSSWALK_ZONES]
const ALL_SIGNALLED_IDS: ReadonlySet<string> = new Set([
  ...SIGNALLED_CROSSWALK_IDS,
  ...INTERSECTION_CROSSWALK_IDS,
])
function signalForCrosswalk(id: string): PedestrianSignal {
  if (INTERSECTION_CROSSWALK_IDS.has(id)) {
    return getIntersectionCrossingSignal(id, trafficRuntime.signal.elapsed)
  }
  return getPedestrianSignal(getPhaseAt(trafficRuntime.signal.elapsed).phase)
}
function maxWaitForCrosswalk(id: string): number {
  const x = getIntersectionForCrossing(id)
  return x ? x.cycleLength + 12 : TRAFFIC_TUNING.pedestrianMaxWait
}

/**
 * Dev/test-only placement override: pins a citizen to an exact pose (e.g.
 * mid-crossing) that survives the pause-snap, so visual baselines can
 * photograph crossing states deterministically. Cleared by resetGame.
 */
export const citizenPoseOverrides = new Map<
  string,
  { pos: Vec2; heading: number; state: PedestrianState; crosswalkId: string | null; pending: boolean }
>()

// Shared pieces: one geometry set + a material cache for the whole crowd.
const bodyGeometry = new THREE.CylinderGeometry(0.28, 0.32, 1.0, 8)
const headGeometry = new THREE.SphereGeometry(0.26, 10, 10)
const parcelGeometry = new THREE.BoxGeometry(0.5, 0.35, 0.35)
const materialCache = new Map<string, THREE.MeshStandardMaterial>()
function materialFor(color: string): THREE.MeshStandardMaterial {
  let mat = materialCache.get(color)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
    materialCache.set(color, mat)
  }
  return mat
}
const parcelMaterial = new THREE.MeshStandardMaterial({ color: '#b48a5a', roughness: 0.95 })

const CAR_CLEARANCE = 2.3
const PLAYER_CLEARANCE = 0.85

function CitizenBody({ def, sitting }: { def: AmbientCitizen; sitting: boolean }) {
  return (
    <>
      <mesh
        geometry={bodyGeometry}
        material={materialFor(def.bodyColor)}
        position={[0, sitting ? 0.42 : 0.52, 0]}
        scale={[1, sitting ? 0.68 : 1, 1]}
        castShadow
      />
      <mesh
        geometry={headGeometry}
        material={materialFor(def.headColor)}
        position={[0, sitting ? 0.98 : 1.28, 0]}
        name="citizen-head"
      />
      {def.carriesBox && (
        <mesh
          geometry={parcelGeometry}
          material={parcelMaterial}
          position={[0, 0.78, 0.34]}
          castShadow
        />
      )}
    </>
  )
}

/**
 * One background citizen. Deliberately cheap: refs + shared meshes, a small
 * behavior switch, rare bubbles, and full pedestrian etiquette for walkers.
 * Not an NPC: no dialogue, no contacts, no quests, no save state.
 */
function Citizen({ def }: { def: AmbientCitizen }) {
  const group = useRef<THREE.Group>(null)
  const head = useRef<THREE.Object3D | null>(null)
  const [bubble, setBubble] = useState<string | null>(null)
  // destination_trips: sitting pose while performing a bench activity
  // (rare state flips on arrival/departure only — never per frame).
  const [tripSitting, setTripSitting] = useState(false)

  const rt = useRef({
    pos: [...def.position] as Vec2,
    heading: def.heading ?? 0,
    waypointIndex: 0,
    dwellUntil: 0,
    nextTurnAt: 4 + Math.random() * 5,
    pedState: 'walking_sidewalk' as PedestrianState,
    crosswalkId: null as string | null,
    waitTime: 0,
    walking: false,
    active: true,
    lod: { reducedDt: 0 },
    nextBubbleAt: 20 + Math.random() * 30,
    bubbleUntil: 0,
    pauseSeq: 0,
    tripLastDist: Infinity,
  })

  useEffect(() => {
    const p = rt.current.pos
    registry.npcPositions.set(def.id, new THREE.Vector3(p[0], 0, p[1]))
    ambientCitizenRuntime.set(def.id, {
      id: def.id,
      district: def.district,
      x: p[0],
      z: p[1],
      state: 'idle',
    })
    const walker =
      def.behaviorType === 'loop_walk' ||
      def.behaviorType === 'visit_spot' ||
      def.behaviorType === 'destination_trips'
    if (walker) {
      const ped: PedestrianRuntime = {
        id: def.id,
        x: p[0],
        z: p[1],
        state: 'walking_sidewalk',
        waitingAtCrosswalkId: null,
        crossingCrosswalkId: null,
        waitTime: 0,
      }
      trafficRuntime.pedestrians.set(def.id, ped)
    }
    if (def.behaviorType === 'destination_trips') {
      initCitizenTrips(
        def.id,
        def.position,
        worldToSectorId(def.position[0], def.position[1]),
        def.homeAttachNodeId!,
      )
    }
    // Head lookup for the idle head-turn motion.
    group.current?.traverse((o) => {
      if (o.name === 'citizen-head') head.current = o
    })
    return () => {
      registry.npcPositions.delete(def.id)
      registry.movingPersonIds.delete(def.id)
      trafficRuntime.pedestrians.delete(def.id)
      ambientCitizenRuntime.delete(def.id)
    }
  }, [def])

  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    const store = useGameStore.getState()
    const s = rt.current
    const t = clock.elapsedTime
    const sitting = def.behaviorType === 'sit'

    if (store.worldPaused) {
      // Deterministic snap for visual tests (a test pose override wins).
      if (s.pauseSeq !== registry.pauseSeq) {
        const override = citizenPoseOverrides.get(def.id)
        s.pauseSeq = registry.pauseSeq
        s.pos = override ? ([...override.pos] as Vec2) : ([...def.position] as Vec2)
        s.heading = override ? override.heading : (def.heading ?? 0)
        s.waypointIndex = 0
        s.pedState = override ? override.state : 'walking_sidewalk'
        s.waitTime = 0
        if (def.behaviorType === 'destination_trips') {
          resetSingleTrip(def.id)
          if (tripSitting) setTripSitting(false)
        }
        s.walking = false
        if (bubble) setBubble(null)
        s.active =
          isCitizenActive(def, store.stats.hour) &&
          (!isRaining(weatherRuntime) || isCitizenOutInRain(def))
        g.visible = s.active
        g.position.set(s.pos[0], 0, s.pos[1])
        g.rotation.y = s.heading
        if (head.current) head.current.rotation.y = 0
      }
      return
    }

    // Apply a pending test pose override once (live path — the pause-snap
    // branch reads the same override for deterministic baselines).
    const pendingOverride = citizenPoseOverrides.get(def.id)
    if (pendingOverride?.pending) {
      pendingOverride.pending = false
      s.pos = [...pendingOverride.pos] as Vec2
      s.heading = pendingOverride.heading
      s.pedState = pendingOverride.state
      s.crosswalkId = pendingOverride.crosswalkId
      s.waitTime = 0
    }

    // Sector simulation LOD: dormant sectors hide the citizen and pause the
    // frame work (identity/position/schedule persist); reduced sectors step
    // at ~15 Hz with batched dt. Full sectors run every frame as before.
    const gate = gateEntitySimulation(s.pos[0], s.pos[1], dt, s.lod)
    if (!gate.simulate) {
      if (g.visible) {
        g.visible = false
        registry.npcPositions.delete(def.id)
        registry.movingPersonIds.delete(def.id)
        if (bubble) setBubble(null)
        // Dormant LOD: freeze the trip in place and release the capacity
        // claim (never advance analytically through a crossing).
        if (def.behaviorType === 'destination_trips') suspendTrip(def.id)
      }
      return
    }
    if (def.behaviorType === 'destination_trips' && tripRuntime.trips.get(def.id)?.suspended) {
      // Rematerialize where we froze — a valid point on the former path.
      resumeTrip(def.id, s.pos, { hour: store.stats.hour, raining: isRaining(weatherRuntime), now: t })
    }
    if (gate.stepDt === 0) return // reduced cadence: skip this frame
    dt = gate.stepDt

    // Active hours: off-duty citizens vanish (and stop blocking traffic).
    // Rain sends 'avoid_rain' citizens indoors the same way.
    const raining = isRaining(weatherRuntime)
    const active = isCitizenActive(def, store.stats.hour) && (!raining || isCitizenOutInRain(def))
    if (active && !g.visible && s.active) {
      // Returning from sector dormancy: restore visibility + registration.
      g.visible = true
      registry.npcPositions.set(def.id, new THREE.Vector3(s.pos[0], 0, s.pos[1]))
    }
    if (active !== s.active) {
      s.active = active
      g.visible = active
      if (active) {
        registry.npcPositions.set(def.id, new THREE.Vector3(s.pos[0], 0, s.pos[1]))
      } else {
        registry.npcPositions.delete(def.id)
        registry.movingPersonIds.delete(def.id)
        if (bubble) setBubble(null)
      }
    }
    if (!active) {
      const rec0 = ambientCitizenRuntime.get(def.id)
      if (rec0) rec0.state = 'hidden'
      return
    }

    const walker =
      def.behaviorType === 'loop_walk' ||
      def.behaviorType === 'visit_spot' ||
      def.behaviorType === 'destination_trips'
    // Sheltering walkers detour to the nearest covered spot and wait there.
    const shelter =
      walker && raining && def.weatherBehavior === 'shelter_in_rain'
        ? getNearestShelter(s.pos[0], s.pos[1])
        : null
    let atShelter = false
    if (shelter) {
      const dx = shelter.position[0] - s.pos[0]
      const dz = shelter.position[1] - s.pos[1]
      atShelter = dx * dx + dz * dz < 0.5
      if (atShelter) {
        // Arrived under cover: stand still and wait out the rain.
        s.walking = false
        s.heading = lerpAngle(s.heading, shelter.facing, dt * 5)
      }
    }
    // Crossing-aware destination trips: the plan supplies the waypoints;
    // the SHARED pedestrian etiquette handles every road crossing (legs
    // between crossing curbs pass through the zones by construction).
    const trip = def.behaviorType === 'destination_trips' ? tripRuntime.trips.get(def.id) : undefined
    if (trip && !trip.suspended) {
      const ctx = { hour: store.stats.hour, raining, now: t }
      if (trip.phase === 'selecting_destination') {
        beginNextTrip(trip, trip.homeNodeId, ctx)
      } else if (trip.phase === 'idle_fallback' && t >= trip.activityUntil) {
        beginNextTrip(trip, nearestGraphNode(s.pos), ctx)
      } else if (trip.phase === 'performing_activity' && t >= trip.activityUntil) {
        if (tripSitting) setTripSitting(false)
        const origin = trip.destinationId ?? nearestGraphNode(s.pos)
        trip.phase = 'leaving'
        beginNextTrip(trip, origin, ctx)
      }
      if (trip.phase === 'walking_to_destination' && trip.plan) {
        const target = trip.plan.waypoints[Math.min(trip.waypointIndex, trip.plan.waypoints.length - 1)]
        const decision = decidePedestrian({
          state: s.pedState,
          position: s.pos,
          target,
          waitTime: s.waitTime,
          crosswalks: ALL_CROSSWALKS,
          cars: collectCarViews(),
          pedestrianSignal: getPedestrianSignal(getPhaseAt(trafficRuntime.signal.elapsed).phase),
          signalledCrosswalkIds: ALL_SIGNALLED_IDS,
          signalForCrosswalk,
          maxWaitForCrosswalk,
        })
        s.pedState = decision.state
        s.crosswalkId = decision.crosswalkId
        s.waitTime = decision.state === 'waiting_to_cross' ? s.waitTime + dt : 0
        if (decision.mayMove) {
          const speed = (def.walkSpeed ?? 1.4) * (s.pedState === 'crossing' ? 1.25 : 1)
          const res = moveTowards(s.pos, target, speed * Math.min(dt, 0.1))
          s.pos = res.position
          s.walking = !res.arrived
          if (!res.arrived) {
            s.heading = lerpAngle(s.heading, Math.atan2(res.direction[0], res.direction[1]), dt * 8)
            // No-progress detector: legitimate crossing waits never count.
            const dist = Math.hypot(target[0] - s.pos[0], target[1] - s.pos[1])
            if (dist < s.tripLastDist - 0.05) {
              s.tripLastDist = dist
              trip.noProgressTime = 0
            } else {
              trip.noProgressTime += dt
              if (trip.noProgressTime > 45) {
                recoverTrip(trip, s.pos, ctx)
                s.tripLastDist = Infinity
              }
            }
          } else {
            trip.waypointIndex += 1
            trip.noProgressTime = 0
            s.tripLastDist = Infinity
            if (s.pedState === 'crossing') s.pedState = 'walking_sidewalk'
            if (trip.waypointIndex >= trip.plan.waypoints.length) {
              trip.phase = 'performing_activity'
              trip.tripsCompleted += 1
              trip.recoveryStage = 0
              trip.activityUntil = t + activityDuration(trip)
              const dest = trip.destinationId ? DESTINATIONS_BY_ID.get(trip.destinationId) : undefined
              if (dest?.arrivalHeading !== undefined) s.heading = dest.arrivalHeading
              if (dest?.arrivalBehavior === 'sit' && !tripSitting) setTripSitting(true)
              s.walking = false
            }
          }
        } else {
          s.walking = false
          s.heading = lerpAngle(
            s.heading,
            Math.atan2(target[0] - s.pos[0], target[1] - s.pos[1]),
            dt * 5,
          )
        }
        // Same physical courtesies as every walker.
        for (const car of registry.ambientCarPositions.values()) {
          const pushed = pushOutOfCircle(
            { x: s.pos[0], z: s.pos[1] },
            { x: car.x, z: car.z },
            CAR_CLEARANCE,
            dt * 6,
          )
          if (pushed) s.pos = [pushed.x, pushed.z]
        }
        if (store.mode === 'walking') {
          const pushed = pushOutOfCircle(
            { x: s.pos[0], z: s.pos[1] },
            { x: registry.playerPosition.x, z: registry.playerPosition.z },
            PLAYER_CLEARANCE,
            dt * 6,
          )
          if (pushed) s.pos = [pushed.x, pushed.z]
        }
        fleeGunfire(s, def, dt)
      } else {
        s.walking = false
      }
    }

    if (walker && def.waypoints && t >= s.dwellUntil && !atShelter) {
      const target = shelter ? shelter.position : def.waypoints[s.waypointIndex % def.waypoints.length]
      const decision = decidePedestrian({
        state: s.pedState,
        position: s.pos,
        target,
        waitTime: s.waitTime,
        crosswalks: ALL_CROSSWALKS,
        cars: collectCarViews(),
        pedestrianSignal: getPedestrianSignal(getPhaseAt(trafficRuntime.signal.elapsed).phase),
        signalledCrosswalkIds: ALL_SIGNALLED_IDS,
        signalForCrosswalk,
        maxWaitForCrosswalk,
      })
      s.pedState = decision.state
      s.crosswalkId = decision.crosswalkId
      s.waitTime = decision.state === 'waiting_to_cross' ? s.waitTime + dt : 0
      if (decision.mayMove) {
        const speed = (def.walkSpeed ?? 1.4) * (s.pedState === 'crossing' ? 1.25 : 1)
        const res = moveTowards(s.pos, target, speed * Math.min(dt, 0.1))
        s.pos = res.position
        s.walking = !res.arrived
        if (!res.arrived) {
          s.heading = lerpAngle(s.heading, Math.atan2(res.direction[0], res.direction[1]), dt * 8)
        } else {
          s.waypointIndex = (s.waypointIndex + 1) % def.waypoints.length
          if (s.pedState === 'crossing') s.pedState = 'walking_sidewalk'
          if (def.behaviorType === 'visit_spot') s.dwellUntil = t + 3.5 + Math.random() * 4
        }
      } else {
        s.walking = false
        s.heading = lerpAngle(
          s.heading,
          Math.atan2(target[0] - s.pos[0], target[1] - s.pos[1]),
          dt * 5,
        )
      }
      // Never get swallowed by a car while standing near roads.
      for (const car of registry.ambientCarPositions.values()) {
        const pushed = pushOutOfCircle(
          { x: s.pos[0], z: s.pos[1] },
          { x: car.x, z: car.z },
          CAR_CLEARANCE,
          dt * 6,
        )
        if (pushed) s.pos = [pushed.x, pushed.z]
      }
      // …nor walk straight through the on-foot player.
      if (store.mode === 'walking') {
        const pushed = pushOutOfCircle(
          { x: s.pos[0], z: s.pos[1] },
          { x: registry.playerPosition.x, z: registry.playerPosition.z },
          PLAYER_CLEARANCE,
          dt * 6,
        )
        if (pushed) s.pos = [pushed.x, pushed.z]
      }
      fleeGunfire(s, def, dt)
    } else if (def.behaviorType === 'idle_stand' && t >= s.nextTurnAt) {
      // Occasionally shift to face a new direction.
      s.nextTurnAt = t + 4 + Math.random() * 5
      s.heading = (def.heading ?? 0) + (Math.random() - 0.5) * 1.4
    }

    // Universal post-movement occupancy: EVERY citizen (walking, idle, queueing,
    // waiting to cross) separates here, so co-located idlers no longer overlap.
    resolvePersonSpacing(s.pos, def.id, dt, s.walking)

    // Small ambient motion by behavior.
    const wobble =
      def.behaviorType === 'queue'
        ? Math.sin(t * 0.6) * 0.05
        : def.behaviorType === 'idle_stand'
          ? Math.sin(t * 0.35) * 0.02
          : 0
    const bob = s.walking ? Math.abs(Math.sin(t * 8)) * 0.06 : 0
    g.position.set(s.pos[0] + wobble, bob, s.pos[1])
    g.rotation.y = lerpAngle(g.rotation.y, s.heading, Math.min(1, dt * 6))
    if (head.current && (sitting || def.behaviorType === 'idle_stand')) {
      head.current.rotation.y = Math.sin(t * 0.4 + def.position[0]) * 0.45
    }

    // Rare bubble barks.
    if (bubble && t > s.bubbleUntil) setBubble(null)
    else if (!bubble && t > s.nextBubbleAt && def.bubbleLines?.length) {
      setBubble(def.bubbleLines[Math.floor(Math.random() * def.bubbleLines.length)])
      s.bubbleUntil = t + 3
      s.nextBubbleAt = t + 30 + Math.random() * 40
    }

    // Publish live positions for cars/debug/tests.
    registry.npcPositions.get(def.id)?.set(s.pos[0], 0, s.pos[1])
    // Track walking state so person-separation only steers moving-vs-moving.
    if (s.walking) registry.movingPersonIds.add(def.id)
    else registry.movingPersonIds.delete(def.id)
    const ped = trafficRuntime.pedestrians.get(def.id)
    if (ped) {
      ped.x = s.pos[0]
      ped.z = s.pos[1]
      ped.state = s.pedState
      ped.waitingAtCrosswalkId = s.pedState === 'waiting_to_cross' ? s.crosswalkId : null
      ped.crossingCrosswalkId = s.pedState === 'crossing' ? s.crosswalkId : null
      ped.waitTime = s.waitTime
    }
    const rec = ambientCitizenRuntime.get(def.id)
    if (rec) {
      rec.x = s.pos[0]
      rec.z = s.pos[1]
      rec.state = walker ? s.pedState : 'idle'
    }
  })

  return (
    <group ref={group} name={`citizen:${def.id}`} position={[def.position[0], 0, def.position[1]]}>
      <CitizenBody def={def} sitting={def.behaviorType === 'sit' || tripSitting} />
      {bubble && <SpeechBubble text={bubble} offset={2} />}
    </group>
  )
}

/** The whole background crowd — data-driven, shared meshes, no physics. */
export function AmbientCitizens() {
  return (
    <group name="ambient-citizens">
      {AMBIENT_CITIZENS.map((def) => (
        <Citizen key={def.id} def={def} />
      ))}
    </group>
  )
}
