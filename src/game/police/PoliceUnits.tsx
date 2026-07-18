import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Vec2 } from '../world/worldTypes'
import { useGameStore } from '../store/useGameStore'
import { registry, getFollowTargetPosition } from '../world/runtimeRegistry'
import { hasLineOfSight } from '../crime/lineOfSight'
import { getCrimeGameTime } from '../crime/crimeSystem'
import { CarMesh } from '../vehicles/CarMesh'
import { policeRuntime } from './policeRuntime'
import { POLICE_CAPS } from './policeTypes'
import { stepPoliceDirector } from './policeStep'
import { avoidSolids } from './policeAvoidance'
import { getContainmentTarget } from '../criminalActivities/activityRuntime'
import { cruiserExit } from './policeDismount'
import { OfficerMesh } from './OfficerMesh'

/**
 * Live police driver + renderer. Each frame it gathers the suspect's state
 * from the registry/store, runs the pure police director (dispatch + AI +
 * wanted relay + arrest), then maps the active units onto a small fixed pool
 * of car meshes (no per-frame allocation, no React state churn). Pause-aware:
 * the game clock freezes on pause so pursuit timing stays deterministic.
 */

// Fixed mesh pools sized to the L3 caps (no per-frame allocation).
const MAX_POLICE_MESHES = POLICE_CAPS[3].vehicles
const MAX_POLICE_OFFICERS = POLICE_CAPS[3].officers
// Approximate on-screen box (half extents) kept off-limits for spawns.
const CAMERA_HALF_X = 44
const CAMERA_HALF_Z = 34

const hasLos = (from: Vec2, to: Vec2) => hasLineOfSight(from, to, { includeProps: true })

/** Validated curbside exit for a dismounting officer: side of the cruiser,
 *  nudged out of any building/prop footprint so it never lands in a wall. */
const findSafeExit = (x: number, z: number, heading: number): Vec2 =>
  avoidSolids(cruiserExit(x, z, heading))

export function PoliceUnits() {
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const barRefs = useRef<(THREE.Group | null)[]>([])
  const officerRefs = useRef<(THREE.Group | null)[]>([])
  const prevSuspect = useRef<Vec2 | null>(null)

  // Emissive light-bar materials (red + blue), shared, animated by phase.
  const [redMat, blueMat] = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff2a2a', emissiveIntensity: 1 }),
      new THREE.MeshStandardMaterial({ color: '#2a5bff', emissive: '#2a5bff', emissiveIntensity: 1 }),
    ],
    [],
  )

  useFrame((_, rawDt) => {
    const store = useGameStore.getState()
    // Real frame delta (clamped) so police timing — arrest hold, fire cadence,
    // search give-up — advances in seconds, not frames (frame-rate independent).
    const dt = Math.min(rawDt, 0.05)
    const gameTime = getCrimeGameTime()

    // When paused we skip the director (deterministic frames) but STILL map
    // units → meshes below, so paused pursuit scenes render at fixed positions.
    if (!store.worldPaused) {
      // While the player is inside a robbed store under containment, the police
      // contain the ENTRANCE (a road-reachable city point) instead of chasing
      // the off-grid interior — reusing the whole dispatch/dismount/AI stack.
      // The suspect is unseen (no interior LOS), so no wall-firing is possible
      // (player and police are never in the same scene until the exit).
      const containTarget = getContainmentTarget()
      const follow = getFollowTargetPosition(store.mode)
      const suspectPos: Vec2 = containTarget ?? [follow.x, follow.z]
      const driving = containTarget ? false : store.mode === 'driving'
      // Read the body's true planar velocity rather than finite-differencing
      // position: a settled/idle player reads ~0, so physics micro-jitter can't
      // spuriously exceed the surrender speed and stall an arrest.
      const linvel = registry.playerBody?.linvel()
      const suspectSpeed = driving
        ? Math.abs(registry.flags.drivingSpeed)
        : linvel
          ? Math.hypot(linvel.x, linvel.z)
          : 0
      prevSuspect.current = suspectPos

    const cameraBox = {
      minX: suspectPos[0] - CAMERA_HALF_X,
      maxX: suspectPos[0] + CAMERA_HALF_X,
      minZ: suspectPos[1] - CAMERA_HALF_Z,
      maxZ: suspectPos[1] + CAMERA_HALF_Z,
    }

      const result = stepPoliceDirector({
        gameTime,
        dt,
        suspectPos,
        suspectInVehicle: driving,
        suspectSpeed,
        cameraBox,
        // Contained suspect is inside, unseen: no LOS, so no arrest/fire until
        // they exit. Police just form up at the door.
        hasLos: containTarget ? () => false : hasLos,
        avoid: avoidSolids,
        findSafeExit,
      })
      if (result.arrested && !store.recovery) store.respawnAfterIncident('arrest')
    }

    // Map active units → mesh pools (stable order by id) — runs even when
    // paused so a frozen pursuit tableau renders at the units' fixed spots.
    // Cruisers and dismounted officers draw from separate fixed pools.
    const all = [...policeRuntime.units.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
    const vehicles = all.filter((u) => u.kind === 'vehicle')
    const officers = all.filter((u) => u.kind === 'officer')
    const flash = (Math.sin(gameTime * 8) + 1) / 2 // 0..1 alternator
    for (let i = 0; i < MAX_POLICE_MESHES; i++) {
      const g = groupRefs.current[i]
      if (!g) continue
      const u = vehicles[i]
      if (!u) {
        g.visible = false
        continue
      }
      g.visible = true
      g.position.set(u.position[0], 0, u.position[1])
      g.rotation.y = u.heading
      const bar = barRefs.current[i]
      if (bar) {
        // Alternate the two lights so the bar reads as an active siren.
        ;(bar.children[0] as THREE.Mesh).visible = flash > 0.5
        ;(bar.children[1] as THREE.Mesh).visible = flash <= 0.5
      }
    }
    for (let i = 0; i < MAX_POLICE_OFFICERS; i++) {
      const g = officerRefs.current[i]
      if (!g) continue
      const u = officers[i]
      if (!u) {
        g.visible = false
        continue
      }
      g.visible = true
      g.position.set(u.position[0], 0, u.position[1])
      g.rotation.y = u.heading
    }
  })

  return (
    <group name="police-units">
      {Array.from({ length: MAX_POLICE_MESHES }).map((_, i) => (
        <group
          key={i}
          ref={(el) => (groupRefs.current[i] = el)}
          visible={false}
        >
          <CarMesh color="#1a2540" showDriver />
          <group ref={(el) => (barRefs.current[i] = el)} position={[0, 1.45, -0.2]}>
            <mesh material={redMat} position={[-0.35, 0, 0]}>
              <boxGeometry args={[0.5, 0.18, 0.34]} />
            </mesh>
            <mesh material={blueMat} position={[0.35, 0, 0]}>
              <boxGeometry args={[0.5, 0.18, 0.34]} />
            </mesh>
          </group>
        </group>
      ))}
      {Array.from({ length: MAX_POLICE_OFFICERS }).map((_, i) => (
        <group
          key={`officer-${i}`}
          name={`police-officer-${i}`}
          ref={(el) => (officerRefs.current[i] = el)}
          visible={false}
        >
          <OfficerMesh />
        </group>
      ))}
    </group>
  )
}
