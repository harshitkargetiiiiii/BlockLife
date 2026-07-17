import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { CarMesh } from './CarMesh'
import { useVehicleController } from './VehicleController'
import { CAR_SPAWN, CAR_SPAWN_ROTATION_Y } from '../world/cityLayout'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { brakeLightMaterial, taillightMaterial } from '../world/materials'

export const DRIVABLE_CAR_COLOR = '#3aa6a0'

/** The one drivable car (asset id: vehicle_compact_car_01). */
export function Vehicle() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const meshGroup = useRef<THREE.Group>(null)
  const brakeState = useRef({ taillights: [] as THREE.Mesh[], braking: false })
  const driving = useGameStore((s) => s.mode === 'driving')
  useVehicleController(bodyRef)

  useEffect(() => {
    registry.vehicleBody = bodyRef.current
    brakeState.current.taillights.length = 0
    meshGroup.current?.traverse((o) => {
      if (o.name === 'taillight') brakeState.current.taillights.push(o as THREE.Mesh)
    })
    return () => {
      registry.vehicleBody = null
    }
  }, [])

  // Brake lights while the player is actually braking (imperative material
  // swap — no React state churn in the frame loop).
  useFrame(() => {
    const s = brakeState.current
    const braking = registry.flags.drivingBraking
    if (braking !== s.braking) {
      s.braking = braking
      for (const light of s.taillights) {
        light.material = braking ? brakeLightMaterial : taillightMaterial
      }
    }
  })

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={CAR_SPAWN}
      rotation={[0, CAR_SPAWN_ROTATION_Y, 0]}
      enabledRotations={[false, true, false]}
      linearDamping={1.2}
      angularDamping={4}
      mass={60}
    >
      <CuboidCollider args={[1, 0.55, 2]} position={[0, 0.55, 0]} />
      <group name="vehicle_compact_car_01" ref={meshGroup}>
        <CarMesh color={DRIVABLE_CAR_COLOR} showDriver={driving} />
      </group>
    </RigidBody>
  )
}
