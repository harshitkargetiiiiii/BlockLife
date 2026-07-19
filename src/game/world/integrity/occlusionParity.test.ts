import { describe, expect, it } from 'vitest'
import {
  certifyOcclusionParity,
  checkLiveOcclusionParity,
  expectedOccludableIds,
} from './occlusionParity'
import { getSectorForContent } from '../sectors/sectorContent'

describe('occlusion parity certification', () => {
  it('certifies every district: all qualifying buildings are occludable, no silent gaps', () => {
    const report = certifyOcclusionParity()
    expect(report.totalQualifying).toBeGreaterThan(0)
    expect(report.totalMissing).toBe(0)
    expect(report.pass).toBe(true)
    // Every sector individually passes.
    for (const s of report.sectors) {
      expect(s.missing).toEqual([])
      expect(s.occludable + s.optOuts.length).toBe(s.qualifying)
    }
  })

  it('expected occludable set is non-empty and matches certified occludable count', () => {
    const report = certifyOcclusionParity()
    expect(expectedOccludableIds().size).toBe(report.totalOccludable)
  })

  it('live check: the full registered set has no missing and no phantom occluders', () => {
    const expected = expectedOccludableIds()
    const result = checkLiveOcclusionParity(expected)
    expect(result.missing).toEqual([])
    expect(result.phantom).toEqual([])
  })

  it('live check flags a phantom occluder (registered but not a qualifying building)', () => {
    const ids = [...expectedOccludableIds(), 'not_a_real_building']
    expect(checkLiveOcclusionParity(ids).phantom).toContain('not_a_real_building')
  })

  it('live check flags a qualifying building missing while its sector is streamed in', () => {
    // Find a sector with ≥2 occludable buildings, drop one, keep the sector active.
    const bySector = new Map<string, string[]>()
    for (const id of expectedOccludableIds()) {
      const s = getSectorForContent(id) ?? 'central'
      bySector.set(s, [...(bySector.get(s) ?? []), id])
    }
    const multi = [...bySector.values()].find((ids) => ids.length >= 2)
    expect(multi).toBeDefined()
    const dropped = multi![0]
    const registered = [...expectedOccludableIds()].filter((id) => id !== dropped)
    expect(checkLiveOcclusionParity(registered).missing).toContain(dropped)
  })

  it('live check does NOT flag buildings whose sector is fully unloaded', () => {
    // Nothing registered → no active sectors → nothing missing (ordinary streaming).
    expect(checkLiveOcclusionParity([]).missing).toEqual([])
  })
})
