import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { VehicleVisual } from './VehicleVisual'
import { useVehicleController } from './VehicleController'
import { getActiveVehicleProjection, isDrivingShellActive, shellMeshScale } from './vehicleProjection'
import { getRidePassenger } from './vehicleSocial'
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
  // Tracks whether the shell is currently present (owned/stolen active) so we toggle the body +
  // mesh only on change, never every frame.
  const shellPresent = useRef<boolean | null>(null)
  const driving = useGameStore((s) => s.mode === 'driving')
  // One-shell projection (§6): the shell wears the active OWNED vehicle's paint; with no owned
  // vehicle active (legacy / stolen / pre-ownership) it keeps the classic drivable-car colour, so
  // existing visual baselines are unchanged.
  useGameStore((s) => s.vehicleVersion)
  const proj = getActiveVehicleProjection()
  const paint = proj.ownedId ? proj.paint : DRIVABLE_CAR_COLOR
  // Class-matching shell (§6): the ONE body reconfigures its collider + mesh scale for the active
  // class on switch (a re-render, never per frame). Collider density is derived so the physics mass
  // equals the class's bodyMass — the Compact yields exactly the legacy [1,0.55,2]/mass 60/scale 1.
  const [cw, ch, cl] = proj.collider
  const density = proj.bodyMass / (8 * cw * ch * cl)
  const meshScale = shellMeshScale(proj.collider)
  useVehicleController(bodyRef)

  useEffect(() => {
    registry.vehicleBody = bodyRef.current
    brakeState.current.taillights.length = 0
    meshGroup.current?.traverse((o) => {
      if (o.name === 'taillight') brakeState.current.taillights.push(o as THREE.Mesh)
    })
    // Start hidden/disabled unless a vehicle is already active (e.g. after a mid-drive load): no
    // free car on a new game (§3). The frame loop keeps this in sync as owned/stolen state changes.
    const present = isDrivingShellActive()
    shellPresent.current = present
    bodyRef.current?.setEnabled(present)
    if (meshGroup.current) meshGroup.current.visible = present
    return () => {
      registry.vehicleBody = null
    }
  }, [])

  useFrame(() => {
    // Shell presence (§3/§6): the ONE body + mesh exist only while an owned/stolen vehicle is
    // active. Toggle on change only — never a per-frame write.
    const present = isDrivingShellActive()
    if (present !== shellPresent.current) {
      shellPresent.current = present
      bodyRef.current?.setEnabled(present)
      if (meshGroup.current) meshGroup.current.visible = present
    }
    // Brake lights while the player is actually braking (imperative material swap).
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
    >
      <CuboidCollider args={[cw, ch, cl]} position={[0, ch, 0]} density={density} />
      <group name="vehicle_compact_car_01" ref={meshGroup} scale={meshScale}>
        {/* §21 §5: a GLB body (when enabled for the active class) projects onto the ONE
            shell; the CarShell body is the always-present fallback, and CarFittings
            (wheels/brake-lights/occupants) always render so the GLB keeps those behaviours.
            Physics/footprint above are unaffected — they read the projection, never the model. */}
        <VehicleVisual
          assetId={proj.assetId}
          color={paint}
          showDriver={driving}
          showPassenger={driving && getRidePassenger() != null}
          wheelHub={proj.wheelHub}
          wheelScale={proj.wheelScale}
        />
      </group>
    </RigidBody>
  )
}
