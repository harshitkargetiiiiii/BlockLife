import { useCallback, useMemo } from 'react'
import type { NPCDef } from '../npc/npcTypes'
import { AnimatedCharacter } from './AnimatedCharacter'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'
import { createMotionState, getNpcCharacterMotionState } from './characterAnimationState'
import { characterRuntime } from './characterRuntime'
import { shade } from '../world/materials'
import type { CharacterAppearance } from './characterTypes'

/**
 * A named NPC rendered through the shared character pipeline. Motion comes
 * from the NPC behavior loop's published intent (characterRuntime.npcMotion)
 * — behavior stays authoritative, this only draws it. Appearance is a fixed
 * palette derived from the NPC's classic colors, isolated per instance so
 * the player's wardrobe can never touch it.
 */
export function NpcCharacter({ def, fallback }: { def: NPCDef; fallback: React.ReactNode }) {
  const assetDef =
    CHARACTER_ASSETS[def.characterAssetId ?? ''] ?? CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

  const appearance = useMemo<CharacterAppearance>(
    () => ({
      shirtColor: def.bodyColor,
      pantsColor: shade(def.bodyColor, 0.5),
      accentColor: '#5c4033',
    }),
    [def.bodyColor],
  )

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

  return (
    <AnimatedCharacter
      instanceId={def.id}
      tier="namedNpc"
      def={assetDef}
      appearance={appearance}
      getMotion={getMotion}
      fallback={fallback}
    />
  )
}
