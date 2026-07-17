import { useGameStore } from '../../game/store/useGameStore'
import { NPC_DEFS } from '../../data/npcs'

export function PhoneContacts() {
  const npcMemory = useGameStore((s) => s.npcMemory)

  return (
    <div className="phone-app">
      <div className="phone-section-title">People of the Block</div>
      <div className="phone-contacts" data-testid="phone-contacts">
        {NPC_DEFS.map((npc) => {
          const memory = npcMemory[npc.id]
          const trust = memory?.trust ?? 0
          return (
            <div key={npc.id} className="phone-card phone-contact" data-testid={`phone-contact-${npc.id}`}>
              <span className="phone-avatar" style={{ background: npc.bodyColor }}>
                {npc.name[0]}
              </span>
              <div className="phone-contact-body">
                <div className="phone-contact-name">{npc.name}</div>
                <div className="phone-contact-role">{npc.role}</div>
                <div className="phone-contact-meta">
                  {memory?.greetedPlayer ? '✓ Met' : 'Not met yet'}
                  {trust > 0 && <> · Trust {'♥'.repeat(Math.min(trust, 5))}</>}
                  {memory && memory.lastInteractionDay > 0 && (
                    <> · Last talked day {memory.lastInteractionDay}</>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
