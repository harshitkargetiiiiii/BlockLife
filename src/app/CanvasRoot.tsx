import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { FollowCamera } from '../game/camera/FollowCamera'
import { Lighting } from '../game/world/Lighting'
import { WorldDirector } from '../game/world/WorldDirector'
import { AmbientCars } from '../game/world/AmbientCars'
import { AmbientAnimations } from '../game/world/AmbientAnimations'
import { NPCManager } from '../game/npc/NPCManager'
import { AmbientCitizens } from '../game/citizens/AmbientCitizens'
import { CrimeDirector } from '../game/crime/CrimeDirector'
import { ParkedVehicles } from '../game/vehicles/ParkedVehicles'
import { EjectedDrivers } from '../game/vehicles/EjectedDrivers'
import { PoliceUnits } from '../game/police/PoliceUnits'
import { PlayerWeapon } from '../game/combat/PlayerWeapon'
import { MissionDirector } from '../game/missions/MissionDirector'
import { MissionMarkers } from '../game/missions/MissionMarkers'
import { PlayerController } from '../game/player/PlayerController'
import { Vehicle } from '../game/vehicles/Vehicle'
import { WeatherEffects } from '../game/weather/WeatherEffects'
import { ApartmentColliders, ApartmentInterior } from '../game/interiors/ApartmentInterior'
import { OcclusionManager } from '../game/visibility/OcclusionManager'
import {
  SectorColliders,
  SectorDirector,
  SectorVisuals,
} from '../game/world/sectors/SectorManager'
import '../game/world/sectors/sectorComponents'

/**
 * The 3D scene. GLOBAL systems (camera, lights, weather, player, vehicle,
 * traffic, citizens, occlusion, interiors) mount once; static world visuals
 * and colliders mount per streamed SECTOR via SectorManager.
 */
export function CanvasRoot() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <FollowCamera />
      <OcclusionManager />
      <Lighting />
      <WeatherEffects />
      <SectorVisuals />
      <ApartmentInterior />
      <NPCManager />
      <AmbientCitizens />
      <AmbientCars />
      <ParkedVehicles />
      <EjectedDrivers />
      <AmbientAnimations />
      <CrimeDirector />
      <PoliceUnits />
      <PlayerWeapon />
      <MissionDirector />
      <MissionMarkers />
      <Suspense fallback={null}>
        <Physics>
          <SectorColliders />
          <ApartmentColliders />
          <PlayerController />
          <Vehicle />
          <WorldDirector />
          <SectorDirector />
        </Physics>
      </Suspense>
    </Canvas>
  )
}
