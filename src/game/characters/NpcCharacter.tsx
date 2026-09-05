import { useCallback, useMemo } from 'react'
import type { NPCDef } from '../npc/npcTypes'
import { AnimatedCharacter } from './AnimatedCharacter'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'
import { createMotionState, getNpcCharacterMotionState } from './characterAnimationState'
import { characterRuntime } from './characterRuntime'
import { appearanceForId } from './populationAppearance'

/**
 * Suffix for the identity-rig instance a named NPC falls back to. It keeps the runtime registry
 * one-entry-per-instance while giving the fallback rig its own observable state — so a test can
 * ask what the FALLBACK is rendering, not just that the primary body failed.
 */
export const IDENTITY_FALLBACK_SUFFIX = '#identity'

/**
 * A named NPC rendered through the shared character pipeline. Motion comes
 * from the NPC behavior loop's published intent (characterRuntime.npcMotion)
 * — behavior stays authoritative, this only draws it. Visual identity comes from
 * the ONE population appearance registry (issue #23): each named NPC gets a curated,
 * unique multi-axis identity (skin/hair/shirt/pants/shoes/accessory), isolated per
 * instance so the player's wardrobe can never touch it. Gameplay identity (the NPC
 * id) is the registry KEY — it is never derived from the appearance.
 *
 * ## The fallback chain (issue #47)
 *
 * Issue #47 lets a named NPC ride the ONE owner-approved body that depicts that character. Those
 * bodies carry a single baked material, so they cannot expose the recolorable slots the identity
 * registry writes to — which makes the fallback question sharper than it looks. The pre-wave
 * visual for these NPCs was NOT the primitive capsule: it was the wardrobe-capable
 * `blocklife_person` rig wearing that NPC's curated identity, and the capsule was only ever the
 * last resort beneath it. A wave that swapped the top of the chain and left a capsule underneath
 * would silently downgrade the failure case, so the chain is explicit and three-deep:
 *
 *   approved named body  →  `blocklife_person` + this NPC's registry identity  →  the capsule
 *
 * Each step is the same `AnimatedCharacter` component acting as the previous step's fallback, so
 * there is no second renderer, loader or animation path. An NPC with no approved body (Leo) keeps
 * the two-step chain it already had, byte-identically: no wrapper, no extra instance.
 *
 * ## Why it is the ERROR fallback, not the fallback
 *
 * The middle step is passed as `errorFallback`, so it mounts ONLY when the named body genuinely
 * FAILED — never while it is merely still loading. That distinction is not pedantry, it is
 * measured: an earlier revision of this file passed the identity rig as the ordinary `fallback`,
 * which React also renders as the Suspense placeholder, so five extra `blocklife_person` clones
 * were instantiated and uploaded on every healthy boot and every sector remount. The GPU texture
 * census at four district vantage points went from 274–276 to 329–331 — +55 retained textures for
 * a rig the settled scene never shows. The loading placeholder therefore stays the cheap
 * primitive every character has always used, and `tests/e2e/asset-integration-wave-4.spec.ts`
 * gates the texture census so the regression cannot come back.
 */
export function NpcCharacter({ def, fallback }: { def: NPCDef; fallback: React.ReactNode }) {
  const assetDef =
    CHARACTER_ASSETS[def.characterAssetId ?? ''] ?? CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]
  const identityDef = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

  const appearance = useMemo(() => appearanceForId(def.id), [def.id])

  const motionScratch = useMemo(() => createMotionState(), [])
  const getMotion = useCallback(
    () => {
      const intent = characterRuntime.npcMotion.get(def.id)
      return getNpcCharacterMotionState(
        motionScratch,
        intent ?? { walking: false, speed: 0, heading: 0 },
      )
    },
    [def.id, motionScratch],
  )

  /**
   * The identity rig, mounted ONLY on a real failure of the named body. It renders the SAME
   * appearance object, so a failed named body restores the exact rig-and-wardrobe the NPC had
   * before this wave rather than dropping straight to a coloured capsule. Its OWN fallback — for
   * both its loading and its error branch — is that capsule, which is where the chain has always
   * ended.
   */
  const identityFallback =
    assetDef.id === identityDef.id ? undefined : (
      <AnimatedCharacter
        instanceId={`${def.id}${IDENTITY_FALLBACK_SUFFIX}`}
        tier="namedNpc"
        def={identityDef}
        appearance={appearance}
        getMotion={getMotion}
        fallback={fallback}
      />
    )

  return (
    <AnimatedCharacter
      instanceId={def.id}
      tier="namedNpc"
      def={assetDef}
      appearance={appearance}
      getMotion={getMotion}
      // Loading: the cheap primitive, exactly as before this wave.
      fallback={fallback}
      // Failure: the pre-wave rig wearing this NPC's identity. `undefined` for an NPC already on
      // the identity rig, which leaves its behaviour byte-identical.
      errorFallback={identityFallback}
    />
  )
}
