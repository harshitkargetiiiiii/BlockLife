import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { render, screen } from '@testing-library/react'
import {
  AMBIENT_CITIZENS,
  CORE_CITIZENS,
  isCitizenActive,
  MAX_RIGGED_AMBIENT,
  RIGGED_AMBIENT_IDS,
  validateAmbientCitizens,
} from './ambientCitizenData'
import { ambientCitizenRuntime, AmbientCitizens } from './AmbientCitizens'
import { COMPILED_SECTORS } from '../world/authoring/compiledSectors'
import { registry } from '../world/runtimeRegistry'
import { useGameStore, createInitialGameState } from '../store/useGameStore'
import { PhoneContacts } from '../../app/phone/PhoneContacts'
import { NPC_DEFS } from '../../data/npcs'
import { PROPS, CITY_BOUNDS } from '../world/cityLayout'

beforeEach(() => {
  useGameStore.setState(createInitialGameState())
})

describe('ambient citizen data', () => {
  it('is valid: unique ids, correct districts, no road spawns', () => {
    expect(validateAmbientCitizens(AMBIENT_CITIZENS)).toEqual([])
  })

  it('has a bustling-city population: 50 peds spread across all six blocks', () => {
    expect(AMBIENT_CITIZENS.length).toBe(90) // 50 core + 2 gateway + 26 kit + 6 Harbor Cross + 6 destination-driven
    for (const district of [
      'central',
      'residential',
      'industrial',
      'residential_west',
      'residential_south',
      'industrial_north',
    ] as const) {
      const count = AMBIENT_CITIZENS.filter((c) => c.district === district).length
      expect(count, `${district} population`).toBeGreaterThanOrEqual(3)
    }
    // A living mix: walkers, idlers, sitters and queues all present.
    for (const behavior of ['loop_walk', 'visit_spot', 'idle_stand', 'sit', 'queue'] as const) {
      expect(
        AMBIENT_CITIZENS.some((c) => c.behaviorType === behavior),
        `some ${behavior}`,
      ).toBe(true)
    }
  })

  it('validation catches broken entries', () => {
    const good = AMBIENT_CITIZENS[0]
    const errors = validateAmbientCitizens([
      { ...good, id: 'dup' },
      { ...good, id: 'dup' },
      { ...good, id: 'on_road', position: [0, -26] },
      { ...good, id: 'wrong_district', district: 'industrial' },
      { ...good, id: 'walk_no_points', behaviorType: 'loop_walk', waypoints: undefined },
    ])
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true)
    expect(errors.some((e) => e.includes('road'))).toBe(true)
    expect(errors.some((e) => e.includes('district'))).toBe(true)
    expect(errors.some((e) => e.includes('waypoints'))).toBe(true)
  })

  it('activeHours gate citizens by time of day (with midnight wrap)', () => {
    const jogger = AMBIENT_CITIZENS.find((c) => c.id === 'cit_jogger')!
    expect(isCitizenActive(jogger, 8)).toBe(true)
    expect(isCitizenActive(jogger, 20)).toBe(false)
    expect(isCitizenActive({ ...jogger, activeHours: [22, 4] }, 23)).toBe(true)
    expect(isCitizenActive({ ...jogger, activeHours: [22, 4] }, 12)).toBe(false)
    expect(isCitizenActive({ ...jogger, activeHours: undefined }, 3)).toBe(true)
  })

  // Issue #23: the bounded subset promoted to the rigged character pipeline.
  it('rigged ambient subset is bounded, in-crowd, and never a sitter', () => {
    const ids = new Set(AMBIENT_CITIZENS.map((c) => c.id))
    expect(RIGGED_AMBIENT_IDS.size).toBeGreaterThan(0)
    // Hard cap: the skinned-ambient count can never blow the frame budget.
    expect(RIGGED_AMBIENT_IDS.size).toBeLessThanOrEqual(MAX_RIGGED_AMBIENT)
    for (const id of RIGGED_AMBIENT_IDS) {
      expect(ids.has(id), `${id} is a real citizen`).toBe(true)
      const c = AMBIENT_CITIZENS.find((x) => x.id === id)!
      // The shared rig has idle/walk/run but no sit clip → sitters stay primitive.
      expect(c.behaviorType, `${id} is not a sitter`).not.toBe('sit')
    }
    // Deterministic membership: exactly the non-sitting core citizens.
    const expected = CORE_CITIZENS.filter((c) => c.behaviorType !== 'sit').map((c) => c.id)
    expect([...RIGGED_AMBIENT_IDS].sort()).toEqual(expected.sort())
  })
})

describe('parked vehicles + density props (data)', () => {
  it('prop ids are unique and everything sits inside the city bounds', () => {
    const ids = PROPS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const parked = PROPS.filter((p) => p.type === 'parked_car' || p.type === 'parked_truck')
    expect(parked.length).toBeGreaterThanOrEqual(8)
    expect(parked.length).toBeLessThanOrEqual(30)
    // Hand-placed rows stay in the core city; kit-scattered rows must sit
    // inside their own sector's walled area.
    for (const p of parked) {
      const kit = p.id.match(/^(s-?\d+_-?\d+)_/)
      if (kit) {
        const area = COMPILED_SECTORS.find((c) => c.sectorId === kit[1])!.spec.area
        expect(p.position[0], p.id).toBeGreaterThan(area.minX)
        expect(p.position[0], p.id).toBeLessThan(area.maxX)
        expect(p.position[1], p.id).toBeGreaterThan(area.minZ)
        expect(p.position[1], p.id).toBeLessThan(area.maxZ)
      } else {
        expect(p.position[0]).toBeGreaterThan(CITY_BOUNDS.minX)
        expect(p.position[0]).toBeLessThan(CITY_BOUNDS.maxX)
        expect(p.position[1]).toBeGreaterThan(CITY_BOUNDS.minZ)
        expect(p.position[1]).toBeLessThan(CITY_BOUNDS.maxZ)
      }
    }
  })

  it('density props exist in every district', () => {
    const has = (type: string, test: (x: number, z: number) => boolean) =>
      PROPS.some((p) => p.type === type && test(p.position[0], p.position[1]))
    // Central storefronts
    expect(has('signboard', (x, z) => Math.abs(x) < 21 && Math.abs(z) < 21)).toBe(true)
    expect(has('table_set', (x, z) => Math.abs(x) < 21 && Math.abs(z) < 21)).toBe(true)
    // Residential
    expect(has('porch_light', (_x, z) => z < -36)).toBe(true)
    expect(has('flower_pot', (_x, z) => z < -36)).toBe(true)
    // Industrial
    expect(has('pallet', (x) => x > 36)).toBe(true)
    expect(has('crate', (x) => x > 36)).toBe(true)
    expect(has('barrel', (x) => x > 36)).toBe(true)
    expect(has('dumpster', (x) => x > 36)).toBe(true)
  })
})

describe('AmbientCitizens (R3F)', () => {
  it('renders the whole crowd and registers runtime + traffic entries', async () => {
    // With 50 citizens on different schedules no single hour opens every
    // activeHours window — assert against whoever is on the clock at 10:00.
    useGameStore.setState((s) => ({ stats: { ...s.stats, hour: 10 } }))
    const renderer = await ReactThreeTestRenderer.create(<AmbientCitizens />)
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(2, 1 / 60)
    })
    expect(ambientCitizenRuntime.size).toBe(AMBIENT_CITIZENS.length)
    const activeAtTen = AMBIENT_CITIZENS.filter((c) => isCitizenActive(c, 10))
    // Most of the city is out mid-morning.
    expect(activeAtTen.length).toBeGreaterThanOrEqual(40)
    for (const def of AMBIENT_CITIZENS) {
      expect(
        renderer.scene.findAll((n) => n.props.name === `citizen:${def.id}`).length,
        `citizen ${def.id}`,
      ).toBe(1)
    }
    for (const def of activeAtTen) {
      // Cars brake for citizens: active ones are in the shared position registry.
      expect(registry.npcPositions.has(def.id), `${def.id} in npcPositions`).toBe(true)
    }
    await renderer.unmount()
    expect(ambientCitizenRuntime.size).toBe(0)
    expect(registry.npcPositions.has(AMBIENT_CITIZENS[0].id)).toBe(false)
  })
})

describe('Phone Contacts stays named-NPCs-only', () => {
  it('lists exactly the six residents, no ambient citizens', () => {
    render(<PhoneContacts />)
    const contacts = screen.getByTestId('phone-contacts')
    expect(contacts.children).toHaveLength(NPC_DEFS.length)
    for (const c of AMBIENT_CITIZENS) {
      expect(screen.queryByTestId(`phone-contact-${c.id}`)).not.toBeInTheDocument()
    }
  })
})

// Silence React boundary noise from unrelated GLB fallbacks if any load paths run.
vi.spyOn(console, 'warn').mockImplementation(() => {})
