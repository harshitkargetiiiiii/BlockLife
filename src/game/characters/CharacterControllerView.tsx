import { Suspense, useCallback, type MutableRefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { AnimatedCharacter } from './AnimatedCharacter'
import { ProofStaticModel } from './ProofStaticModel'
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
  // §21 §4: a DEV override renders the player through the SAME production character path as
  // any asset (the representative-player avatar path); default is the wardrobe-capable rig.
  const overrideId = useGameStore((s) => s.debugPlayerCharacterId)
  // Issue #27 H0 proof (DEV): a synthetic def (e.g. a diagnostic _proof GLB) not in the manifest.
  const proofDef = useGameStore((s) => s.debugPlayerProofDef)
  // Issue #27 H0 Calibration (DEV): review an UN-RIGGED candidate GLB statically in the player slot.
  const staticGlb = useGameStore((s) => s.debugPlayerStaticGlb)
  const def = proofDef || (overrideId && CHARACTER_ASSETS[overrideId]) || PLAYER_DEF
  const getMotion = useCallback(
    (dt: number) => getPlayerCharacterMotionState(dt, headingRef.current),
    [headingRef],
  )
  if (staticGlb) {
    return (
      <Suspense fallback={<PlayerMesh />}>
        <ProofStaticModel
          path={staticGlb.path}
          yawDeg={staticGlb.yawDeg}
          scale={staticGlb.scale}
          lift={staticGlb.lift}
        />
      </Suspense>
    )
  }
  return (
    <AnimatedCharacter
      instanceId="player"
      tier="hero"
      def={def}
      appearance={appearance}
      getMotion={getMotion}
      fallback={<PlayerMesh />}
    />
  )
}
