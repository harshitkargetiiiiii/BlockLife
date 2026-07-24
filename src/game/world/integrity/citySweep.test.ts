import { describe, expect, it } from 'vitest'
import { SECTOR_DEFINITIONS } from '../sectors/sectorRegistry'
import { generateTraversalTargets, generateVisualSweepFrames } from './citySweep'

describe('generateTraversalTargets', () => {
  const targets = generateTraversalTargets()

  it('covers every authored district with at least one target', () => {
    for (const def of SECTOR_DEFINITIONS) {
      expect(targets.some((t) => t.sectorId === def.id && t.kind === 'center')).toBe(true)
    }
  })

  it('every target sits inside its sector bounds', () => {
    for (const t of targets) {
      const def = SECTOR_DEFINITIONS.find((d) => d.id === t.sectorId)!
      expect(t.x).toBeGreaterThanOrEqual(def.bounds.minX)
      expect(t.x).toBeLessThanOrEqual(def.bounds.maxX)
      expect(t.z).toBeGreaterThanOrEqual(def.bounds.minZ)
      expect(t.z).toBeLessThanOrEqual(def.bounds.maxZ)
    }
  })

  it('is deterministic', () => {
    expect(generateTraversalTargets()).toEqual(targets)
  })
})

describe('generateVisualSweepFrames', () => {
  it('emits one overview frame per map-visible district with a stable id', () => {
    const frames = generateVisualSweepFrames()
    const mapVisible = SECTOR_DEFINITIONS.filter((d) => d.map.showOnMap)
    expect(frames).toHaveLength(mapVisible.length)
    expect(frames.length).toBeGreaterThan(3)
    for (const f of frames) {
      expect(f.id).toBe(`district-${f.sectorId}-overview`)
      expect(f.certifies.length).toBeGreaterThan(0)
    }
    // Representative, not hundreds (§13).
    expect(frames.length).toBeLessThan(30)
  })
})
