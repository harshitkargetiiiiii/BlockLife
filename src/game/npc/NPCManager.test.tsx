import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { NPCManager } from './NPCManager'
import { NPC_DEFS } from '../../data/npcs'

describe('NPCManager (R3F)', () => {
  it('creates all six named NPCs', async () => {
    const renderer = await ReactThreeTestRenderer.create(<NPCManager />)
    expect(NPC_DEFS).toHaveLength(6)
    for (const def of NPC_DEFS) {
      const found = renderer.scene.findAll((n) => n.props.name === `npc:${def.id}`)
      expect(found.length, `expected NPC ${def.id}`).toBe(1)
    }
    await renderer.unmount()
  })

  it('gives every NPC a visible name label', async () => {
    const renderer = await ReactThreeTestRenderer.create(<NPCManager />)
    for (const def of NPC_DEFS) {
      const label = renderer.scene.findAll((n) => n.props.name === `world-label:${def.name}`)
      expect(label.length, `expected label for ${def.name}`).toBe(1)
    }
    await renderer.unmount()
  })

  it('includes the expected residents', () => {
    const names = NPC_DEFS.map((n) => n.name)
    expect(names).toEqual(
      expect.arrayContaining(['Ravi', 'Maya', 'Coach Bruno', 'Leo', 'Officer Kim', 'Nisha']),
    )
  })
})
