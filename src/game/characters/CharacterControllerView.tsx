import { useCallback, type MutableRefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { AnimatedCharacter } from './AnimatedCharacter'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'
import { getPlayerCharacterMotionState } from './characterAnimationState'
import { useGameStore } from '../store/useGameStore'
import { PlayerMesh } from '../player/Player'

const PLAYER_DEF = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

// Preload early — the model is cached before the world finishes booting, so
// the primitive→model swap happens before the loading overlay lifts.
useGLTF.preload(`${import.meta.env.BASE_URL}${PLAYER_DEF.modelPath}`)

/**
 * The player's visual character. Rendered inside PlayerController's mesh
 * group (which owns heading rotation and driving visibility) — gameplay
 * transforms stay exactly where they were; this swaps WHAT is drawn.
 * Fallback is the classic wardrobe-colored primitive.
 */
export function PlayerCharacter({
  headingRef,
}: {
  headingRef: MutableRefObject<number>
}) {
  const appearance = useGameStore((s) => s.appearance)
  const getMotion = useCallback(
    (dt: number) => getPlayerCharacterMotionState(dt, headingRef.current),
    [headingRef],
  )
  return (
    <AnimatedCharacter
      instanceId="player"
      tier="hero"
      def={PLAYER_DEF}
      appearance={appearance}
      getMotion={getMotion}
      fallback={<PlayerMesh />}
    />
  )
}
