import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { AmbientCarDef } from './worldTypes'
import { moveTowards } from '../npc/npcBehavior'
import { CarMesh } from '../vehicles/CarMesh'
import { useGameStore } from '../store/useGameStore'
import { registry } from './runtimeRegistry'
import { approach, lerpAngle } from '../utils/math'
import { TRAFFIC_TUNING } from '../traffic/trafficData'
import {
  classifyCarState,
  decideCarTargetSpeed,
  gradeSpeedForDistance,
  shouldHonk,
} from '../traffic/trafficRules'
import { getSignalStopDecision, getPhaseAt, getVehicleSignal } from '../traffic/signalRules'
import { trafficRuntime, type CarRuntime } from '../traffic/trafficRuntime'
import {
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  type VehicleFootprint,
} from '../traffic/vehicleObstacles'
import { brakeLightMaterial, taillightMaterial } from './materials'
import { audioManager } from '../audio/AudioManager'
import { getBlendedModifiers, weatherRuntime } from '../weather/weatherSystem'
import { SpeechBubble } from '../ui3d/SpeechBubble'
import { collectPointObstacles, collectVehicleFootprints } from './carSensors'
import { getRedIntersectionStopLine } from '../traffic/intersections/intersectionRegistry'
import { headingAtProgress, getRoadGraph, pointAtProgress } from '../traffic/routing/roadGraphBuilder'
import {
  advanceRouteCursor,
  currentSegment,
  getCurrentRouteTarget,
  measureRouteDeviation,
} from '../traffic/routing/routeProgress'
import {
  HOLD_STOP_SHORT,
  getDesiredLaneSpeed,
  getRouteCrosswalks,
  getRouteLaneView,
  getRouteStopLines,
  getRouteStopSigns,
  isRouteSignalled,
  shouldHoldBeforeJunction,
} from '../traffic/routing/routeFollow'
import {
  anchorCursorAtProgress,
  chooseDestination,
  consumeForcedDestination,
  handleDestinationArrival,
  initializeRoutedVehicle,
  pickRespawnPoint,
  planStateRoute,
  respawnRoutedVehicle,
} from '../traffic/routing/routeLifecycle'
import {
  checkMissedTurn,
  findNearestSegment,
  updateRecovery,
} from '../traffic/routing/routeRecovery'
import { routeRuntime, type VehicleRouteState } from '../traffic/routing/routeRuntime'
import { updateCongestionSnapshot } from '../traffic/routing/congestionSnapshot'
import { getSectorForRoadSegment } from '../traffic/routing/segmentSectors'
import {
  getSectorRuntimeState,
  isSectorMounted,
  isStreamingActive,
} from './sectors/sectorStreaming'

/**
 * One route-following ambient car. The EXISTING decision engine still owns
 * braking / yielding / signals / following — this component swaps only the
 * source of "where do I drive next": planned graph segments instead of a
 * fixed loop. Registered in trafficRuntime.cars like every other car, so
 * loop cars, routed cars and the player all see each other.
 */

/** Temporary penalty put on the blocked next segment during a stage-2 replan. */
const REPLAN_BLOCK_PENALTY_SET = new Set<string>()

export function RoutedCar({ def }: { def: AmbientCarDef }) {
  const graph = getRoadGraph()
  const group = useRef<THREE.Group>(null)
  const [honking, setHonking] = useState(false)

  const local = useRef({
    pos: [0, 0] as [number, number],
    heading: 0,
    speed: 0,
    blockedTime: 0,
    lastHonkAt: -Infinity,
    honkUntil: 0,
    braking: false,
    yieldStartedAt: new Map<string, number>(),
    expiredYields: new Set<string>(),
    signHold: new Map<string, number>(),
    clearedSigns: new Set<string>(),
    selfFootprint: {
      id: def.id,
      kind: 'ambient',
      position: { x: 0, z: 0 },
      heading: 0,
      halfLength: CAR_HALF_LENGTH,
      halfWidth: CAR_HALF_WIDTH,
      speed: 0,
    } as VehicleFootprint,
    taillights: [] as THREE.Mesh[],
    pauseSeq: 0,
    fleetResetSeq: routeRuntime.fleetResetSeq,
    route: null as VehicleRouteState | null,
  })

  /** (Re)initialize pose + route from the assigned spawn point. */
  const bootstrap = () => {
    const s = local.current
    const spawned = initializeRoutedVehicle(
      graph,
      def.id,
      def.routeMode ?? 'crossDistrict',
      def.routeSpawnId ?? '',
    )
    if (!spawned) return false
    s.route = spawned.state
    routeRuntime.states.set(def.id, spawned.state)
    s.pos = [spawned.position[0], spawned.position[1]]
    s.heading = spawned.heading
    s.speed = 0
    s.blockedTime = 0
    s.signHold.clear()
    s.clearedSigns.clear()
    return true
  }

  useEffect(() => {
    const s = local.current
    if (!bootstrap()) {
      if (import.meta.env.DEV) console.warn(`[routing] ${def.id} failed to initialize a route`)
      return
    }
    registry.ambientCarPositions.set(def.id, new THREE.Vector3(s.pos[0], 0, s.pos[1]))
    const runtime: CarRuntime = {
      id: def.id,
      laneId: def.laneId,
      x: s.pos[0],
      z: s.pos[1],
      heading: s.heading,
      speed: 0,
      targetSpeed: 0,
      state: 'stopped',
      reason: 'clear',
      blockedTime: 0,
      lastHonkAt: -Infinity,
    }
    trafficRuntime.cars.set(def.id, runtime)
    s.taillights.length = 0
    group.current?.traverse((o) => {
      if (o.name === 'taillight') s.taillights.push(o as THREE.Mesh)
    })
    return () => {
      registry.ambientCarPositions.delete(def.id)
      trafficRuntime.cars.delete(def.id)
      routeRuntime.states.delete(def.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id])

  useFrame(({ clock }, dt) => {
    const g = group.current
    const runtime = trafficRuntime.cars.get(def.id)
    const s = local.current
    const route = s.route
    if (!g || !runtime || !route) return
    const now = clock.elapsedTime

    if (useGameStore.getState().worldPaused) {
      // Deterministic pause snap: back to the spawn pose with the seeded
      // initial route (mirrors loop cars snapping to their loop start).
      if (s.pauseSeq !== registry.pauseSeq) {
        s.pauseSeq = registry.pauseSeq
        routeRuntime.states.delete(def.id)
        bootstrap()
        g.position.set(s.pos[0], 0, s.pos[1])
        g.rotation.y = s.heading
        registry.ambientCarPositions.get(def.id)?.set(s.pos[0], 0, s.pos[1])
        setBrakeLights(s, false)
        if (honking) setHonking(false)
      }
      return
    }

    // Seed change (dev/test): rebuild the whole plan deterministically.
    if (s.fleetResetSeq !== routeRuntime.fleetResetSeq) {
      s.fleetResetSeq = routeRuntime.fleetResetSeq
      routeRuntime.states.delete(def.id)
      bootstrap()
    }

    // ---- Traffic simulation LOD (sector streaming) ----------------------
    // DORMANT: the current segment's sector is not mounted. The car keeps
    // its full logical route state and advances ANALYTICALLY (conservative
    // fraction of the limit, no sensors — there is nothing rendered to
    // sense), hidden. REMATERIALIZATION: when the sector mounts again the
    // car reappears only at a collision-free point; while another car
    // overlaps the spot it simply holds, still hidden.
    if (isStreamingActive()) {
      const segId = route.route?.segmentIds[route.segmentIndex]
      const segSector = segId ? getSectorForRoadSegment(segId)?.primarySectorId : undefined
      const sectorState = segSector ? getSectorRuntimeState(segSector) : undefined
      const sectorMounted = !sectorState || isSectorMounted(sectorState)
      if (!sectorMounted) {
        if (g.visible) g.visible = false
        const seg = currentSegment(graph, route)
        const target = getCurrentRouteTarget(graph, route)
        if (seg && target) {
          const dormantSpeed = seg.speedLimit * 0.6
          const res = moveTowards(s.pos, [target[0], target[1]], dormantSpeed * Math.min(dt, 0.1))
          s.pos = res.position
          s.heading = Math.atan2(target[0] - s.pos[0], target[1] - s.pos[1]) || s.heading
          if (res.arrived) {
            const advance = advanceRouteCursor(graph, route)
            if (advance.kind === 'arrived') {
              const outcome = handleDestinationArrival(graph, route)
              if (outcome === 'despawn' || outcome === 'stranded') performRespawn(route, s)
            }
          }
        }
        runtime.x = s.pos[0]
        runtime.z = s.pos[1]
        runtime.heading = s.heading
        runtime.speed = 0 // dormant cars are invisible to sensing by speed
        runtime.state = 'cruising'
        registry.ambientCarPositions.get(def.id)?.set(s.pos[0], 0, s.pos[1])
        route.blockageReason = 'none'
        return
      }
      if (!g.visible) {
        // Rematerialize only into free space.
        const occupied = [...trafficRuntime.cars.values()].some(
          (other) => other.id !== def.id && Math.hypot(other.x - s.pos[0], other.z - s.pos[1]) < 4.5,
        )
        if (occupied) return // hold hidden; try again next frame
        g.visible = true
        g.position.set(s.pos[0], 0, s.pos[1])
      }
    }

    // Dev/test repositioning: treat as a teleport — stale route state must
    // never survive a position jump.
    const override = trafficRuntime.carOverrides.get(def.id)
    if (override) {
      trafficRuntime.carOverrides.delete(def.id)
      s.pos = [override.position[0], override.position[1]]
      const nearest = findNearestSegment(graph, s.pos[0], s.pos[1], 8)
      const current = s.route
      if (nearest && current) {
        const destination =
          consumeForcedDestination(current.vehicleId) ??
          current.destinationId ??
          chooseDestination(graph, current, undefined) ??
          ''
        if (
          destination &&
          planStateRoute(graph, current, nearest.segmentId, nearest.progress, destination)
        ) {
          anchorCursorAtProgress(graph, current, nearest.progress)
          current.replanCount += 1
        }
        // A teleport must also reset the HEADING to the landing lane's
        // direction — a stale heading leaves the awareness cone facing
        // backward, and two nose-to-tail cars freeze in a mutual stare.
        const landed = graph.segments.get(nearest.segmentId)
        if (landed) s.heading = headingAtProgress(landed, nearest.progress)
      }
      s.speed = 0
    }

    // Dev/test replan request.
    if (routeRuntime.replanRequests.has(def.id)) {
      routeRuntime.replanRequests.delete(def.id)
      replanFromHere(route, s.pos, false)
    }

    updateCongestionSnapshot(graph, now)

    s.selfFootprint.position.x = s.pos[0]
    s.selfFootprint.position.z = s.pos[1]
    s.selfFootprint.heading = s.heading
    s.selfFootprint.speed = s.speed

    const seg = currentSegment(graph, route)
    const routeInvalid = !seg || route.route === null
    const target = routeInvalid ? null : getCurrentRouteTarget(graph, route)

    // Continuous progress from the car's REAL position (waypoint-cursor
    // progress only updates at arrivals — on a straight 2-point lane it
    // would sit at 0 the whole way, blinding turn anticipation and the
    // junction holds until the very endpoint).
    const deviation = seg
      ? measureRouteDeviation(graph, route, s.pos[0], s.pos[1])
      : null
    if (deviation && !deviation.offLane && deviation.progress > route.segmentProgress) {
      route.segmentProgress = deviation.progress
    }

    // Follower context → the shared decision engine.
    const weatherFactor = getBlendedModifiers(weatherRuntime).trafficSpeedFactor
    const distanceToEnd =
      seg && deviation ? (1 - deviation.progress) * seg.length : (seg?.length ?? 0)
    const cruise =
      getDesiredLaneSpeed(graph, route, def.speedFactor, distanceToEnd) * weatherFactor
    const laneView = seg ? getRouteLaneView(seg) : null
    const phase = getPhaseAt(trafficRuntime.signal.elapsed).phase
    const signalled = isRouteSignalled(graph, route)
    const stopSigns = getRouteStopSigns(graph, route)
    const vehicles = collectVehicleFootprints(def.id)
    const decision = laneView
      ? decideCarTargetSpeed({
          position: s.selfFootprint.position,
          heading: s.heading,
          cruiseSpeed: cruise,
          lane: laneView,
          obstacles: collectPointObstacles(),
          vehicles,
          selfFootprint: s.selfFootprint,
          crosswalks: getRouteCrosswalks(graph, route),
          vehicleSignal: signalled ? getVehicleSignal(phase) : null,
          stopLines: getRouteStopLines(graph, route),
          stopSigns,
          clearedStopSigns: s.clearedSigns,
          expiredYields: s.expiredYields,
        })
      : null

    // Anti-gridlock: hold BEFORE the junction when its box is occupied or
    // its exit is stuffed. Graded to stop the car's nose short of the box —
    // a held car must never clip the crossing lane inside it.
    const holdCheck = shouldHoldBeforeJunction(graph, route, distanceToEnd, vehicles, def.id)
    let targetSpeed = decision ? decision.targetSpeed : 0
    // Signalized cross-street: a red approach clamps to its stop line.
    // Benign by design — same 'signal' classification as the central light,
    // so a red wait can never trigger route recovery or replanning.
    const redLine = getRedIntersectionStopLine(route, trafficRuntime.signal.elapsed)
    let intersectionRed = false
    if (redLine) {
      const redTarget = getSignalStopDecision(
        s.selfFootprint.position,
        s.heading,
        'red',
        redLine,
        cruise,
      )
      if (redTarget !== null && redTarget < targetSpeed) {
        targetSpeed = redTarget
        intersectionRed = true
      }
    }
    // When the red clamp is the binding constraint the decision engine saw
    // nothing ('clear') — recovery must still classify the wait as 'signal'
    // or suspectTime escalates through replan/respawn at every long red.
    const effectiveReason = intersectionRed ? ('signal' as const) : (decision?.reason ?? 'clear')
    if (holdCheck.hold) {
      const holdTarget = gradeSpeedForDistance(
        Math.max(0, distanceToEnd - HOLD_STOP_SHORT),
        0.4,
        4,
        cruise,
      )
      targetSpeed = Math.min(targetSpeed, holdTarget)
    }

    // Stop-sign etiquette (same behavior as loop cars).
    for (const sign of stopSigns) {
      const d =
        (sign.position[0] - s.pos[0]) * sign.direction[0] +
        (sign.position[1] - s.pos[1]) * sign.direction[1]
      if (d < -1) {
        s.clearedSigns.delete(sign.id)
        s.signHold.delete(sign.id)
      } else if (decision?.reason === 'stop_sign' && decision.stopSignId === sign.id && s.speed < 0.2) {
        const held = (s.signHold.get(sign.id) ?? 0) + dt
        s.signHold.set(sign.id, held)
        if (held >= sign.holdSeconds) s.clearedSigns.add(sign.id)
      }
    }

    // Courtesy-yield patience on unsignalled crossings.
    if (decision?.reason === 'crosswalk' && decision.crosswalkId) {
      const started = s.yieldStartedAt.get(decision.crosswalkId) ?? now
      s.yieldStartedAt.set(decision.crosswalkId, started)
      const status = getRouteCrosswalks(graph, route).find((c) => c.id === decision.crosswalkId)
      if (status && !status.occupied && now - started > TRAFFIC_TUNING.yieldPatience) {
        s.expiredYields.add(decision.crosswalkId)
      }
    } else {
      s.yieldStartedAt.clear()
      s.expiredYields.clear()
    }

    // Smooth braking/resume; emergency contact freezes in place.
    if (decision?.emergencyContact) {
      s.speed = 0
    } else {
      s.speed = approach(
        s.speed,
        targetSpeed,
        (targetSpeed < s.speed ? TRAFFIC_TUNING.braking : TRAFFIC_TUNING.acceleration) * dt,
      )
    }

    // Honks: at people or the player's car, never at queues or lights.
    const honkWorthy =
      targetSpeed === 0 &&
      s.speed < 0.2 &&
      decision !== null &&
      (decision.reason === 'obstacle' ||
        (decision.reason === 'follow' && decision.blockingVehicleKind === 'driven'))
    if (honkWorthy) {
      s.blockedTime += dt
      if (shouldHonk(s.blockedTime, now, s.lastHonkAt)) {
        s.lastHonkAt = now
        s.honkUntil = now + TRAFFIC_TUNING.honkDuration
        setHonking(true)
        audioManager.playHonk()
      }
    } else {
      s.blockedTime = 0
    }
    if (honking && now > s.honkUntil) setHonking(false)

    // Advance along the route.
    if (!decision?.emergencyContact && s.speed > 0 && target) {
      const res = moveTowards(s.pos, [target[0], target[1]], s.speed * Math.min(dt, 0.1))
      s.pos = res.position
      if (res.arrived) {
        const advance = advanceRouteCursor(graph, route)
        if (advance.kind === 'arrived') {
          const outcome = handleDestinationArrival(graph, route)
          if (outcome === 'despawn' || outcome === 'stranded') {
            performRespawn(route, s)
          }
        }
      } else if (s.speed > 0.1) {
        const targetHeading = Math.atan2(res.direction[0], res.direction[1])
        s.heading = lerpAngle(s.heading, targetHeading, dt * 6)
      }
      if (seg) {
        // Progress bookkeeping for debug + blockage detection.
        const moved = Math.hypot(s.pos[0] - route.lastProgressX, s.pos[1] - route.lastProgressZ)
        if (moved > 0.5) {
          route.lastProgressAt = now
          route.lastProgressX = s.pos[0]
          route.lastProgressZ = s.pos[1]
        }
      }
    }

    // Missed-turn / off-corridor handling (cheap: one projection per frame).
    const missed = checkMissedTurn(graph, route, s.pos[0], s.pos[1])
    if (missed.kind === 'needsReplan') {
      replanFromHere(route, s.pos, false)
    }

    // Staged recovery driven by real no-progress time.
    const recovery = updateRecovery(
      graph,
      route,
      {
        reason: effectiveReason,
        blockingVehicleKind: decision?.blockingVehicleKind ?? null,
        downstreamHold: holdCheck.hold,
        offLane: missed.kind === 'lost',
        routeInvalid,
        emergencyContact: decision?.emergencyContact ?? false,
        speed: s.speed,
        targetSpeed,
      },
      now,
      dt,
    )
    if (recovery.kind === 'refreshTarget') {
      anchorCursorAtProgress(graph, route, route.segmentProgress)
    } else if (recovery.kind === 'replan') {
      replanFromHere(route, s.pos, recovery.penalizeNextSegment)
    } else if (recovery.kind === 'projectToLane') {
      const nearest = findNearestSegment(graph, s.pos[0], s.pos[1], 10)
      if (nearest) {
        const nearestSeg = graph.segments.get(nearest.segmentId)!
        const [px, pz] = pointAtProgress(nearestSeg, nearest.progress)
        // Never project into another vehicle.
        const occupied = vehicles.some(
          (v) => Math.hypot(v.position.x - px, v.position.z - pz) < 4,
        )
        if (!occupied) {
          s.pos = [px, pz]
          replanFromHere(route, s.pos, false)
        }
      }
    } else if (recovery.kind === 'respawn') {
      performRespawn(route, s)
    }

    g.position.set(s.pos[0], 0, s.pos[1])
    g.rotation.y = s.heading
    registry.ambientCarPositions.get(def.id)?.set(s.pos[0], 0, s.pos[1])

    const braking = targetSpeed < s.speed - 0.25 || (targetSpeed === 0 && s.speed < 0.5)
    if (braking !== s.braking) setBrakeLights(s, braking)

    runtime.x = s.pos[0]
    runtime.z = s.pos[1]
    runtime.heading = s.heading
    runtime.speed = s.speed
    runtime.targetSpeed = targetSpeed
    runtime.reason = effectiveReason
    runtime.blockedTime = s.blockedTime
    runtime.lastHonkAt = s.lastHonkAt
    runtime.state = classifyCarState({
      speed: s.speed,
      targetSpeed,
      cruiseSpeed: cruise,
      reason: effectiveReason,
      blockedTime: s.blockedTime,
    })
  })

  /** Replan from the nearest lane point (forced destination wins). */
  function replanFromHere(
    route: VehicleRouteState,
    pos: [number, number],
    penalizeNextSegment: boolean,
  ): void {
    const nearest = findNearestSegment(graph, pos[0], pos[1], 10)
    if (!nearest) return
    const destination =
      consumeForcedDestination(route.vehicleId) ??
      route.destinationId ??
      chooseDestination(graph, route, undefined)
    if (!destination) return
    REPLAN_BLOCK_PENALTY_SET.clear()
    if (penalizeNextSegment) {
      const nextId = route.route?.segmentIds[route.segmentIndex + 1]
      if (nextId) REPLAN_BLOCK_PENALTY_SET.add(nextId)
    }
    if (
      planStateRoute(graph, route, nearest.segmentId, nearest.progress, destination, REPLAN_BLOCK_PENALTY_SET)
    ) {
      anchorCursorAtProgress(graph, route, nearest.progress)
      route.replanCount += 1
    }
  }

  /** Relocate to a validated free spawn point with a fresh route. */
  function performRespawn(route: VehicleRouteState, s: (typeof local)['current']): void {
    const camera = registry.playerPosition
    const spawn = pickRespawnPoint(graph, route, {
      avoid: { x: camera.x, z: camera.z, radius: 24 },
      isOccupied: (x, z) => {
        for (const other of trafficRuntime.cars.values()) {
          if (other.id === def.id) continue
          if (Math.hypot(other.x - x, other.z - z) < 6) return true
        }
        return Math.hypot(registry.vehiclePosition.x - x, registry.vehiclePosition.z - z) < 6
      },
    })
    if (!spawn) return
    const spawned = respawnRoutedVehicle(graph, route, spawn)
    if (!spawned) return
    s.pos = [spawned.position[0], spawned.position[1]]
    s.heading = spawned.heading
    s.speed = 0
  }

  return (
    <group ref={group} name={def.id}>
      <CarMesh color={def.color} />
      {honking && <SpeechBubble text="beep beep!" offset={2.4} />}
    </group>
  )
}

function setBrakeLights(
  s: { taillights: THREE.Mesh[]; braking: boolean },
  braking: boolean,
): void {
  s.braking = braking
  for (const light of s.taillights) {
    light.material = braking ? brakeLightMaterial : taillightMaterial
  }
}
