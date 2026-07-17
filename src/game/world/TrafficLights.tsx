import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import {
  getPedestrianSignal,
  getPhaseAt,
  getVehicleSignal,
} from '../traffic/signalRules'
import { trafficRuntime } from '../traffic/trafficRuntime'
import {
  pedStopMaterial,
  pedWalkMaterial,
  signalGreenMaterial,
  signalRedMaterial,
  signalYellowMaterial,
} from './materials'

// Shared pieces across both signal heads.
const poleGeometry = new THREE.CylinderGeometry(0.08, 0.11, 4.4, 8)
const headGeometry = new THREE.BoxGeometry(0.46, 1.15, 0.24)
const lampGeometry = new THREE.CircleGeometry(0.12, 12)
const pedPanelGeometry = new THREE.BoxGeometry(0.52, 0.4, 0.2)
const pedIconGeometry = new THREE.PlaneGeometry(0.16, 0.22)
const poleMaterial = new THREE.MeshStandardMaterial({ color: '#3c4048' })
const headMaterial = new THREE.MeshStandardMaterial({ color: '#26282e' })

const LAMP_ON = 2.4
const LAMP_OFF = 0.05
const PED_ON = 2
const PED_OFF = 0.05

/**
 * One pole per crosswalk, on the side with a clear line of sight to the
 * fixed SE diorama camera (the gym tower occludes the north crosswalk's
 * east side). Lamp faces point toward the camera.
 */
const SIGNAL_HEADS = [
  { crosswalkId: 'crosswalk_north', position: [-2.6, -22.4] as const, rotationY: 0 },
  { crosswalkId: 'crosswalk_west', position: [-22.4, 2.6] as const, rotationY: Math.PI / 2 },
  // Industrial strip crossing shares the same controller/phase.
  { crosswalkId: 'crosswalk_industrial', position: [43.2, 15.8] as const, rotationY: Math.PI / 2 },
]

function SignalHead({ position, rotationY }: { position: readonly [number, number]; rotationY: number }) {
  return (
    <group position={[position[0], 0, position[1]]} rotation-y={rotationY} name="traffic-light">
      <mesh geometry={poleGeometry} material={poleMaterial} position={[0, 2.2, 0]} castShadow />
      <mesh geometry={headGeometry} material={headMaterial} position={[0, 3.95, 0]} castShadow />
      <mesh geometry={lampGeometry} material={signalRedMaterial} position={[0, 4.28, 0.13]} />
      <mesh geometry={lampGeometry} material={signalYellowMaterial} position={[0, 3.95, 0.13]} />
      <mesh geometry={lampGeometry} material={signalGreenMaterial} position={[0, 3.62, 0.13]} />
      {/* Pedestrian walk / don't-walk panel lower on the pole */}
      <mesh geometry={pedPanelGeometry} material={headMaterial} position={[0, 2.5, 0]} />
      <mesh geometry={pedIconGeometry} material={pedWalkMaterial} position={[-0.12, 2.5, 0.11]} />
      <mesh geometry={pedIconGeometry} material={pedStopMaterial} position={[0.12, 2.5, 0.11]} />
    </group>
  )
}

/**
 * The two signal poles by the painted crosswalks. All heads share one phase
 * (one controller for the block) and five shared materials — a single
 * useFrame drives every lamp in the scene.
 */
export function TrafficLights() {
  useFrame(() => {
    const { phase } = getPhaseAt(trafficRuntime.signal.elapsed)
    const vehicle = getVehicleSignal(phase)
    const pedestrian = getPedestrianSignal(phase)
    signalRedMaterial.emissiveIntensity = vehicle === 'red' ? LAMP_ON : LAMP_OFF
    signalYellowMaterial.emissiveIntensity = vehicle === 'yellow' ? LAMP_ON : LAMP_OFF
    signalGreenMaterial.emissiveIntensity = vehicle === 'green' ? LAMP_ON : LAMP_OFF
    pedWalkMaterial.emissiveIntensity = pedestrian === 'walk' ? PED_ON : PED_OFF
    // Don't-walk hand: solid normally, flashing during clearance.
    const flashing =
      pedestrian === 'clearance'
        ? Math.sin(trafficRuntime.signal.elapsed * 8) > 0
          ? PED_ON
          : PED_OFF
        : pedestrian === 'dont_walk'
          ? PED_ON
          : PED_OFF
    pedStopMaterial.emissiveIntensity = flashing
  })

  return (
    <group name="traffic-lights">
      {SIGNAL_HEADS.map((head) => (
        <SignalHead key={head.crosswalkId} position={head.position} rotationY={head.rotationY} />
      ))}
    </group>
  )
}
