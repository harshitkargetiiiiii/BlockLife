import { useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CarMesh } from './CarMesh'
import { STEALABLE_VEHICLES, getVehicleCrimeState, type StealableVehicle } from './vehicleCrimeState'
import { INTERACTABLE_BY_ID } from '../../data/interactables'
import { InteractableMarker } from '../interactables/InteractableMarker'

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

/**
 * The steal marker for one parked car: shown only while that car is still there to steal. The
 * stolen flag lives in the crime runtime, so it is polled per frame and React re-renders only on
 * the one transition.
 */
function StealMarker({ v }: { v: StealableVehicle }) {
  const def = INTERACTABLE_BY_ID[v.id]
  const [available, setAvailable] = useState(() => !getVehicleCrimeState(v.id).stolen)
  const current = useRef(available)
  useFrame(() => {
    const next = !getVehicleCrimeState(v.id).stolen
    if (next !== current.current) {
      current.current = next
      setAvailable(next)
    }
  })
  return available && def?.marker ? <InteractableMarker def={def} /> : null
}

export function ParkedVehicles() {
  return (
    <group name="parked-vehicles">
      {STEALABLE_VEHICLES.map((v) => (
        <ParkedVehicle key={v.id} v={v} />
      ))}
      {STEALABLE_VEHICLES.map((v) => (
        <StealMarker key={`marker:${v.id}`} v={v} />
      ))}
    </group>
  )
}
