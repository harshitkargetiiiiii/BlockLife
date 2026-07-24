import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SocialActivityTracker } from './SocialActivityTracker'
import { useGameStore, createInitialGameState } from '../game/store/useGameStore'
import { COFFEE_QUEST_ID } from '../data/quests'
import {
  getActiveActivity,
  getInvitations,
  getMemories,
  getRelationship,
  ingestSocialEvent,
  resetSocial,
} from '../game/social/socialRuntime'

function meetRavi() {
  ingestSocialEvent({ id: 'met:npc_ravi_01', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
}

describe('SocialActivityTracker + activity flow (Slice 4)', () => {
  beforeEach(() => {
    useGameStore.setState(createInitialGameState())
    resetSocial()
  })

  it('renders nothing with no active activity', () => {
    render(<SocialActivityTracker />)
    expect(screen.queryByTestId('social-activity-tracker')).not.toBeInTheDocument()
  })

  it('runs a hangout to completion from the HUD, lifting the relationship', () => {
    meetRavi()
    // A player invite to a friend is accepted → gives us a confirmed plan.
    useGameStore.getState().sendPlayerInvite('npc_ravi_01', 'coffee')
    const inv = getInvitations().find((i) => i.source === 'player' && i.status === 'accepted')!
    useGameStore.getState().startSocialActivity(inv.id)

    render(<SocialActivityTracker />)
    expect(screen.getByTestId('social-activity-tracker')).toBeInTheDocument()

    const before = getRelationship('npc_ravi_01').affinity
    fireEvent.click(screen.getByTestId('sat-continue')) // travel → together
    fireEvent.click(screen.getByTestId('sat-continue')) // together → done
    expect(getActiveActivity()).toBeNull()
    expect(screen.queryByTestId('social-activity-tracker')).not.toBeInTheDocument()
    expect(getRelationship('npc_ravi_01').affinity).toBeGreaterThan(before)
  })

  it('a favor hands over a REAL backpack item on the delivery step', () => {
    meetRavi() // Ravi → friendly, so he’ll ask a favor
    useGameStore.setState({ inventory: { snack: 1 } })
    useGameStore.getState().startFavorFor('npc_ravi_01')
    expect(getActiveActivity()?.template).toBe('favor')

    const advance = () => useGameStore.getState().advanceSocialActivity()
    advance() // travel → deliver
    advance() // deliver: consumes the snack
    expect(useGameStore.getState().inventory['snack'] ?? 0).toBe(0)
    advance() // together → done
    expect(getMemories('npc_ravi_01').some((m) => m.kind === 'favor_completed')).toBe(true)
  })

  it('a favor is blocked without the required item (never half-applies)', () => {
    meetRavi()
    useGameStore.setState({ inventory: {} }) // no snack
    useGameStore.getState().startFavorFor('npc_ravi_01')
    useGameStore.getState().advanceSocialActivity() // travel → deliver
    const stepBefore = getActiveActivity()?.step
    useGameStore.getState().advanceSocialActivity() // deliver blocked (no item)
    expect(getActiveActivity()?.step).toBe(stepBefore) // still on deliver
  })

  it('Coffee for Ravi feeds the social system (legacy quest compat)', () => {
    useGameStore.setState({
      inventory: { coffee: 1 },
      questStates: { [COFFEE_QUEST_ID]: 'has_coffee' },
    })
    useGameStore.getState().performDialogueAction('npc_ravi_01', 'deliver_coffee')
    expect(getMemories('npc_ravi_01').some((m) => m.kind === 'gift_given')).toBe(true)
  })
})
