import { useGameStore } from '../store/useGameStore'

/**
 * The player's placeholder body (asset id: npc_player_01). Feet at y = 0,
 * face built on the +z side so heading = atan2(dir.x, dir.z).
 *
 * Outfit colors come from the store's appearance (wardrobe customization):
 * pants → legs, shirt → torso, accent → hair. Purely cosmetic.
 */
export function PlayerMesh() {
  const appearance = useGameStore((s) => s.appearance)
  return (
    <group name="player-mesh">
      {/* Legs */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.28, 0.7, 10]} />
        <meshStandardMaterial color={appearance.pantsColor} />
      </mesh>
      {/* Torso */}
      <mesh position={[0, 0.95, 0]} castShadow>
        <capsuleGeometry args={[0.32, 0.45, 6, 12]} />
        <meshStandardMaterial color={appearance.shirtColor} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.62, 0]} castShadow>
        <sphereGeometry args={[0.3, 14, 14]} />
        <meshStandardMaterial color="#ffd7b0" />
      </mesh>
      {/* Hair cap */}
      <mesh position={[0, 1.78, -0.05]}>
        <sphereGeometry args={[0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color={appearance.accentColor} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.11, 1.64, 0.26]}>
        <sphereGeometry args={[0.04, 6, 6]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      <mesh position={[0.11, 1.64, 0.26]}>
        <sphereGeometry args={[0.04, 6, 6]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
    </group>
  )
}
