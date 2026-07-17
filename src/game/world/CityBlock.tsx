import { Ground } from './Ground'
import { SurfaceDetailLayer } from './surfaces/SurfaceDetailLayer'
import { getSurfaceDetailsForSector } from './surfaces/sectorSurfaceDetails'
import { Roads } from './Roads'
import { Buildings } from './Buildings'
import { Props } from './Props'
import { FoodTruck } from './FoodTruck'
import { TrafficLights } from './TrafficLights'
import { Districts } from './Districts'
import { InteractableMarker } from '../interactables/InteractableMarker'
import { STATIC_INTERACTABLES } from '../../data/interactables'

/**
 * All static visuals for the central city sector. Deliberately physics-free:
 * simple cuboid colliders live in CityColliders so visuals stay swappable
 * for GLB assets. `buildingIds`/`propIds` scope the data-driven pieces to
 * the sector's owned content (backdrop towers and gateway props render in
 * their own sector roots).
 */
export function CityBlock({
  buildingIds,
  propIds,
}: {
  buildingIds?: readonly string[]
  propIds?: readonly string[]
}) {
  return (
    <group name="city-block">
      <Ground />
      <SurfaceDetailLayer details={getSurfaceDetailsForSector('s0_0')} />
      <Roads />
      <Buildings only={buildingIds} />
      <Districts />
      <Props only={propIds} />
      <FoodTruck />
      <TrafficLights />
      {STATIC_INTERACTABLES.filter((d) => d.marker).map((def) => (
        <InteractableMarker key={def.id} def={def} />
      ))}
    </group>
  )
}
