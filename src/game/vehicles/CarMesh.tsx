import * as THREE from 'three'
import { headlightMaterial, taillightMaterial } from '../world/materials'

// Geometry/material shared across every car instance (drivable, ambient,
// parked) — one allocation each instead of one per car.
const bodyGeometry = new THREE.BoxGeometry(2, 0.62, 3.9)
const cabinGeometry = new THREE.BoxGeometry(1.7, 0.55, 1.9)
const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 14)
const lightGeometry = new THREE.BoxGeometry(0.34, 0.2, 0.08)
const driverGeometry = new THREE.SphereGeometry(0.24, 12, 12)
const cabinMaterial = new THREE.MeshStandardMaterial({
  color: '#d7e6ee',
  roughness: 0.15,
  metalness: 0.3,
})
const driverMaterial = new THREE.MeshStandardMaterial({ color: '#ffd7b0' })

// Wheel hub materials cached per style colour (a handful total). '#26262c' is the classic default,
// so the generic procedural ambient / static parked / stealable city cars (which pass no wheel
// style) render byte-identically.
const wheelMaterials = new Map<string, THREE.MeshStandardMaterial>()
function wheelMaterialFor(hub: string): THREE.MeshStandardMaterial {
  let mat = wheelMaterials.get(hub)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: hub, roughness: 0.9 })
    wheelMaterials.set(hub, mat)
  }
  return mat
}

// Body materials cached per paint color (a handful of colors total).
const bodyMaterials = new Map<string, THREE.MeshStandardMaterial>()
function bodyMaterialFor(color: string): THREE.MeshStandardMaterial {
  let mat = bodyMaterials.get(color)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.15 })
    bodyMaterials.set(color, mat)
  }
  return mat
}

const WHEEL_POSITIONS: [number, number][] = [
  [-0.92, 1.25],
  [0.92, 1.25],
  [-0.92, -1.25],
  [0.92, -1.25],
]

export interface CarMeshProps {
  color: string
  showDriver?: boolean
  /** A seated NPC passenger (Give-a-Ride, §11) — a validated render flag, no passenger AI. */
  showPassenger?: boolean
  /** Wheel-style hub colour + relative radius (§9). Defaults reproduce the classic wheel exactly. */
  wheelHub?: string
  wheelScale?: number
}

/**
 * The painted body SHELL (body + cabin) only — the part an external vehicle GLB
 * replaces (issue #21 §5). Split out so the GLB body can render while the
 * functional fittings below stay procedural (brake lights, occupants, wheel-style).
 */
export function CarShell({ color }: { color: string }) {
  return (
    <group name="car-shell">
      <mesh geometry={bodyGeometry} material={bodyMaterialFor(color)} position={[0, 0.55, 0]} castShadow />
      <mesh geometry={cabinGeometry} material={cabinMaterial} position={[0, 1.08, -0.35]} castShadow />
    </group>
  )
}

/**
 * How much of the fittings set to render alongside a body (issue #40).
 *
 * - `full` — the complete historical set: four wheels, headlights, taillights and occupants.
 *   Used by `CarMesh`, which backs the generic procedural city cars — ambient traffic, the
 *   static parked cars and the stealable ones — and by the CarMesh FALLBACK a GLB drops back to.
 *   Those renders are byte-identical to before. NOTE: an OWNED parked vehicle is not one of
 *   these; it renders through `VehicleVisual`, so when its class has a GLB it gets the bounded
 *   profile below, exactly like the active shell.
 * - `bodyIncluded` — for a body that already contains its own wheels AND lights in its mesh.
 *   Renders ONLY the occupant indicators, which are the one fitting such a model genuinely
 *   lacks. Wheels, headlights and taillights are all dropped: layering them over a model that
 *   has its own is the duplicate-wheels/duplicate-body-lights defect issue #40 fails a build on,
 *   and the rendered captures confirmed the taillight boxes read as a second set of lamps
 *   floating off the tail rather than as part of the vehicle.
 *
 *   The brake-light state machine in Vehicle.tsx is UNCHANGED and still drives every `taillight`
 *   mesh it finds — which is every body that HAS one: the CarMesh fallback and the generic
 *   procedural ambient / static parked / stealable city cars. A baked-atlas body simply has no
 *   separable lamp to animate: its lights live in the same single texture as its panels, so
 *   lighting them would recolor the whole vehicle, which is exactly the dishonest recolor
 *   issue #40 rules out. Recorded, not faked.
 */
export type CarFittingsProfile = 'full' | 'bodyIncluded'

/**
 * Explicit occupant seats, in the fittings' own LOCAL space (the space CarMesh is authored in).
 * Supplied only for a GLB body, whose proportions differ from the sedan CarMesh was tuned for.
 * Omitted -> the historical constants, so every procedural render is unchanged.
 */
export interface OccupantSeats {
  driver: [number, number, number]
  passenger: [number, number, number]
  /** Per-axis scale for the indicator sphere, counteracting the enclosing group's scale. */
  scale: [number, number, number]
}

const DEFAULT_SEATS: OccupantSeats = {
  driver: [0, 1.25, -0.2],
  passenger: [0.5, 1.25, -0.2],
  scale: [1, 1, 1],
}

/**
 * The functional fittings that must survive a GLB body swap (§5): recolorable/
 * scalable wheels (the existing wheel-style adapter), headlights, the named
 * `taillight` meshes the brake-light swap targets, and driver/passenger
 * indicators. Rendered as a sibling of the body so wheel-style, brake lights and
 * passenger visibility keep working; `profile` bounds the set to what the body
 * itself does not already provide.
 *
 */
export function CarFittings({
  showDriver = false,
  showPassenger = false,
  wheelHub = '#26262c',
  wheelScale = 1,
  profile = 'full',
  seats = DEFAULT_SEATS,
}: Omit<CarMeshProps, 'color'> & { profile?: CarFittingsProfile; seats?: OccupantSeats }) {
  const bodyProvidesItsOwn = profile === 'bodyIncluded'
  return (
    <group name="car-fittings">
      {!bodyProvidesItsOwn &&
        WHEEL_POSITIONS.map(([x, z], i) => (
          <mesh
            key={i}
            geometry={wheelGeometry}
            material={wheelMaterialFor(wheelHub)}
            position={[x, 0.34 * wheelScale, z]}
            rotation-z={Math.PI / 2}
            scale={wheelScale}
          />
        ))}
      {/* Headlights (front, +z) and the brake-light taillights — only for a body without its own. */}
      {!bodyProvidesItsOwn && (
        <>
          <mesh geometry={lightGeometry} material={headlightMaterial} position={[-0.6, 0.58, 1.96]} />
          <mesh geometry={lightGeometry} material={headlightMaterial} position={[0.6, 0.58, 1.96]} />
          <mesh
            name="taillight"
            geometry={lightGeometry}
            material={taillightMaterial}
            position={[-0.6, 0.58, -1.96]}
          />
          <mesh
            name="taillight"
            geometry={lightGeometry}
            material={taillightMaterial}
            position={[0.6, 0.58, -1.96]}
          />
        </>
      )}
      {showDriver && (
        <mesh
          geometry={driverGeometry}
          material={driverMaterial}
          position={seats.driver}
          scale={seats.scale}
        />
      )}
      {showPassenger && (
        <mesh
          geometry={driverGeometry}
          material={driverMaterial}
          position={seats.passenger}
          scale={seats.scale}
        />
      )}
    </group>
  )
}

/**
 * Shared low-poly car used as the drivable shell's procedural fallback and by the generic
 * procedural city cars (ambient traffic, static parked, stealable).
 * Nose faces +z. Roughly 2 wide × 1.6 tall × 3.9 long. Composed of the body
 * SHELL + FITTINGS so callers that project a GLB can reuse the fittings while
 * swapping only the shell. Byte-identical to the pre-split mesh for the
 * generic procedural city cars (ambient / static parked / stealable).
 */
export function CarMesh(props: CarMeshProps) {
  return (
    <group name="car-mesh">
      <CarShell color={props.color} />
      <CarFittings
        showDriver={props.showDriver}
        showPassenger={props.showPassenger}
        wheelHub={props.wheelHub}
        wheelScale={props.wheelScale}
      />
    </group>
  )
}
