import { describe, expect, it } from 'vitest'
import { findNearestInteractable } from './useNearbyInteractable'
import type { InteractableDef } from './interactableTypes'

const defs: InteractableDef[] = [
  { id: 'a', kind: 'gym', name: 'A', position: [0, 0, 0], radius: 3 },
  { id: 'b', kind: 'apartment', name: 'B', position: [2, 0, 0], radius: 3 },
  { id: 'npc', kind: 'npc', name: 'N', dynamic: 'npc', radius: 2 },
]

describe('findNearestInteractable', () => {
  it('returns null when nothing is in range', () => {
    expect(findNearestInteractable({ x: 50, z: 50 }, defs, () => null)).toBeNull()
  })

  it('returns the closest interactable within its radius', () => {
    expect(findNearestInteractable({ x: 1.4, z: 0 }, defs, () => null)).toBe('b')
    expect(findNearestInteractable({ x: 0.4, z: 0 }, defs, () => null)).toBe('a')
  })

  it('resolves dynamic positions through the callback', () => {
    const near = findNearestInteractable({ x: 10, z: 10 }, defs, (d) =>
      d.dynamic === 'npc' ? { x: 10.5, z: 10 } : null,
    )
    expect(near).toBe('npc')
  })

  it('ignores dynamic interactables that cannot be resolved', () => {
    expect(findNearestInteractable({ x: 10, z: 10 }, defs, () => null)).toBeNull()
  })

  it('keeps the current interactable when a challenger is only marginally closer', () => {
    // Standing at x=1.05: "b" (at x=2) is slightly closer than "a" (at x=0),
    // but not by enough to steal focus from the currently active "a".
    expect(findNearestInteractable({ x: 1.05, z: 0 }, defs, () => null, 'a')).toBe('a')
    // Without a current selection, the raw nearest wins.
    expect(findNearestInteractable({ x: 1.05, z: 0 }, defs, () => null)).toBe('b')
  })

  it('lets a clearly closer challenger take over', () => {
    expect(findNearestInteractable({ x: 1.9, z: 0 }, defs, () => null, 'a')).toBe('b')
  })

  it('keeps the current interactable within its grace margin just past the radius', () => {
    // 3.3 > radius 3, but within the 20% sticky margin — and nothing else near.
    expect(findNearestInteractable({ x: -3.3, z: 0 }, defs, () => null, 'a')).toBe('a')
    // Well beyond the margin it finally drops.
    expect(findNearestInteractable({ x: -4, z: 0 }, defs, () => null, 'a')).toBeNull()
  })
})
