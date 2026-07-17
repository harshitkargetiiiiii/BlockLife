import { NPC } from './NPC'
import { NPC_DEFS } from '../../data/npcs'

/** Spawns all six named residents. NPCs are visual + logical only, no physics. */
export function NPCManager() {
  return (
    <group name="npc-manager">
      {NPC_DEFS.map((def) => (
        <NPC key={def.id} def={def} />
      ))}
    </group>
  )
}
