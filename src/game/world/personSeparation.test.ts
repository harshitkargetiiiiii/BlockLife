import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PERSON_SEP_RADIUS, separateWalkerFromPeople } from './personSeparation'
import { registry } from './runtimeRegistry'
import type { Vec2 } from './worldTypes'

beforeEach(() => {
  registry.npcPositions.clear()
  registry.movingPersonIds.clear()
})

describe('person separation (no phasing between moving people)', () => {
  it('pushes a walker out of an overlapping MOVING person', () => {
    registry.npcPositions.set('other', new THREE.Vector3(0, 0, 0))
    registry.movingPersonIds.add('other')
    const pos: Vec2 = [0.1, 0]
    separateWalkerFromPeople(pos, 'self', 1)
    expect(Math.hypot(pos[0], pos[1])).toBeGreaterThan(0.1) // moved away
  })

  it('does NOT push against a STATIONARY person (never deadlock a trip)', () => {
    // A queuer/sitter/idler/arrived-trip-citizen is registered but not moving —
    // pushing a walker off its path here deadlocks deterministic waypoint trips.
    registry.npcPositions.set('sitter', new THREE.Vector3(0, 0, 0))
    const pos: Vec2 = [0.1, 0]
    separateWalkerFromPeople(pos, 'self', 1)
    expect(pos).toEqual([0.1, 0]) // unchanged
  })

  it('leaves a walker far from everyone unchanged', () => {
    registry.npcPositions.set('other', new THREE.Vector3(10, 0, 10))
    registry.movingPersonIds.add('other')
    const pos: Vec2 = [0, 0]
    separateWalkerFromPeople(pos, 'self', 1)
    expect(pos).toEqual([0, 0])
  })

  it('never pushes against itself', () => {
    registry.npcPositions.set('self', new THREE.Vector3(0, 0, 0))
    registry.movingPersonIds.add('self')
    const pos: Vec2 = [0, 0]
    separateWalkerFromPeople(pos, 'self', 1)
    expect(pos).toEqual([0, 0])
  })

  it('two near-stacked MOVING walkers separate beyond the personal-space radius over time', () => {
    const a: Vec2 = [0, 0]
    const b: Vec2 = [0.06, 0]
    for (let i = 0; i < 300; i++) {
      registry.npcPositions.clear()
      registry.movingPersonIds.clear()
      registry.npcPositions.set('a', new THREE.Vector3(a[0], 0, a[1]))
      registry.npcPositions.set('b', new THREE.Vector3(b[0], 0, b[1]))
      registry.movingPersonIds.add('a')
      registry.movingPersonIds.add('b')
      separateWalkerFromPeople(a, 'a', 0.1)
      separateWalkerFromPeople(b, 'b', 0.1)
    }
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1])
    expect(dist).toBeGreaterThanOrEqual(PERSON_SEP_RADIUS - 0.05)
    expect(Number.isFinite(dist)).toBe(true) // no NaN from coincident points
  })
})
