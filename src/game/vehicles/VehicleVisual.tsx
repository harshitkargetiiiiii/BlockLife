import { VehicleAsset } from '../assets/VehicleAsset'
import { CarShell, CarFittings, type CarMeshProps } from './CarMesh'

export interface VehicleVisualProps extends CarMeshProps {
  /** Canonical GLB asset id for the class, or null → the procedural CarShell body. */
  assetId: string | null
}

/**
 * The ONE composition of a vehicle's visual (issue #21 §5): an external GLB body
 * (when the class has one enabled + loaded) OR the procedural `CarShell` fallback,
 * PLUS the always-present `CarFittings` — recolorable/scalable wheels (the existing
 * wheel-style adapter), the named `taillight` meshes the brake-light swap targets,
 * and driver/passenger indicators.
 *
 * Both the ACTIVE driving shell (`Vehicle.tsx`) and OWNED PARKED vehicles
 * (`OwnedParkedVehicles.tsx`) render through this, so a class looks identical
 * parked and driven BY CONSTRUCTION (§5 active/parked parity) and the GLB never
 * drops brake lights / passengers / wheel customization (round-2 review #2/#3).
 * Physics/footprint are unaffected — they read the projection, never this.
 */
export function VehicleVisual({
  assetId,
  color,
  showDriver = false,
  showPassenger = false,
  wheelHub,
  wheelScale,
}: VehicleVisualProps) {
  return (
    <>
      <VehicleAsset assetId={assetId} paint={color} wheelHub={wheelHub}>
        <CarShell color={color} />
      </VehicleAsset>
      <CarFittings
        showDriver={showDriver}
        showPassenger={showPassenger}
        wheelHub={wheelHub}
        wheelScale={wheelScale}
      />
    </>
  )
}
