import { CarMesh } from './CarMesh'
import { useGameStore } from '../store/useGameStore'
import { getOwnedVehicles } from './vehicleOwnershipRuntime'
import { getParkingAnchor } from './parkingRegistry'
import { getVehicleDef } from './vehicleRegistry'
import { getWheelStyle } from './vehicleCustomization'

/**
 * Static meshes for OWNED vehicles parked at authored anchors (issue #19 §5/§6). The ONE physical
 * shell is only ever the ACTIVE vehicle; every other owned vehicle that is `parked` gets a cheap
 * static mesh at its anchor, painted with its customization colour and scaled toward its class
 * footprint. It re-renders on `vehicleVersion` (ownership changes on buy/park/retrieve — never per
 * frame). At most 4 owned vehicles exist, so this is a handful of meshes.
 */
export function OwnedParkedVehicles() {
  useGameStore((s) => s.vehicleVersion)
  const parked = getOwnedVehicles().filter((v) => v.location.kind === 'parked')
  return (
    <group name="owned-parked-vehicles">
      {parked.map((v) => {
        if (v.location.kind !== 'parked') return null
        const a = getParkingAnchor(v.location.anchorId)
        if (!a) return null
        const def = getVehicleDef(v.defId)
        const paint = v.customization.paint || def?.baseColor || '#d7e6ee'
        const wheel = getWheelStyle(v.customization.wheels)
        // Visual-only class scale (the shell's collider is fixed): compact ≈ 1, van larger, scooter
        // smaller. Derived from the def's half-length vs the compact's (1.95).
        const scale = def ? Math.max(0.6, Math.min(1.4, def.halfLength / 1.95)) : 1
        return (
          <group key={v.id} position={[a.position[0], 0, a.position[1]]} rotation={[0, a.headingY, 0]} scale={scale}>
            <CarMesh color={paint} showDriver={false} wheelHub={wheel?.hubColor} wheelScale={wheel?.radiusScale} />
          </group>
        )
      })}
    </group>
  )
}
