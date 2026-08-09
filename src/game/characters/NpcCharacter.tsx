import { useCallback, useMemo } from 'react'
import type { NPCDef } from '../npc/npcTypes'
import { AnimatedCharacter } from './AnimatedCharacter'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'
import { createMotionState, getNpcCharacterMotionState } from './characterAnimationState'
import { characterRuntime } from './characterRuntime'
import { appearanceForId } from './populationAppearance'

/**
 * A named NPC rendered through the shared character pipeline. Motion comes
 * from the NPC behavior loop's published intent (characterRuntime.npcMotion)
 * — behavior stays authoritative, this only draws it. Visual identity comes from
 * the ONE population appearance registry (issue #23): each named NPC gets a curated,
 * unique multi-axis identity (skin/hair/shirt/pants/shoes/accessory), isolated per
 * instance so the player's wardrobe can never touch it. Gameplay identity (the NPC
 * id) is the registry KEY — it is never derived from the appearance.
 */
export function NpcCharacter({ def, fallback }: { def: NPCDef; fallback: React.ReactNode }) {
  const assetDef =
    CHARACTER_ASSETS[def.characterAssetId ?? ''] ?? CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

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
