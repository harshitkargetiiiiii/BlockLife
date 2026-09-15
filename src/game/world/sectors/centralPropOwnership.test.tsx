import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import type { ComponentType } from 'react'
import type * as THREE from 'three'

/**
 * Issue #68 — the central sector must visualise and collide ONLY the props it owns.
 *
 * The central registration used to call `CityBlock` / `CityColliders` without `propIds`, so both walked the global
 * `PROPS` array: every foreign prop rendered (and every solid one collided) in the central root, and again in its owning
 * sector's root whenever that sector mounted — issue #67's native ownership capture found six benches mounted twice.
 *
 * These tests exercise the ACTUAL registrations made by `sectorComponents.tsx` (captured through the registry call it
 * already makes), not hand-built `CityBlock` props. Authored ownership is counted independently from prop positions.
 * Colliders are observed through a minimal rapier stand-in that records each collider's args/position/rotation.
 */

const registered = vi.hoisted(() => new Map<string, { Visuals?: ComponentType; Colliders?: ComponentType }>())
vi.mock('./SectorManager', () => ({
  registerSectorComponents: (id: string, components: { Visuals?: ComponentType; Colliders?: ComponentType }) => registered.set(id, components),
}))
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: () => {
    throw new Error('no GLB loading in unit tests')
  },
}))
vi.mock('@react-three/rapier', async () => {
  const React = await import('react')
  const collider = (kind: string) =>
    function Collider({ args, position, rotation }: { args: number[]; position?: number[]; rotation?: number[] }) {
      return React.createElement('group', { name: `collider:${kind}`, userData: { args, position: position ?? [0, 0, 0], rotation: rotation ?? [0, 0, 0] } })
    }
  return {
    RigidBody: ({ children }: { children?: React.ReactNode }) => React.createElement('group', { name: 'rigid-body' }, children),
    CuboidCollider: collider('cuboid'),
    CylinderCollider: collider('cylinder'),
  }
})

import './sectorComponents'
import { CityBlock } from '../CityBlock'
import { CityColliders } from '../CityColliders'
import { BUILDINGS, FOOD_TRUCK, JOB_KIOSK, PARK, PROPS } from '../cityLayout'
import { PROP_SOLIDITY } from '../solidFootprints'
import { getOwnedIds } from './sectorContent'
import { worldToSectorId } from './worldGrid'

const CENTRAL = 's0_0'
const GATEWAY = 's0_-1'
const MAIN_STREET_EAST = 's1_-1'

const byPosition = (sector: string) => PROPS.filter((p) => worldToSectorId(p.position[0], p.position[1]) === sector).map((p) => p.id).sort()
const OWNED = { [CENTRAL]: byPosition(CENTRAL), [GATEWAY]: byPosition(GATEWAY), [MAIN_STREET_EAST]: byPosition(MAIN_STREET_EAST) }
const PROP_IDS = new Set(PROPS.map((p) => p.id))
const SOLID = new Set(PROPS.filter((p) => PROP_SOLIDITY[p.type]?.half).map((p) => p.id))
const solidOf = (ids: readonly string[]) => ids.filter((id) => SOLID.has(id)).sort()

const r3 = (v: number) => Math.round(v * 1000) / 1000
const sig = (args: readonly number[], position: readonly number[], rotation: readonly number[]) => JSON.stringify([args.map(r3), position.map(r3), rotation.map(r3)])
/** Collider signature → prop id, from the one PROP_SOLIDITY table every collider renderer uses. */
const PROP_BY_SIG = new Map<string, string[]>()
for (const p of PROPS) {
  const spec = PROP_SOLIDITY[p.type]
  if (!spec?.half) continue
  const [dx, dz] = spec.offset ?? [0, 0]
  const key = sig(spec.half, [p.position[0] + dx, spec.half[1], p.position[1] + dz], [0, p.rotationY ?? 0, 0])
  PROP_BY_SIG.set(key, [...(PROP_BY_SIG.get(key) ?? []), p.id])
}

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>
const root = (r: Renderer) => r.scene.instance as THREE.Object3D

/** Prop wrapper groups (`Props` names each `def.id`, directly under its `props` group) → mount count. */
function propMounts(r: Renderer): Map<string, number> {
  const out = new Map<string, number>()
  root(r).traverse((o) => { if (PROP_IDS.has(o.name) && o.parent?.name === 'props') out.set(o.name, (out.get(o.name) ?? 0) + 1) })
  return out
}
/** Prop colliders (matched by exact args/position/rotation) → count; any other collider signature → `other`. */
function colliderCensus(r: Renderer): { props: Map<string, number>; other: string[] } {
  const props = new Map<string, number>()
  const other: string[] = []
  root(r).traverse((o) => {
    if (!o.name.startsWith('collider:')) return
    const { args, position, rotation } = o.userData as { args: number[]; position: number[]; rotation: number[] }
    const key = sig(args, position, rotation)
    const ids = PROP_BY_SIG.get(key)
    if (ids?.length === 1) props.set(ids[0], (props.get(ids[0]) ?? 0) + 1)
    else other.push(`${o.name} ${key}`)
  })
  return { props, other }
}
const countNamed = (r: Renderer, name: string) => {
  let n = 0
  root(r).traverse((o) => { if (o.name === name) n++ })
  return n
}
const allOnce = (m: Map<string, number>) => [...m.values()].every((n) => n === 1)

function Sectors({ ids, layer }: { ids: readonly string[]; layer: 'Visuals' | 'Colliders' }) {
  return (
    <group name="sectors">
      {ids.map((id) => {
        const C = registered.get(id)?.[layer]
        return <group key={id} name={`sector-${id}`}>{C ? <C /> : null}</group>
      })}
    </group>
  )
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('issue #68 — central sector prop ownership (actual registrations)', () => {
  it('the real registrations exist for the central sector and its prop-hosting neighbours', () => {
    for (const id of [CENTRAL, GATEWAY, MAIN_STREET_EAST]) {
      expect(typeof registered.get(id)?.Visuals, `${id} Visuals`).toBe('function')
      expect(typeof registered.get(id)?.Colliders, `${id} Colliders`).toBe('function')
    }
  })

  it('authored ownership counted from positions matches the ownership index, and every collider signature is unique', () => {
    expect([OWNED[CENTRAL].length, OWNED[GATEWAY].length, OWNED[MAIN_STREET_EAST].length]).toEqual([157, 22, 24])
    expect(OWNED[CENTRAL]).toEqual([...getOwnedIds(CENTRAL, 'prop')].sort())
    expect(OWNED[GATEWAY]).toEqual([...getOwnedIds(GATEWAY, 'prop')].sort())
    expect(OWNED[MAIN_STREET_EAST]).toEqual([...getOwnedIds(MAIN_STREET_EAST, 'prop')].sort())
    expect([...PROP_BY_SIG.values()].filter((ids) => ids.length > 1), 'no two solid props share a collider signature').toEqual([])
    expect(PROP_IDS.has(JOB_KIOSK.id) || PROP_IDS.has(FOOD_TRUCK.id), 'kiosk and food truck are landmarks, not PROPS').toBe(false)
  })

  it('CONTROL: the pre-fix central wiring (buildingIds only) mounts every foreign prop visual and solid collider', async () => {
    const centralBuildings = getOwnedIds(CENTRAL, 'building')
    const visuals = await ReactThreeTestRenderer.create(<CityBlock buildingIds={centralBuildings} />)
    const mounts = propMounts(visuals)
    expect(mounts.size, 'all authored props').toBe(PROPS.length)
    expect([...mounts.keys()].filter((id) => !OWNED[CENTRAL].includes(id)).length, 'foreign props in the central root').toBe(PROPS.length - OWNED[CENTRAL].length)
    await visuals.unmount()
    const colliders = await ReactThreeTestRenderer.create(<CityColliders buildingIds={centralBuildings} />)
    const census = colliderCensus(colliders)
    expect([...census.props.keys()].filter((id) => !OWNED[CENTRAL].includes(id)).length, 'foreign solid prop colliders').toBe(SOLID.size - solidOf(OWNED[CENTRAL]).length)
    await colliders.unmount()
  })

  it('central alone: exactly its owned props, once each, with kiosk, food truck, buildings, ground slab and pond preserved', async () => {
    const visuals = await ReactThreeTestRenderer.create(<Sectors ids={[CENTRAL]} layer="Visuals" />)
    const mounts = propMounts(visuals)
    expect([...mounts.keys()].sort(), 'central prop wrappers').toEqual(OWNED[CENTRAL])
    expect(allOnce(mounts), 'each once').toBe(true)
    expect([countNamed(visuals, JOB_KIOSK.id), countNamed(visuals, FOOD_TRUCK.id)], 'kiosk + food truck').toEqual([1, 1])
    const centralBuildings = getOwnedIds(CENTRAL, 'building')
    expect(BUILDINGS.filter((b) => countNamed(visuals, b.id) > 0).map((b) => b.id).sort(), 'building ownership unchanged').toEqual([...centralBuildings].sort())
    await visuals.unmount()

    const colliders = await ReactThreeTestRenderer.create(<Sectors ids={[CENTRAL]} layer="Colliders" />)
    const census = colliderCensus(colliders)
    expect([...census.props.keys()].sort(), 'central solid prop colliders').toEqual(solidOf(OWNED[CENTRAL]))
    expect(allOnce(census.props), 'each once').toBe(true)
    const kiosk = sig([0.3, 1.2, 0.9], [JOB_KIOSK.position[0], 1.2, JOB_KIOSK.position[1]], [0, 0, 0])
    const truck = sig([2.6, 1.2, 1.3], [FOOD_TRUCK.position[0] - 0.4, 1.2, FOOD_TRUCK.position[1]], [0, 0, 0])
    const slab = sig([120, 0.5, 110], [16, -0.5, -13], [0, 0, 0])
    const pond = sig([0.4, PARK.pond.radius + 0.55], [PARK.pond.center[0], 0.4, PARK.pond.center[1]], [0, 0, 0])
    const count = (s: string, kind = 'cuboid') => census.other.filter((x) => x === `collider:${kind} ${s}`).length
    expect([count(kiosk), count(truck), count(slab), count(pond, 'cylinder')], 'kiosk, truck, ground slab, pond').toEqual([1, 1, 1, 1])
    await colliders.unmount()
  })

  it('central + Gateway + Main Street East mount each owned prop exactly once; removing the neighbours leaves no central duplicate', async () => {
    const union = [...OWNED[CENTRAL], ...OWNED[GATEWAY], ...OWNED[MAIN_STREET_EAST]].sort()
    const visuals = await ReactThreeTestRenderer.create(<Sectors ids={[CENTRAL, GATEWAY, MAIN_STREET_EAST]} layer="Visuals" />)
    let mounts = propMounts(visuals)
    expect([...mounts.keys()].sort(), 'three sectors').toEqual(union)
    expect([...mounts.entries()].filter(([, n]) => n !== 1), 'no prop mounted twice').toEqual([])
    expect(countNamed(visuals, JOB_KIOSK.id), 'kiosk once').toBe(1)
    await visuals.update(<Sectors ids={[CENTRAL]} layer="Visuals" />)
    mounts = propMounts(visuals)
    expect([...mounts.keys()].sort(), 'neighbours unmounted: central only').toEqual(OWNED[CENTRAL])
    expect(allOnce(mounts)).toBe(true)
    await visuals.unmount()

    const colliders = await ReactThreeTestRenderer.create(<Sectors ids={[CENTRAL, GATEWAY, MAIN_STREET_EAST]} layer="Colliders" />)
    let census = colliderCensus(colliders)
    expect([...census.props.keys()].sort(), 'three sectors').toEqual(solidOf(union))
    expect([...census.props.entries()].filter(([, n]) => n !== 1), 'no prop collider twice').toEqual([])
    const gatewayFloor = `collider:cuboid ${sig([12, 0.5, 51], [50, -0.5, -165], [0, 0, 0])}`
    const slab = `collider:cuboid ${sig([120, 0.5, 110], [16, -0.5, -13], [0, 0, 0])}`
    expect([census.other.filter((x) => x === gatewayFloor).length, census.other.filter((x) => x === slab).length], 'gateway corridor floor + central slab').toEqual([1, 1])
    await colliders.update(<Sectors ids={[CENTRAL]} layer="Colliders" />)
    census = colliderCensus(colliders)
    expect([...census.props.keys()].sort(), 'neighbours unmounted: central only').toEqual(solidOf(OWNED[CENTRAL]))
    expect(allOnce(census.props)).toBe(true)
    expect([census.other.filter((x) => x === gatewayFloor).length, census.other.filter((x) => x === slab).length], 'corridor floor leaves with its sector; slab stays').toEqual([0, 1])
    await colliders.unmount()
  })
})
