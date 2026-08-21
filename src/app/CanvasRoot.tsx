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
import { OwnedParkedVehicles } from '../game/vehicles/OwnedParkedVehicles'
import { EjectedDrivers } from '../game/vehicles/EjectedDrivers'
import { PoliceUnits } from '../game/police/PoliceUnits'
import { PlayerWeapon } from '../game/combat/PlayerWeapon'
import { MissionDirector } from '../game/missions/MissionDirector'
import { MissionMarkers } from '../game/missions/MissionMarkers'
import { PlayerController } from '../game/player/PlayerController'
import { Vehicle } from '../game/vehicles/Vehicle'
import { WeatherEffects } from '../game/weather/WeatherEffects'
import { ApartmentColliders, ApartmentInterior } from '../game/interiors/ApartmentInterior'
import { HomeColliders, HomeInteriors } from '../game/interiors/HomeInteriors'
import { HomeFurniture, HomeFurnitureColliders } from '../game/interiors/HomeFurniture'
import { HomeGuest } from '../game/interiors/HomeGuest'
import { StoreInteriors, StoreInteriorColliders } from '../game/interiors/StoreInteriors'
import { ActivityDirector } from '../game/criminalActivities/ActivityDirector'
import { RobberyMarkers } from '../game/criminalActivities/RobberyMarkers'
import { OcclusionManager } from '../game/visibility/OcclusionManager'
import { IntegritySystem } from '../game/world/integrity/IntegritySystem'
import { PerfProbe } from '../game/world/PerfProbe'
import { DiagnosticProbe } from '../game/world/DiagnosticProbe'
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
      {import.meta.env.DEV && <IntegritySystem />}
      {import.meta.env.DEV && <PerfProbe />}
      {import.meta.env.DEV && <DiagnosticProbe />}
      <Lighting />
      <WeatherEffects />
      <SectorVisuals />
      <ApartmentInterior />
      <HomeInteriors />
      <HomeFurniture />
      <StoreInteriors />
      <NPCManager />
      <AmbientCitizens />
      <AmbientCars />
      <ParkedVehicles />
      <OwnedParkedVehicles />
      <EjectedDrivers />
      <AmbientAnimations />
      <CrimeDirector />
      <PoliceUnits />
      <PlayerWeapon />
      <MissionDirector />
      <MissionMarkers />
      <ActivityDirector />
      <RobberyMarkers />
      <Suspense fallback={null}>
        <Physics>
          <SectorColliders />
          <ApartmentColliders />
          <HomeColliders />
          <HomeFurnitureColliders />
          <HomeGuest />
          <StoreInteriorColliders />
          <PlayerController />
          <Vehicle />
          <WorldDirector />
          <SectorDirector />
        </Physics>
      </Suspense>
    </Canvas>
  )
}
