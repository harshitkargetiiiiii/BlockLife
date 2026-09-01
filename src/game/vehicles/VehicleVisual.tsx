import { VehicleAsset } from '../assets/VehicleAsset'
import { getManifestEntry } from '../assets/modelRegistry'
import { CarShell, CarFittings, type CarMeshProps, type OccupantSeats } from './CarMesh'

export interface VehicleVisualProps extends CarMeshProps {
  /** Canonical GLB asset id for the class, or null → the procedural CarShell body. */
  assetId: string | null
  /**
   * Scale of the group this visual is rendered inside — `shellMeshScale(collider)` for the one
   * driving shell, the uniform class scale for a parked owned vehicle. Used ONLY to convert an
   * asset's world-space occupant seats into this local space, so a seated driver lands in the
   * same real place whichever group wraps it. Defaults to identity.
   */
  groupScale?: [number, number, number]
}

/**
 * Convert an asset's WORLD-space occupant seats into the fittings' local space by dividing out
 * the enclosing group's scale, and counter-scale the indicator sphere so it stays a round ball of
 * the declared radius instead of being squashed by a non-uniform group scale.
 *
 * Returns undefined when the asset declares no seats, which keeps CarMesh's own constants — so
 * the Wave 0 sedan and every procedural body render exactly as before.
 */
function resolveSeats(assetId: string | null, groupScale: [number, number, number]): OccupantSeats | undefined {
  const occupants = assetId ? getManifestEntry(assetId)?.occupants : undefined
  if (!occupants) return undefined
  const [gx, gy, gz] = groupScale
  const toLocal = (p: [number, number, number]): [number, number, number] => [p[0] / gx, p[1] / gy, p[2] / gz]
  // CarMesh's indicator sphere is authored at radius 0.24 in local space.
  const r = (occupants.radius ?? 0.24) / 0.24
  return {
    driver: toLocal(occupants.driver),
    passenger: toLocal(occupants.passenger ?? occupants.driver),
    scale: [r / gx, r / gy, r / gz],
  }
}

/**
 * The ONE composition of a vehicle's visual (issue #21 §5): an external GLB body
 * (when the class has one enabled + loaded) OR the procedural `CarShell` fallback,
 * PLUS the always-present `CarFittings` — recolorable/scalable wheels (the existing
 * wheel-style adapter), the named `taillight` meshes the brake-light swap targets,
 * and driver/passenger indicators.
 *
 * Issue #40: the fittings are no longer an unconditional sibling. The GLB branch gets a BOUNDED
 * profile (occupants only) because the approved bodies already contain their own wheels and
 * lights; the fallback branch keeps the complete set. Physics, occupants and ownership are
 * unchanged either way, and the brake-light machinery still drives every procedural body.
 *
 * Both the ACTIVE driving shell (`Vehicle.tsx`) and OWNED PARKED vehicles
 * (`OwnedParkedVehicles.tsx`) render through this, so a class looks identical
 * parked and driven BY CONSTRUCTION (§5 active/parked parity).
 *
 * What the GLB path keeps, and what it honestly does NOT (issue #40):
 *  - KEPT: occupants (driver + ride passenger), seated per asset via `occupants`.
 *  - KEPT unchanged: physics, footprint, ownership, customization STATE and save. A chosen paint
 *    and wheel style are still purchased, stored, persisted and shown in the Garage, and still
 *    render on the procedural fallback.
 *  - NOT rendered: procedural brake lamps and wheel-style recolor. The Wave 1 bodies are a single
 *    baked atlas — panels, windows, lamps and tyres share one texture — so their lamps cannot be
 *    lit and their wheels cannot be tinted without recoloring the entire vehicle, which issue #40
 *    rules out. Layering procedural lamps/wheels on top instead produced duplicate fittings. The
 *    brake-light machinery in `Vehicle.tsx` is untouched and still drives every procedural body
 *    (the fallback, ambient, parked and stealable cars).
 *
 * (This supersedes the round-2 review #2/#3 note that the GLB "never drops brake lights / wheel
 * customization": that held while vehicle GLBs were untextured bodies with no lamps of their own.)
 *
 * Physics/footprint are unaffected — they read the projection, never this.
 */
export function VehicleVisual({
  assetId,
  color,
  showDriver = false,
  showPassenger = false,
  wheelHub,
  wheelScale,
  groupScale = [1, 1, 1],
}: VehicleVisualProps) {
  const seats = resolveSeats(assetId, groupScale)
  return (
    <VehicleAsset
      assetId={assetId}
      paint={color}
      wheelHub={wheelHub}
      // Mounted only when the GLB itself mounts: the approved bodies carry their own wheels and
      // lights, so layering the procedural set on top rendered a multi-wheel hybrid with a second
      // pair of lamps floating off the tail (issue #40). Occupants are the one fitting such a
      // model genuinely lacks, so they stay.
      glbSiblings={
        <CarFittings
          profile="bodyIncluded"
          showDriver={showDriver}
          showPassenger={showPassenger}
          seats={seats}
        />
      }
    >
      {/* The procedural fallback keeps the COMPLETE historical fittings — body, wheels, lights,
          occupants — so a missing/failed model still renders a whole car, byte-identically. */}
      <CarShell color={color} />
      <CarFittings
        showDriver={showDriver}
        showPassenger={showPassenger}
        wheelHub={wheelHub}
        wheelScale={wheelScale}
      />
    </VehicleAsset>
  )
}
