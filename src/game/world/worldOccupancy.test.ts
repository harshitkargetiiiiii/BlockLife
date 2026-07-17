import { describe, expect, it } from 'vitest'
import { collectSolidFootprints, PROP_SOLIDITY, validateWorldOccupancy } from './solidFootprints'
import { AMBIENT_CITIZENS } from '../citizens/ambientCitizenData'
import { PROPS } from './cityLayout'
import { NPC_DEFS } from '../../data/npcs'

/**
 * The universal no-phasing gate: every solid object in the city — buildings,
 * street furniture, parked vehicles — is checked pairwise, and every citizen
 * spawn/waypoint must start clear of all of them. Any future content edit
 * that would make two objects interpenetrate fails here, before it renders.
 */
describe('world occupancy (everything holds a proper solid value)', () => {
  it('every prop type has an explicit solidity decision', () => {
    for (const prop of PROPS) {
      expect(PROP_SOLIDITY[prop.type], `spec for ${prop.type}`).toBeDefined()
    }
  })

  it('no solid object overlaps any other solid object', () => {
    expect(validateWorldOccupancy()).toEqual([])
  })

  it('citizens spawn and walk clear of everything solid (full route sampling)', () => {
    const clearPoints = AMBIENT_CITIZENS.flatMap((c) =>
      // Sitters intentionally sit ON benches; their spawn is exempt.
      c.behaviorType === 'sit'
        ? []
        : [{ id: `${c.id} spawn`, x: c.position[0], z: c.position[1], clearance: 0.3 }],
    )
    const clearPaths = AMBIENT_CITIZENS.filter((c) => (c.waypoints?.length ?? 0) > 1).map(
      (c) => ({
        id: `${c.id} route`,
        points: c.waypoints!,
        loop: c.behaviorType === 'loop_walk',
        clearance: 0.22,
      }),
    )
    expect(validateWorldOccupancy({ clearPoints, clearPaths })).toEqual([])
  })

  it('named NPCs idle and patrol clear of everything solid (full route sampling)', () => {
    const clearPoints: { id: string; x: number; z: number; clearance: number }[] = []
    const clearPaths: { id: string; points: [number, number][]; loop?: boolean; clearance: number }[] = []
    for (const npc of NPC_DEFS) {
      for (const entry of npc.routine) {
        if (entry.mode === 'idle') {
          clearPoints.push({
            id: `${npc.id} idle ${entry.from}-${entry.to}`,
            x: entry.points[0][0],
            z: entry.points[0][1],
            clearance: 0.3,
          })
        } else {
          clearPaths.push({
            id: `${npc.id} patrol ${entry.from}-${entry.to}`,
            points: entry.points,
            loop: true,
            clearance: 0.22,
          })
        }
      }
    }
    expect(validateWorldOccupancy({ clearPoints, clearPaths })).toEqual([])
  })

  it('collects a full-city footprint set (buildings + furniture + parked vehicles)', () => {
    const footprints = collectSolidFootprints()
    expect(footprints.filter((f) => f.source === 'building').length).toBeGreaterThanOrEqual(40)
    expect(footprints.filter((f) => f.source === 'prop').length).toBeGreaterThanOrEqual(90)
  })
})
