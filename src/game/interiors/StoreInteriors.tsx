import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { STORE_INTERIORS, type InteriorDef } from './interiorRegistry'
import { getRobberyForInterior } from '../criminalActivities/activityDefinitions'
import { activityRuntime } from '../criminalActivities/activityRuntime'
import type { RobberyActivityDefinition } from '../criminalActivities/activityTypes'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import {
  cashierReactionFor,
  getCivilians,
  layoutFor,
  stepCivilian,
} from './interiorCivilians'

/**
 * Reusable robbable-store interiors (Store Robbery v1). Rendered exactly like
 * the apartment: self-contained rooms parked far off-grid, always mounted (cheap
 * static geometry), so entering is just a teleport. The cashier + customers read
 * their pose from activityRuntime in a single useFrame (no per-frame React
 * state), so they animate deterministically and freeze on pause with everything
 * else. Colliders derive from the same authored rects, so visuals and physics
 * can't drift.
 */

const floorMat = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.9 })
const wallMat = new THREE.MeshStandardMaterial({ color: '#e7e2d6', roughness: 0.95 })
const counterMat = new THREE.MeshStandardMaterial({ color: '#8a6b4a', roughness: 0.8 })
const counterTopMat = new THREE.MeshStandardMaterial({ color: '#c7b39a', roughness: 0.7 })
const registerMat = new THREE.MeshStandardMaterial({ color: '#3a3f4b', roughness: 0.6, metalness: 0.3 })
const registerOpenMat = new THREE.MeshStandardMaterial({
  color: '#f2c14e',
  emissive: '#f2c14e',
  emissiveIntensity: 0.4,
  roughness: 0.5,
})
const shelfMat = new THREE.MeshStandardMaterial({ color: '#b7c0c9', roughness: 0.9 })
const shelfGoodsMat = new THREE.MeshStandardMaterial({ color: '#9a5fc0', roughness: 0.85 })
const skinMat = new THREE.MeshStandardMaterial({ color: '#c98d5a', roughness: 0.8 })
const cashierShirtMat = new THREE.MeshStandardMaterial({ color: '#4a7fd4', roughness: 0.85 })
const customerShirtMat = new THREE.MeshStandardMaterial({ color: '#6a994e', roughness: 0.85 })

const WALL_H = 3.2
const WALL_T = 0.3

/** A simple standing figure (body + head), grouped so a ref can pose it. */
function Figure({ shirt }: { shirt: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, 0.7, 0]} material={shirt} castShadow>
        <boxGeometry args={[0.5, 1.0, 0.32]} />
      </mesh>
      <mesh position={[0, 1.42, 0]} material={skinMat} castShadow>
        <sphereGeometry args={[0.24, 12, 10]} />
      </mesh>
    </group>
  )
}

function StoreRoom({ interior, def }: { interior: InteriorDef; def: RobberyActivityDefinition }) {
  const [ox, oz] = interior.origin
  const hw = interior.size.width / 2
  const hd = interior.size.depth / 2
  const registerLid = useRef<THREE.Mesh>(null)
  const actorRefs = useRef<(THREE.Group | null)[]>([])
  const layout = layoutFor(interior, def)
  // Rendered once for the ref pool (count is stable: cashier + 2 customers).
  const rendered = getCivilians(interior, def)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const store = useGameStore.getState()
    // Fetch the LIVE actor array each frame: a reset rebuilds it, so a captured
    // render-time reference would go stale (stepped but never read). The count
    // is invariant, so the ref pool below still lines up.
    const actors = getCivilians(interior, def)
    const active = activityRuntime.active
    const mine = active && active.activityId === def.id ? active : null
    // A civilian reacts while a robbery is active AND the player is in this store
    // (they route/hold to safety); otherwise they recover home. Frozen on pause.
    const threatActive = mine !== null && store.location === 'store' && store.currentInteriorId === interior.id
    const p = registry.playerPosition
    if (!store.worldPaused) {
      // The cashier's reaction tracks the robbery decision each frame (fled → run
      // for the door, else freeze at the register); customers keep their personality.
      actors[0].reaction = cashierReactionFor(mine?.cashierPhase)
      for (const a of actors) {
        stepCivilian(a, { threatActive, threat: [p.x, p.z], layout, dt })
      }
    }
    // Pose each actor from its runtime state (crouch = duck/hands-up, not a sink).
    for (let i = 0; i < actors.length; i++) {
      const g = actorRefs.current[i]
      if (!g) continue
      const a = actors[i]
      g.position.set(a.pos[0], 0, a.pos[1])
      g.rotation.y = a.heading
      g.children[0].position.y = -0.22 * a.crouch
      g.children[0].rotation.x = 0.18 * a.crouch
    }
    // Register lid pops open (emissive) once the register is demandable/looted.
    if (registerLid.current) {
      const open = mine?.phase === 'demanding' || mine?.phase === 'looted'
      registerLid.current.rotation.x = open ? -1.1 : 0
      registerLid.current.material = open ? registerOpenMat : registerMat
    }
  })

  const [rx, rz] = def.registerPosition

  return (
    <group>
      {/* Floor */}
      <mesh position={[ox, 0.01, oz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={floorMat}>
        <planeGeometry args={[interior.size.width, interior.size.depth]} />
      </mesh>

      {/* Perimeter walls with a door gap on the south (entrance) side. */}
      {/* North */}
      <mesh position={[ox, WALL_H / 2, oz - hd]} material={wallMat} castShadow>
        <boxGeometry args={[interior.size.width, WALL_H, WALL_T]} />
      </mesh>
      {/* East */}
      <mesh position={[ox + hw, WALL_H / 2, oz]} material={wallMat} castShadow>
        <boxGeometry args={[WALL_T, WALL_H, interior.size.depth]} />
      </mesh>
      {/* West */}
      <mesh position={[ox - hw, WALL_H / 2, oz]} material={wallMat} castShadow>
        <boxGeometry args={[WALL_T, WALL_H, interior.size.depth]} />
      </mesh>
      {/* South, split around a central 2-wide doorway. */}
      <mesh position={[ox - hw / 2 - 0.5, WALL_H / 2, oz + hd]} material={wallMat} castShadow>
        <boxGeometry args={[interior.size.width - hw - 1, WALL_H, WALL_T]} />
      </mesh>
      <mesh position={[ox + hw / 2 + 0.5, WALL_H / 2, oz + hd]} material={wallMat} castShadow>
        <boxGeometry args={[interior.size.width - hw - 1, WALL_H, WALL_T]} />
      </mesh>

      {/* Counter + register at the cashier. */}
      <mesh position={[rx, 0.55, rz]} material={counterMat} castShadow>
        <boxGeometry args={[2.4, 1.1, 0.7]} />
      </mesh>
      <mesh position={[rx, 1.12, rz]} material={counterTopMat}>
        <boxGeometry args={[2.6, 0.1, 0.9]} />
      </mesh>
      <mesh position={[rx, 1.32, rz]} material={registerMat} castShadow>
        <boxGeometry args={[0.6, 0.35, 0.5]} />
      </mesh>
      <mesh ref={registerLid} position={[rx, 1.5, rz - 0.24]} material={registerMat}>
        <boxGeometry args={[0.58, 0.06, 0.5]} />
      </mesh>

      {/* Cashier + customers — posed each frame from the civilian runtime, so
          they route to exits/cover instead of sinking through the floor. */}
      {rendered.map((a, i) => (
        <group key={a.id} ref={(el) => (actorRefs.current[i] = el)} position={[a.pos[0], 0, a.pos[1]]}>
          <group>
            <Figure shirt={a.role === 'cashier' ? cashierShirtMat : customerShirtMat} />
          </group>
        </group>
      ))}

      {/* Shelf aisles (also the LOS blockers). */}
      {def.losBlockers.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]}>
          <mesh position={[0, 0.9, 0]} material={shelfMat} castShadow>
            <boxGeometry args={[b.halfW * 2, 1.8, b.halfD * 2]} />
          </mesh>
          <mesh position={[0, 1.5, 0]} material={shelfGoodsMat}>
            <boxGeometry args={[b.halfW * 1.9, 0.3, b.halfD * 1.9]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Interior colliders live inside <Physics>; visuals sit outside it. */
function StoreRoomColliders({ interior, def }: { interior: InteriorDef; def: RobberyActivityDefinition }) {
  const [ox, oz] = interior.origin
  const hw = interior.size.width / 2
  const hd = interior.size.depth / 2
  const [rx, rz] = def.registerPosition
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[hw, WALL_H / 2, WALL_T / 2]} position={[ox, WALL_H / 2, oz - hd]} />
      <CuboidCollider args={[WALL_T / 2, WALL_H / 2, hd]} position={[ox + hw, WALL_H / 2, oz]} />
      <CuboidCollider args={[WALL_T / 2, WALL_H / 2, hd]} position={[ox - hw, WALL_H / 2, oz]} />
      <CuboidCollider
        args={[(interior.size.width - hw - 1) / 2, WALL_H / 2, WALL_T / 2]}
        position={[ox - hw / 2 - 0.5, WALL_H / 2, oz + hd]}
      />
      <CuboidCollider
        args={[(interior.size.width - hw - 1) / 2, WALL_H / 2, WALL_T / 2]}
        position={[ox + hw / 2 + 0.5, WALL_H / 2, oz + hd]}
      />
      {/* Counter blocks the player from walking behind it. */}
      <CuboidCollider args={[1.3, 0.6, 0.45]} position={[rx, 0.6, rz]} />
      {/* A far floor collider so the room is never a void even if the global slab ends. */}
      <CuboidCollider args={[hw, 0.1, hd]} position={[ox, -0.1, oz]} />
      {def.losBlockers.map((b, i) => (
        <CuboidCollider key={i} args={[b.halfW, 0.9, b.halfD]} position={[b.x, 0.9, b.z]} />
      ))}
    </RigidBody>
  )
}

export function StoreInteriors() {
  return (
    <group name="store-interiors">
      {STORE_INTERIORS.map((interior) => {
        const def = getRobberyForInterior(interior.id)
        if (!def) return null
        return <StoreRoom key={interior.id} interior={interior} def={def} />
      })}
    </group>
  )
}

export function StoreInteriorColliders() {
  return (
    <>
      {STORE_INTERIORS.map((interior) => {
        const def = getRobberyForInterior(interior.id)
        if (!def) return null
        return <StoreRoomColliders key={interior.id} interior={interior} def={def} />
      })}
    </>
  )
}
