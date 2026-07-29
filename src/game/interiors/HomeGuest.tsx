import * as THREE from 'three'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useGameStore } from '../store/useGameStore'
import { getActiveActivity } from '../social/socialRuntime'
import { getSocialActor } from '../social/socialActors'
import { isHomeActivityKind } from '../social/socialActivities'
import { getCurrentPropertyId } from '../housing/housingRuntime'
import { guestAnchorFor } from '../housing/housingSocial'

/**
 * A hosted guest inside the current home (issue #17 §9). When a home social activity
 * is active AND the player is inside their residence, the invited named NPC appears
 * at the authored hosting anchor — a clear guest-spawn spot, never in furniture, a
 * wall, a door, or the player. It reads the ONE social activity (getActiveActivity),
 * so completion / cancellation / a load that drops the activity clears the guest with
 * no leak. Re-renders on the social + housing version counters, never per frame.
 */

const guestBody = new THREE.MeshStandardMaterial({ color: '#8a6ea8', roughness: 0.8 })
const guestHead = new THREE.MeshStandardMaterial({ color: '#e2b48c', roughness: 0.85 })

export function HomeGuest() {
  useGameStore((s) => s.socialVersion)
  useGameStore((s) => s.housingVersion)
  const location = useGameStore((s) => s.location)

  const act = getActiveActivity()
  if (!act || !isHomeActivityKind(act.activityKind)) return null
  if (location !== 'apartment') return null // only visible while you're home hosting
  const anchor = guestAnchorFor(getCurrentPropertyId())
  if (!anchor) return null
  const actor = getSocialActor(act.actorId)
  if (!actor) return null

  const [x, , z] = anchor
  return (
    <group name="home-guest">
      <group position={[x, 0, z]}>
        <mesh material={guestBody} position={[0, 0.75, 0]} castShadow>
          <capsuleGeometry args={[0.28, 0.7, 6, 12]} />
        </mesh>
        <mesh material={guestHead} position={[0, 1.45, 0]} castShadow>
          <sphereGeometry args={[0.25, 14, 14]} />
        </mesh>
      </group>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.35, 0.9, 0.35]} position={[x, 0.9, z]} />
      </RigidBody>
    </group>
  )
}
