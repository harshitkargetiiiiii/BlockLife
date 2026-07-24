import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PhoneHome } from './PhoneHome'
import { PhoneQuests } from './PhoneQuests'
import { PhoneContacts } from './PhoneContacts'
import { PhoneMap } from './PhoneMap'
import { PhoneSettings } from './PhoneSettings'
import { buildMessages, PhoneMessages } from './PhoneMessages'
import { getFlavorLine, MAP_BOUNDS, worldToMap } from './phoneUtils'
import * as THREE from 'three'
import { registry } from '../../game/world/runtimeRegistry'
import { useGameStore, createInitialGameState } from '../../game/store/useGameStore'
import { INITIAL_STATS } from '../../game/player/playerTypes'
import { NPC_DEFS } from '../../data/npcs'
import { COFFEE_QUEST_ID } from '../../data/quests'
import { ingestSocialEvent, reconcileOutreach, resetSocial, getInvitations } from '../../game/social/socialRuntime'

beforeEach(() => {
  useGameStore.setState(createInitialGameState())
  resetSocial()
})

describe('PhoneHome', () => {
  it('shows all five stat cards from the store', () => {
    useGameStore.setState((s) => ({
      stats: { ...s.stats, money: 77, hunger: 42, energy: 88, reputation: 3, strength: 2 },
    }))
    render(<PhoneHome />)
    expect(screen.getByTestId('phone-stat-money')).toHaveTextContent('$77')
    expect(screen.getByTestId('phone-stat-hunger')).toHaveTextContent('42')
    expect(screen.getByTestId('phone-stat-energy')).toHaveTextContent('88')
    expect(screen.getByTestId('phone-stat-reputation')).toHaveTextContent('3')
    expect(screen.getByTestId('phone-stat-strength')).toHaveTextContent('2')
  })

  it('flavor line reacts to state by priority', () => {
    const q = { [COFFEE_QUEST_ID]: 'not_started' as const }
    expect(getFlavorLine({ ...INITIAL_STATS, hunger: 90 }, q, 'afternoon')).toMatch(/eat soon/)
    expect(getFlavorLine({ ...INITIAL_STATS, energy: 10 }, q, 'afternoon')).toMatch(/cooked/)
    expect(
      getFlavorLine(INITIAL_STATS, { [COFFEE_QUEST_ID]: 'active' }, 'afternoon'),
    ).toMatch(/Ravi is waiting/)
    expect(getFlavorLine(INITIAL_STATS, q, 'night')).toMatch(/City lights/)
  })
})

describe('PhoneQuests', () => {
  it('shows Coffee for Ravi with the current step highlighted', () => {
    useGameStore.setState({ questStates: { [COFFEE_QUEST_ID]: 'active' } })
    render(<PhoneQuests />)
    const quest = screen.getByTestId('phone-quest-coffee_for_ravi')
    expect(quest).toHaveTextContent('Coffee for Ravi')
    expect(screen.getByTestId('phone-quest-state')).toHaveTextContent('In progress')
    expect(quest).toHaveTextContent('✓ Talk to Ravi')
    expect(quest).toHaveTextContent('▸ Buy coffee from Maya')
    expect(screen.getByTestId('phone-quest-rewards')).toHaveTextContent('+$25')
  })

  it('shows the completed checkmark', () => {
    useGameStore.setState({ questStates: { [COFFEE_QUEST_ID]: 'completed' } })
    render(<PhoneQuests />)
    expect(screen.getByTestId('phone-quest-state')).toHaveTextContent('✓ Completed')
  })
})

describe('PhoneContacts', () => {
  it('reflects the social relationship: met status, tier, hearts, last day', () => {
    // Maya: met on day 3 + a gift she liked → known, some affinity.
    ingestSocialEvent({ id: 'met:npc_maya_01', kind: 'met', actorId: 'npc_maya_01', gameDay: 3, gameHour: 12 })
    ingestSocialEvent({ id: 'g:maya', kind: 'gift_liked', actorId: 'npc_maya_01', gameDay: 3, gameHour: 12 })
    render(<PhoneContacts />)
    for (const npc of NPC_DEFS) {
      expect(screen.getByTestId(`phone-contact-${npc.id}`)).toHaveTextContent(npc.name)
    }
    const maya = screen.getByTestId('phone-contact-npc_maya_01')
    expect(maya).toHaveTextContent('✓ Met')
    expect(maya).toHaveTextContent('♥')
    expect(maya).toHaveTextContent('Day 3')
    // Ravi has had no social contact → still a stranger.
    expect(screen.getByTestId('phone-contact-npc_ravi_01')).toHaveTextContent('Not met yet')
  })

  it('an unlocked contact can be invited out from their card', () => {
    ingestSocialEvent({ id: 'met:npc_ravi_01', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
    useGameStore.setState((s) => ({ stats: { ...s.stats, day: 1, hour: 10 } }))
    render(<PhoneContacts />)
    const invite = screen.getByTestId('contact-invite-npc_ravi_01')
    fireEvent.click(invite)
    expect(getInvitations().some((i) => i.actorId === 'npc_ravi_01' && i.source === 'player')).toBe(true)
  })
})

describe('PhoneMap', () => {
  it('renders place, player and car markers', () => {
    render(<PhoneMap />)
    for (const id of ['apartment', 'food_truck_01', 'gym', 'job_board', 'player', 'car']) {
      expect(screen.getByTestId(`map-marker-${id}`)).toBeInTheDocument()
    }
  })

  it('shows Ravi while the quest is unfinished and hides him after', () => {
    // Ravi's runtime position exists only when NPCs mount; simulate it.
    registry.npcPositions.set('npc_ravi_01', new THREE.Vector3(-8.5, 0, -5))

    useGameStore.setState({ questStates: { [COFFEE_QUEST_ID]: 'active' } })
    const { unmount } = render(<PhoneMap />)
    expect(screen.getByTestId('map-marker-ravi')).toBeInTheDocument()
    unmount()

    useGameStore.setState({ questStates: { [COFFEE_QUEST_ID]: 'completed' } })
    render(<PhoneMap />)
    expect(screen.queryByTestId('map-marker-ravi')).not.toBeInTheDocument()
  })

  it('clicking a marker shows its label', () => {
    render(<PhoneMap />)
    fireEvent.click(screen.getByTestId('map-marker-gym'))
    expect(screen.getByTestId('phone-map-caption')).toHaveTextContent('Block Gym')
  })

  it('worldToMap normalizes the sector-derived world bounds to percentages', () => {
    // Bounds now derive from the authored world (city + gateway sector).
    expect(worldToMap(MAP_BOUNDS.minX, MAP_BOUNDS.minZ)).toEqual({ left: 0, top: 0 })
    expect(worldToMap(MAP_BOUNDS.maxX, MAP_BOUNDS.maxZ)).toEqual({ left: 100, top: 100 })
    const mid = worldToMap(
      (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2,
      (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) / 2,
    )
    expect(mid.left).toBeCloseTo(50)
    expect(mid.top).toBeCloseTo(50)
    // The expansion pack grew the map north to the waterfront (z -336) and
    // east to Residential East (x 300) — the ORIGINAL city now sits in the
    // map's lower-middle band, with the new districts framing it.
    const central = worldToMap(0, 0)
    expect(central.left).toBeGreaterThan(35)
    expect(central.left).toBeLessThan(50)
    expect(central.top).toBeGreaterThan(75)
    const gateway = worldToMap(48, -84)
    expect(gateway.top).toBeGreaterThan(55)
    expect(gateway.top).toBeLessThan(70)
    // Waterfront water band is the map's far north.
    const waterfront = worldToMap(0, -325)
    expect(waterfront.top).toBeGreaterThan(0)
    expect(waterfront.top).toBeLessThan(10)
    // Industrial Yard anchors the west edge, Residential East the east.
    const yard = worldToMap(-140, -232)
    expect(yard.left).toBeGreaterThan(5)
    expect(yard.left).toBeLessThan(25)
    const residentialEast = worldToMap(250, -96)
    expect(residentialEast.left).toBeGreaterThan(80)
    expect(residentialEast.left).toBeLessThan(100)
    // Main Street North sits between the two, north of the gateway.
    const mainStreetNorth = worldToMap(115, -300)
    expect(mainStreetNorth.top).toBeGreaterThan(0)
    expect(mainStreetNorth.top).toBeLessThan(15)
    expect(mainStreetNorth.left).toBeGreaterThan(55)
  })

  it('shows district labels and future-use markers', () => {
    render(<PhoneMap />)
    for (const id of ['central', 'residential', 'industrial']) {
      expect(screen.getByTestId(`map-district-${id}`)).toBeInTheDocument()
    }
    for (const id of ['future_townhomes', 'future_warehouse', 'future_garage']) {
      expect(screen.getByTestId(`map-marker-${id}`)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByTestId('map-marker-future_garage'))
    expect(screen.getByTestId('phone-map-caption')).toHaveTextContent(/coming soon/i)
  })
})

describe('PhoneMessages', () => {
  it('has one deterministic message per resident, reacting to state', () => {
    const active = buildMessages(
      { ...INITIAL_STATS, hour: 10 },
      { [COFFEE_QUEST_ID]: 'active' },
    )
    expect(active).toHaveLength(6)
    expect(active.find((m) => m.npcId === 'npc_ravi_01')!.text).toMatch(/coffee/)
    expect(active.find((m) => m.npcId === 'npc_maya_01')!.text).toMatch(/open/)

    const night = buildMessages(
      { ...INITIAL_STATS, hour: 23, reputation: 8, energy: 20 },
      { [COFFEE_QUEST_ID]: 'completed' },
    )
    expect(night.find((m) => m.npcId === 'npc_maya_01')!.text).toMatch(/closing/)
    expect(night.find((m) => m.npcId === 'npc_kim_01')!.text).toMatch(/good things/)
    expect(night.find((m) => m.npcId === 'npc_bruno_01')!.text).toMatch(/rest up/i)
  })

  it('renders the feed', () => {
    render(<PhoneMessages />)
    for (const npc of NPC_DEFS) {
      expect(screen.getByTestId(`phone-message-${npc.id}`)).toHaveTextContent(npc.name)
    }
  })

  it('surfaces an incoming invitation and lets the player accept it', () => {
    // Ravi (met, friendly) reaches out with an invite after a few quiet days.
    ingestSocialEvent({ id: 'met:npc_ravi_01', kind: 'met', actorId: 'npc_ravi_01', gameDay: 1, gameHour: 10 })
    reconcileOutreach(4, 9)
    useGameStore.setState((s) => ({ stats: { ...s.stats, day: 4, hour: 9 } }))
    render(<PhoneMessages />)
    expect(screen.getByTestId('phone-invitations')).toBeInTheDocument()
    const inv = getInvitations().find((i) => i.actorId === 'npc_ravi_01')!
    fireEvent.click(screen.getByTestId(`invite-accept-${inv.id}`))
    expect(getInvitations().find((i) => i.id === inv.id)!.status).toBe('accepted')
  })
})

describe('PhoneSettings', () => {
  it('save/load/reset/audio buttons call the store handlers', () => {
    const saveNow = vi.fn().mockResolvedValue(true)
    const loadNow = vi.fn().mockResolvedValue(true)
    const resetSave = vi.fn().mockResolvedValue(undefined)
    const toggleAudio = vi.fn()
    useGameStore.setState({ saveNow, loadNow, resetSave, toggleAudio })

    render(<PhoneSettings />)
    fireEvent.click(screen.getByTestId('phone-save'))
    fireEvent.click(screen.getByTestId('phone-load'))
    fireEvent.click(screen.getByTestId('phone-reset'))
    fireEvent.click(screen.getByTestId('phone-audio'))
    expect(saveNow).toHaveBeenCalledOnce()
    expect(loadNow).toHaveBeenCalledOnce()
    expect(resetSave).toHaveBeenCalledOnce()
    expect(toggleAudio).toHaveBeenCalledOnce()
    expect(screen.getByTestId('phone-version')).toHaveTextContent(/BlockLife v/)
  })
})
