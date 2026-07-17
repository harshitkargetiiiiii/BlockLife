import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { PlayerCharacter } from '../characters/CharacterControllerView'
import { characterRuntime } from '../characters/characterRuntime'
import { PLAYER_SPAWN, RUN_SPEED, WALK_SPEED } from './playerTypes'
import { getMovementKeys, type MovementKeys } from '../controls/useKeyboardControls'
import { getSpeedModifier } from '../simulation/needsSystem'
import { registry } from '../world/runtimeRegistry'
import { isGameplayInputBlocked, useGameStore } from '../store/useGameStore'
import { approach, lerpAngle } from '../utils/math'
import { blockVelocityTowardCircle } from '../world/trafficAvoidance'

const IDLE_KEYS: MovementKeys = { forward: false, back: false, left: false, right: false, run: false }

/** Soft-wall radius around each decorative ambient car. */
const AMBIENT_CAR_RADIUS = 2.1
/** Soft-wall radius around every person (NPCs + ambient citizens). */
const PERSON_RADIUS = 0.72

// The camera sits at +x/+z, so "up the screen" is the world -x/-z diagonal.
const SCREEN_FORWARD = new THREE.Vector3(-1, 0, -1).normalize()
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize()

// Ground acceleration/deceleration in units/s². High enough to feel snappy,
// finite so starts and stops read as motion instead of teleports.
const ACCELERATION = 34
const DECELERATION = 44

// Reused every frame — never allocate inside useFrame.
const desiredDir = new THREE.Vector3()

/** Physics body + input-driven movement for the on-foot player. */
export function PlayerController() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const meshRef = useRef<THREE.Group>(null)
  const headingRef = useRef(Math.PI)
  // Desired planar velocity, smoothed over time. Kept separate from the
  // physics body's actual velocity so pressing into a wall doesn't jitter.
  const velRef = useRef({ x: 0, z: 0 })
  const mode = useGameStore((s) => s.mode)

  useEffect(() => {
    registry.playerBody = bodyRef.current
    return () => {
      registry.playerBody = null
    }
  }, [])

  useFrame(({ clock }, rawDt) => {
    const body = bodyRef.current
    if (!body) return
    const dt = Math.min(rawDt, 0.05)

    if (useGameStore.getState().mode === 'driving') {
      registry.flags.running = false
      velRef.current.x = 0
      velRef.current.z = 0
      return
    }

    const t = body.translation()
    registry.playerPosition.set(t.x, t.y, t.z)

    // While the phone is open the world keeps animating but the player
    // ignores movement keys (and decelerates to a smooth stop below).
    const blocked = isGameplayInputBlocked(useGameStore.getState().ui.panel)
    const keys = blocked ? IDLE_KEYS : getMovementKeys()
    const fwd = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0)
    const right = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
    const moving = fwd !== 0 || right !== 0

    const stats = useGameStore.getState().stats
    const maxSpeed = (keys.run ? RUN_SPEED : WALK_SPEED) * getSpeedModifier(stats)
    registry.flags.running = keys.run && moving

    let targetX = 0
    let targetZ = 0
    if (moving) {
      desiredDir
        .set(0, 0, 0)
        .addScaledVector(SCREEN_FORWARD, fwd)
        .addScaledVector(SCREEN_RIGHT, right)
        .normalize()
      targetX = desiredDir.x * maxSpeed
      targetZ = desiredDir.z * maxSpeed
      headingRef.current = Math.atan2(desiredDir.x, desiredDir.z)
    }
    registry.playerHeading = headingRef.current

    // Accelerate toward the stick direction, brake harder when released.
    const rate = moving ? ACCELERATION : DECELERATION
    const vel = velRef.current
    vel.x = approach(vel.x, targetX, rate * dt)
    vel.z = approach(vel.z, targetZ, rate * dt)

    // Ambient cars have no physics colliders — a soft wall stops the player
    // from walking into them (the stored velocity keeps its momentum so
    // movement resumes naturally once the car passes).
    let appliedX = vel.x
    let appliedZ = vel.z
    for (const car of registry.ambientCarPositions.values()) {
      const adjusted = blockVelocityTowardCircle(
        { x: t.x, z: t.z },
        { x: appliedX, z: appliedZ },
        { x: car.x, z: car.z },
        AMBIENT_CAR_RADIUS,
      )
      appliedX = adjusted.x
      appliedZ = adjusted.z
    }

    // People are solid too: NPCs and citizens are kinematic (no colliders),
    // so the same soft wall keeps the player from walking through them.
    for (const person of registry.npcPositions.values()) {
      const adjusted = blockVelocityTowardCircle(
        { x: t.x, z: t.z },
        { x: appliedX, z: appliedZ },
        { x: person.x, z: person.z },
        PERSON_RADIUS,
      )
      appliedX = adjusted.x
      appliedZ = adjusted.z
    }

    const bodyVel = body.linvel()
    body.setLinvel({ x: appliedX, y: bodyVel.y, z: appliedZ }, true)

    // Face travel direction. The walk bob is only for the primitive
    // fallback — the rigged model's clips carry their own hip bob.
    const mesh = meshRef.current
    if (mesh) {
      mesh.rotation.y = lerpAngle(mesh.rotation.y, headingRef.current, dt * 12)
      const primitiveActive =
        characterRuntime.instances.get('player')?.activeVisual !== 'model'
      mesh.position.y =
        moving && primitiveActive
          ? -0.8 + Math.abs(Math.sin(clock.elapsedTime * (keys.run ? 11 : 8))) * 0.07
          : -0.8
    }
  })

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={PLAYER_SPAWN}
      enabledRotations={[false, false, false]}
      friction={0.1}
      restitution={0}
      linearDamping={0.2}
    >
      <CapsuleCollider args={[0.45, 0.35]} />
      <group ref={meshRef} position={[0, -0.8, 0]} visible={mode === 'walking'}>
        <PlayerCharacter headingRef={headingRef} />
      </group>
    </RigidBody>
  )
}
