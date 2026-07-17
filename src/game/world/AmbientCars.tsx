import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { AMBIENT_CARS } from './cityLayout'
import type { AmbientCarDef } from './worldTypes'
import { moveTowards } from '../npc/npcBehavior'
import { CarMesh } from '../vehicles/CarMesh'
import { useGameStore } from '../store/useGameStore'
import { registry } from './runtimeRegistry'
import { approach, lerpAngle } from '../utils/math'
import {
  CROSSWALKS,
  LANES_BY_ID,
  STOP_LINES_BY_LANE,
  STOP_SIGNS_BY_LANE,
  TRAFFIC_TUNING,
} from '../traffic/trafficData'
import { classifyCarState, decideCarTargetSpeed, shouldHonk } from '../traffic/trafficRules'
import { getPhaseAt, getVehicleSignal } from '../traffic/signalRules'
import type { CrosswalkStatusView } from '../traffic/trafficTypes'
import {
  getCrosswalkStatus,
  trafficRuntime,
  type CarRuntime,
} from '../traffic/trafficRuntime'
import {
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  type VehicleFootprint,
} from '../traffic/vehicleObstacles'
import { brakeLightMaterial, taillightMaterial } from './materials'
import { audioManager } from '../audio/AudioManager'
import { getBlendedModifiers, weatherRuntime } from '../weather/weatherSystem'
import { SpeechBubble } from '../ui3d/SpeechBubble'
import { RoutedCar } from './RoutedCar'
import { collectPointObstacles, collectVehicleFootprints } from './carSensors'

// Crosswalk scratch reused every frame — no per-frame allocation churn.
// (Point-obstacle and vehicle-footprint collectors live in carSensors.ts,
// shared with the routed cars.)
const crosswalkScratch: CrosswalkStatusView[] = []

function collectLaneCrosswalks(laneId: string): CrosswalkStatusView[] {
  crosswalkScratch.length = 0
  for (const zone of CROSSWALKS) {
    if (zone.affectedLaneIds.includes(laneId)) {
      crosswalkScratch.push(getCrosswalkStatus(zone))
    }
  }
  return crosswalkScratch
}

/**
 * One ambient car: follows its lane, brakes for pedestrians, keeps real
 * following distance from other vehicles (including the player's car,
 * measured footprint-to-footprint so bodies never interpenetrate), obeys
 * the traffic signal at stop lines, yields at crosswalks, shows brake
 * lights, and honks politely when blocked. Kinematic — no physics.
 */
function AmbientCar({ def }: { def: AmbientCarDef }) {
  const lane = LANES_BY_ID[def.laneId]
  const cruiseSpeed = lane.speedLimit * def.speedFactor
  const group = useRef<THREE.Group>(null)
  const [honking, setHonking] = useState(false)

  const state = useRef({
    pos: [lane.waypoints[def.startIndex][0], lane.waypoints[def.startIndex][1]] as [number, number],
    targetIndex: (def.startIndex + 1) % lane.waypoints.length,
    // Face the direction of travel from frame one — a car that spawns
    // "looking" the wrong way can mistake an oncoming car for a leader
    // and freeze before it ever moves.
    heading: Math.atan2(
      lane.waypoints[(def.startIndex + 1) % lane.waypoints.length][0] -
        lane.waypoints[def.startIndex][0],
      lane.waypoints[(def.startIndex + 1) % lane.waypoints.length][1] -
        lane.waypoints[def.startIndex][1],
    ),
    speed: 0,
    blockedTime: 0,
    lastHonkAt: -Infinity,
    honkUntil: 0,
    braking: false,
    yieldStartedAt: new Map<string, number>(),
    expiredYields: new Set<string>(),
    /** Stop-sign etiquette: hold timers and signs already stopped for. */
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
  })

  useEffect(() => {
    const s = state.current
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
    // Collect taillight meshes once for imperative brake-light swaps.
    s.taillights.length = 0
    group.current?.traverse((o) => {
      if (o.name === 'taillight') s.taillights.push(o as THREE.Mesh)
    })
    return () => {
      registry.ambientCarPositions.delete(def.id)
      trafficRuntime.cars.delete(def.id)
    }
  }, [def.id, def.laneId])

  useFrame(({ clock }, dt) => {
    const g = group.current
    const runtime = trafficRuntime.cars.get(def.id)
    if (!g || !runtime) return
    const s = state.current

    if (useGameStore.getState().worldPaused) {
      // Snap back to the start of the loop once per pause for determinism.
      if (s.pauseSeq !== registry.pauseSeq) {
        s.pauseSeq = registry.pauseSeq
        s.pos = [lane.waypoints[def.startIndex][0], lane.waypoints[def.startIndex][1]]
        s.targetIndex = (def.startIndex + 1) % lane.waypoints.length
        s.speed = 0
        s.blockedTime = 0
        s.signHold.clear()
        s.clearedSigns.clear()
        const to = lane.waypoints[s.targetIndex]
        s.heading = Math.atan2(to[0] - s.pos[0], to[1] - s.pos[1])
        g.position.set(s.pos[0], 0, s.pos[1])
        g.rotation.y = s.heading
        registry.ambientCarPositions.get(def.id)?.set(s.pos[0], 0, s.pos[1])
        setBrakeLights(s, false)
        if (honking) setHonking(false)
      }
      return
    }

    // Dev/test repositioning (consumed once). The car keeps rolling at its
    // cruise speed so scenario setups behave like real mid-drive traffic.
    const override = trafficRuntime.carOverrides.get(def.id)
    if (override) {
      trafficRuntime.carOverrides.delete(def.id)
      s.pos = [override.position[0], override.position[1]]
      if (override.targetIndex !== undefined) s.targetIndex = override.targetIndex
      const to = lane.waypoints[s.targetIndex]
      s.heading = Math.atan2(to[0] - s.pos[0], to[1] - s.pos[1])
      s.speed = cruiseSpeed
    }

    s.selfFootprint.position.x = s.pos[0]
    s.selfFootprint.position.z = s.pos[1]
    s.selfFootprint.heading = s.heading
    s.selfFootprint.speed = s.speed

    // Rain/fog slow the whole flow of traffic a touch (10–20% in rain).
    const weatherCruise = cruiseSpeed * getBlendedModifiers(weatherRuntime).trafficSpeedFactor

    const phase = getPhaseAt(trafficRuntime.signal.elapsed).phase
    const laneSigns = STOP_SIGNS_BY_LANE[def.laneId] ?? []
    // Lanes off the shared signal (e.g. the residential street) pass null so
    // the unsignalled courtesy-yield etiquette from v1 applies there.
    const laneSignalled = (STOP_LINES_BY_LANE[def.laneId] ?? []).length > 0
    const decision = decideCarTargetSpeed({
      position: s.selfFootprint.position,
      heading: s.heading,
      cruiseSpeed: weatherCruise,
      lane,
      obstacles: collectPointObstacles(),
      vehicles: collectVehicleFootprints(def.id),
      selfFootprint: s.selfFootprint,
      crosswalks: collectLaneCrosswalks(def.laneId),
      vehicleSignal: laneSignalled ? getVehicleSignal(phase) : null,
      stopLines: STOP_LINES_BY_LANE[def.laneId] ?? [],
      stopSigns: laneSigns,
      clearedStopSigns: s.clearedSigns,
      expiredYields: s.expiredYields,
    })

    // Stop-sign hold: stopped at an uncleared sign → count the hold, then
    // roll through; forget the sign once we've passed it so the next lap
    // stops again.
    for (const sign of laneSigns) {
      const d =
        (sign.position[0] - s.pos[0]) * sign.direction[0] +
        (sign.position[1] - s.pos[1]) * sign.direction[1]
      if (d < -1) {
        s.clearedSigns.delete(sign.id)
        s.signHold.delete(sign.id)
      } else if (
        decision.reason === 'stop_sign' &&
        decision.stopSignId === sign.id &&
        s.speed < 0.2
      ) {
        const held = (s.signHold.get(sign.id) ?? 0) + dt
        s.signHold.set(sign.id, held)
        if (held >= sign.holdSeconds) s.clearedSigns.add(sign.id)
      }
    }

    // Courtesy-yield patience (only relevant on unsignalled streets).
    const now = clock.elapsedTime
    if (decision.reason === 'crosswalk' && decision.crosswalkId) {
      const started = s.yieldStartedAt.get(decision.crosswalkId) ?? now
      s.yieldStartedAt.set(decision.crosswalkId, started)
      const status = collectLaneCrosswalks(def.laneId).find((c) => c.id === decision.crosswalkId)
      if (status && !status.occupied && now - started > TRAFFIC_TUNING.yieldPatience) {
        s.expiredYields.add(decision.crosswalkId)
      }
    } else {
      s.yieldStartedAt.clear()
      s.expiredYields.clear()
    }

    // Smooth braking/resuming; emergency contact freezes the car outright.
    if (decision.emergencyContact) {
      s.speed = 0
    } else {
      s.speed = approach(
        s.speed,
        decision.targetSpeed,
        (decision.targetSpeed < s.speed ? TRAFFIC_TUNING.braking : TRAFFIC_TUNING.acceleration) *
          dt,
      )
    }

    // Blocked bookkeeping + polite honk. Cars honk at road-blockers (people,
    // or the player's car), never at queued traffic or red lights.
    const honkWorthy =
      decision.targetSpeed === 0 &&
      s.speed < 0.2 &&
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

    // Advance along the lane — but never while footprints are in contact.
    if (!decision.emergencyContact && s.speed > 0) {
      const target = lane.waypoints[s.targetIndex]
      const res = moveTowards(s.pos, target, s.speed * Math.min(dt, 0.1))
      s.pos = res.position
      if (res.arrived) {
        s.targetIndex = (s.targetIndex + 1) % lane.waypoints.length
      } else if (s.speed > 0.1) {
        const targetHeading = Math.atan2(res.direction[0], res.direction[1])
        s.heading = lerpAngle(s.heading, targetHeading, dt * 6)
      }
    }
    g.position.set(s.pos[0], 0, s.pos[1])
    g.rotation.y = s.heading
    registry.ambientCarPositions.get(def.id)?.set(s.pos[0], 0, s.pos[1])

    // Brake lights: red while slowing hard or held at zero.
    const braking =
      decision.targetSpeed < s.speed - 0.25 || (decision.targetSpeed === 0 && s.speed < 0.5)
    if (braking !== s.braking) setBrakeLights(s, braking)

    // Publish live agent state (mutation only — no allocations, no React).
    runtime.x = s.pos[0]
    runtime.z = s.pos[1]
    runtime.heading = s.heading
    runtime.speed = s.speed
    runtime.targetSpeed = decision.targetSpeed
    runtime.reason = decision.reason
    runtime.blockedTime = s.blockedTime
    runtime.lastHonkAt = s.lastHonkAt
    runtime.state = classifyCarState({
      speed: s.speed,
      targetSpeed: decision.targetSpeed,
      cruiseSpeed,
      reason: decision.reason,
      blockedTime: s.blockedTime,
    })
  })

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

export function AmbientCars() {
  return (
    <group name="ambient-cars">
      {AMBIENT_CARS.map((def) =>
        def.routeMode ? (
          <RoutedCar key={def.id} def={def} />
        ) : (
          <AmbientCar key={def.id} def={def} />
        ),
      )}
    </group>
  )
}
