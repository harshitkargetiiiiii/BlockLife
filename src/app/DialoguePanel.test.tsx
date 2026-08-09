import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DialoguePanel } from './DialoguePanel'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'
import { COFFEE_QUEST_ID } from '../data/quests'
import { resetSocial, getRelationship, getContacts, getMemories, getActiveActivity, ingestSocialEvent } from '../game/social/socialRuntime'

describe('DialoguePanel', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
    resetSocial()
  })

  it('renders nothing when no dialogue is open', () => {
    render(<DialoguePanel />)
    expect(screen.queryByTestId('dialogue-panel')).not.toBeInTheDocument()
  })

  it('shows the NPC name and dialogue text', () => {
    useGameStore.setState({
      ui: { panel: 'dialogue' as const, dialogueNpcId: 'npc_ravi_01', activityId: null, activePhoneApp: 'home' as const },
    })
    render(<DialoguePanel />)
    expect(screen.getByTestId('dialogue-npc-name')).toHaveTextContent('Ravi')
    expect(screen.getByTestId('dialogue-text')).toHaveTextContent(/coffee/i)
  })

  it('accepting the quest activates it and closes the panel', () => {
    useGameStore.setState({
      ui: { panel: 'dialogue' as const, dialogueNpcId: 'npc_ravi_01', activityId: null, activePhoneApp: 'home' as const },
    })
    render(<DialoguePanel />)
    fireEvent.click(document.querySelector('[data-action-id="accept_quest"]')!)
    expect(useGameStore.getState().questStates[COFFEE_QUEST_ID]).toBe('active')
    expect(useGameStore.getState().ui.panel).toBe('none')
  })

  it('shows other residents with a friendly line', () => {
    useGameStore.setState({
      ui: { panel: 'dialogue' as const, dialogueNpcId: 'npc_maya_01', activityId: null, activePhoneApp: 'home' as const },
    })
    render(<DialoguePanel />)
    expect(screen.getByTestId('dialogue-npc-name')).toHaveTextContent('Maya')
  })

  // Issue #23: dialogue presentation — a registry-tinted identity avatar always shows;
  // the relationship-tier badge appears only once the NPC is a known contact.
  it('renders the identity avatar, and a tier badge once the NPC is known', () => {
    // Panel open for a not-yet-met NPC (opened directly, no meet): avatar, no badge.
    useGameStore.setState({
      ui: { panel: 'dialogue' as const, dialogueNpcId: 'npc_ravi_01', activityId: null, activePhoneApp: 'home' as const },
    })
    const { unmount } = render(<DialoguePanel />)
    // Avatar built from three registry swatches (hair / skin / shirt).
    expect(screen.getByTestId('dialogue-avatar').querySelectorAll('span')).toHaveLength(3)
    expect(screen.queryByTestId('dialogue-tier-badge')).not.toBeInTheDocument()
    unmount()

    // Meeting Ravi (a first-meeting contact) unlocks him → the tier badge appears.
    useGameStore.getState().openDialogue('npc_ravi_01')
    render(<DialoguePanel />)
    expect(screen.getByTestId('dialogue-tier-badge')).toBeInTheDocument()
  })

  describe('social menu (Slice 2)', () => {
    it('offers the contextual social menu for a named social actor', () => {
      useGameStore.getState().openDialogue('npc_maya_01') // fires first-meeting
      render(<DialoguePanel />)
      expect(screen.getByTestId('social-menu')).toBeInTheDocument()
      expect(document.querySelector('[data-social-action="talk"]')).toBeTruthy()
      expect(document.querySelector('[data-social-action="check_in"]')).toBeTruthy()
    })

    it('meeting a first_meeting actor unlocks them as a contact', () => {
      expect(getContacts()).not.toContain('npc_ravi_01')
      useGameStore.getState().openDialogue('npc_ravi_01')
      expect(getContacts()).toContain('npc_ravi_01')
    })

    it('a gift button appears per giftable backpack item and consumes it on give', () => {
      useGameStore.setState({ inventory: { snack: 1 } })
      useGameStore.getState().openDialogue('npc_ravi_01')
      render(<DialoguePanel />)
      const giveBtn = document.querySelector('[data-social-action="gift"][data-item-id="snack"]') as HTMLElement
      expect(giveBtn).toBeTruthy()
      expect(giveBtn).toHaveTextContent(/Give Snack Bar/i)

      const affinityBefore = getRelationship('npc_ravi_01').affinity
      fireEvent.click(giveBtn)
      // Ravi likes snacks → affinity rises, and the snack leaves the backpack.
      expect(getRelationship('npc_ravi_01').affinity).toBeGreaterThan(affinityBefore)
      expect(useGameStore.getState().inventory['snack'] ?? 0).toBe(0)
      expect(getMemories('npc_ravi_01').some((m) => m.kind === 'gift_given')).toBe(true)
    })

    it('talking through the menu records a conversation memory', () => {
      useGameStore.getState().openDialogue('npc_nisha_01')
      render(<DialoguePanel />)
      fireEvent.click(document.querySelector('[data-social-action="talk"]')!)
      expect(getMemories('npc_nisha_01').some((m) => m.kind === 'conversation')).toBe(true)
    })

    it('offers to run a favor for a friend, starting an activity', () => {
      // Warm Ravi to a friend so the errand offer appears.
      ingestSocialEvent({ id: 'met:npc_ravi_01', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1 })
      useGameStore.getState().openDialogue('npc_ravi_01')
      render(<DialoguePanel />)
      const helpBtn = document.querySelector('[data-social-action="offer_help"]') as HTMLElement
      expect(helpBtn).toBeTruthy()
      fireEvent.click(helpBtn)
      expect(getActiveActivity()?.template).toBe('favor')
    })
  })
})
