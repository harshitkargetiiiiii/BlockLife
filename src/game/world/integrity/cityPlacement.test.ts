import { describe, expect, it } from 'vitest'
import type { PropType } from '../worldTypes'
import { COMPILED_SECTORS } from '../authoring/compiledSectors'
import { BUILDINGS, PROPS } from '../cityLayout'
import { validateSectorPlacement } from './sectorPlacementReport'

/**
 * Runs the 3D-placement + authoring-integrity validators over EVERY district's
 * real authored data (issue §7/§8: "Run validation against every current
 * district and fix all existing failures"). A failure names the exact entity +
 * reason — fix the DATA (or encode a narrow per-TYPE intent), never weaken the
 * check or add a per-coordinate screenshot exemption. This is the permanent
 * regression guard: any future floating prop, facade clip, bad anchor or
 * duplicate route re-fails the gate here.
 */
const districts = [
  { id: 'central', buildings: BUILDINGS, props: PROPS, citizens: [] as { id: string; position: [number, number]; waypoints: readonly [number, number][] }[] },
  ...COMPILED_SECTORS.map((s) => ({ id: s.sectorId, buildings: s.buildings, props: s.props, citizens: s.citizens })),
]

describe('city placement integrity — every district, no coordinate exemptions', () => {
  for (const d of districts) {
    it(`${d.id}: no floating / clipping / bad-anchor / duplicate-route defects`, () => {
      const report = validateSectorPlacement({
        sectorId: d.id,
        buildings: d.buildings.map((b) => ({ id: b.id, position: b.position, size: b.size, door: b.door })),
        props: d.props.map((p) => ({ id: p.id, type: p.type as PropType, position: p.position, rotationY: p.rotationY })),
        citizens: (d.citizens ?? []).map((c) => ({ id: c.id, position: c.position, waypoints: c.waypoints })),
      })
      // The message lists every offender so a regression is actionable at a glance.
      const detail = report.failures.map((f) => `${f.kind} ${f.entityId} ${f.otherId ?? ''}: ${f.reason}`).join('\n')
      expect(report.failures, `\n${detail}`).toEqual([])
    })
  }

  it('covers a real, non-trivial city (props + buildings actually validated)', () => {
    const central = validateSectorPlacement({
      sectorId: 'central',
      buildings: BUILDINGS.map((b) => ({ id: b.id, position: b.position, size: b.size, door: b.door })),
      props: PROPS.map((p) => ({ id: p.id, type: p.type, position: p.position, rotationY: p.rotationY })),
    })
    expect(central.counts.props).toBeGreaterThan(100)
    expect(central.counts.solids).toBeGreaterThan(100)
  })
})
