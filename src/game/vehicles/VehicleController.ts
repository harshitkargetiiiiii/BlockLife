import { useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { RapierRigidBody } from '@react-three/rapier'
import { VEHICLE_TUNING } from './vehicleTypes'
import { getMovementKeys, type MovementKeys } from '../controls/useKeyboardControls'
import { registry } from '../world/runtimeRegistry'
import { isGameplayInputBlocked, useGameStore } from '../store/useGameStore'
import { approach } from '../utils/math'
import { blockVelocityTowardCircle } from '../world/trafficAvoidance'
import {
  areVehicleFootprintsOverlapping,
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  type VehicleFootprint,
} from '../traffic/vehicleObstacles'
import { trafficRuntime } from '../traffic/trafficRuntime'
import { emitCrime } from '../crime/crimeRuntime'
import { getCrimeGameTime } from '../crime/crimeSystem'
import {
  applyVehicleImpact,
  getVehicleCrimeState,
  PLAYER_CAR_ID,
} from './vehicleCrimeState'

const IDLE_KEYS: MovementKeys = { forward: false, back: false, left: false, right: false, run: false }

/** Speeds above which impacts count as collisions / reckless driving. */
const COLLISION_SPEED = 6
const RECKLESS_SPEED = 8
const PED_HIT_SPEED = 3
const PED_HIT_RADIUS2 = 1.7 * 1.7

// Reused every frame — never allocate inside useFrame.
const forwardVec = new THREE.Vector3()
const quat = new THREE.Quaternion()

/**
 * Arcade car physics: W accelerates, S brakes then reverses, A/D steer
 * (authority ramps with speed so the car never spins in place). Velocities
 * are set directly each frame; rapier still resolves collisions against the
 * static city colliders.
 */
export function useVehicleController(bodyRef: RefObject<RapierRigidBody | null>): void {
  const speedRef = useRef(0)
  const prevPos = useRef({ x: 0, z: 0, valid: false })

  useFrame((_, rawDt) => {
    const body = bodyRef.current
    if (!body) return
    const dt = Math.min(rawDt, 0.05)

    const t = body.translation()
    registry.vehiclePosition.set(t.x, t.y, t.z)

    const driving = useGameStore.getState().mode === 'driving'
    if (!driving) {
      speedRef.current = 0
      registry.flags.drivingSpeed = 0
      registry.flags.drivingBraking = false
      prevPos.current.valid = false
      return
    }

    // Phone open: pedals/steering read as released, so the car coasts to a stop.
    const blocked = isGameplayInputBlocked(useGameStore.getState().ui.panel)
    const keys = blocked ? IDLE_KEYS : getMovementKeys()
    const {
      maxSpeed,
      maxReverseSpeed,
      acceleration,
      brakeDeceleration,
      reverseAcceleration,
      coastDrag,
      turnRate,
      steerFullSpeed,
    } = VEHICLE_TUNING

    // A disabled (wrecked) car loses acceleration — it only coasts/brakes.
    const disabled = getVehicleCrimeState(PLAYER_CAR_ID).disabled
    let speed = speedRef.current
    if (keys.forward && !keys.back && !disabled) {
      // Ease off near top speed so hitting max doesn't feel like a wall.
      const ease = 1 - Math.max(0, speed / maxSpeed) * 0.35
      speed += acceleration * ease * dt
    } else if (keys.back && !keys.forward) {
      // Brake hard while rolling forward, then back up more gently.
      speed -=
        (speed > 0.2 ? brakeDeceleration : reverseAcceleration) * dt
    } else {
      speed = approach(speed, 0, coastDrag * dt)
    }
    speed = THREE.MathUtils.clamp(speed, -maxReverseSpeed, maxSpeed)
    speedRef.current = speed
    registry.flags.drivingSpeed = speed
    registry.flags.drivingBraking = keys.back && speed > 0.2

    // Steering authority ramps with speed and flips in reverse, like a car.
    const steerInput = (keys.left ? 1 : 0) - (keys.right ? 1 : 0)
    const grip =
      THREE.MathUtils.clamp(Math.abs(speed) / steerFullSpeed, 0, 1) * Math.sign(speed || 1)
    body.setAngvel({ x: 0, y: steerInput * turnRate * grip, z: 0 }, true)

    const rot = body.rotation()
    quat.set(rot.x, rot.y, rot.z, rot.w)
    forwardVec.set(0, 0, 1).applyQuaternion(quat)
    const vel = body.linvel()
    let vx = forwardVec.x * speed
    let vz = forwardVec.z * speed

    // Ambient cars have no physics colliders — a footprint-predictive soft
    // wall keeps the player's car from phasing into them. Only the velocity
    // component toward the contact is removed, so steering/reversing away
    // always works and driving never feels walled-in elsewhere.
    const heading = 2 * Math.atan2(rot.y, rot.w)
    selfFootprint.position.x = t.x
    selfFootprint.position.z = t.z
    selfFootprint.heading = heading
    const gameTime = getCrimeGameTime()
    for (const [id, carPos] of registry.ambientCarPositions) {
      const agent = trafficRuntime.cars.get(id)
      // Predict a short step ahead; block only if that step causes contact.
      selfFootprint.position.x = t.x + vx * 0.18
      selfFootprint.position.z = t.z + vz * 0.18
      otherFootprint.id = id
      otherFootprint.position.x = carPos.x
      otherFootprint.position.z = carPos.z
      otherFootprint.heading = agent?.heading ?? 0
      if (areVehicleFootprintsOverlapping(selfFootprint, otherFootprint, 0.1)) {
        const adjusted = blockVelocityTowardCircle(
          { x: t.x, z: t.z },
          { x: vx, z: vz },
          { x: carPos.x, z: carPos.z },
          Number.POSITIVE_INFINITY,
        )
        vx = adjusted.x
        vz = adjusted.z
        speedRef.current = Math.sign(speed) * Math.hypot(vx, vz)
        // Damaging contact with another car at speed = a collision crime.
        if (Math.abs(speed) > COLLISION_SPEED) {
          const rel = Math.abs(speed) + Math.abs(agent?.speed ?? 0)
          if (applyVehicleImpact(PLAYER_CAR_ID, rel, gameTime) > 0) {
            emitCrime(
              { type: 'vehicle_collision', position: [t.x, t.y, t.z], suspectEntityId: 'player', vehicleId: id },
              gameTime,
            )
          }
        }
      }
      selfFootprint.position.x = t.x
      selfFootprint.position.z = t.z
    }

    // Running into a pedestrian at speed injures them (a crime). Person
    // health is applied by the damage model (M5); here we flag the offence.
    if (Math.abs(speed) > PED_HIT_SPEED) {
      for (const [pid, ppos] of registry.npcPositions) {
        const dx = ppos.x - t.x
        const dz = ppos.z - t.z
        if (dx * dx + dz * dz < PED_HIT_RADIUS2) {
          emitCrime(
            { type: 'civilian_injury', position: [t.x, t.y, t.z], suspectEntityId: 'player', victimEntityId: pid },
            gameTime,
          )
        }
      }
    }

    // Slamming a wall/building while accelerating: reckless-driving crime +
    // vehicle damage. Detected as intended travel far exceeding actual.
    if (prevPos.current.valid && keys.forward && Math.abs(speed) > RECKLESS_SPEED) {
      const intended = Math.abs(speed) * dt
      const actual = Math.hypot(t.x - prevPos.current.x, t.z - prevPos.current.z)
      if (intended > 0.05 && actual < intended * 0.4) {
        if (applyVehicleImpact(PLAYER_CAR_ID, Math.abs(speed), gameTime) > 0) {
          emitCrime(
            { type: 'reckless_driving', position: [t.x, t.y, t.z], suspectEntityId: 'player', vehicleId: PLAYER_CAR_ID },
            gameTime,
          )
        }
      }
    }
    prevPos.current.x = t.x
    prevPos.current.z = t.z
    prevPos.current.valid = true

    body.setLinvel({ x: vx, y: vel.y, z: vz }, true)
  })
}

// Reused footprints for the soft anti-phase check.
const selfFootprint: VehicleFootprint = {
  id: 'vehicle_compact_car_01',
  kind: 'driven',
  position: { x: 0, z: 0 },
  heading: 0,
  halfLength: CAR_HALF_LENGTH,
  halfWidth: CAR_HALF_WIDTH,
  speed: 0,
}
const otherFootprint: VehicleFootprint = {
  id: '',
  kind: 'ambient',
  position: { x: 0, z: 0 },
  heading: 0,
  halfLength: CAR_HALF_LENGTH,
  halfWidth: CAR_HALF_WIDTH,
  speed: 0,
}
