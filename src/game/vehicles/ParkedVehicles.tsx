import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CarMesh } from './CarMesh'
import { STEALABLE_VEHICLES, getVehicleCrimeState, type StealableVehicle } from './vehicleCrimeState'

/**
 * Parked civilian vehicles the player can steal. Once stolen, the drivable
 * car takes the parked car's place, so the parked mesh hides (one cheap
 * per-frame visibility read for a couple of cars — no React state churn).
 */
function ParkedVehicle({ v }: { v: StealableVehicle }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    if (ref.current) ref.current.visible = !getVehicleCrimeState(v.id).stolen
  })
  return (
    <group ref={ref} position={[v.position[0], 0, v.position[1]]} rotation={[0, v.headingY, 0]}>
      {/* Occupied cars show their seated driver (until carjacked out). */}
      <CarMesh color={v.color} showDriver={v.access === 'civilian_occupied'} />
    </group>
  )
}

export function ParkedVehicles() {
  return (
    <group name="parked-vehicles">
      {STEALABLE_VEHICLES.map((v) => (
        <ParkedVehicle key={v.id} v={v} />
      ))}
    </group>
  )
}
