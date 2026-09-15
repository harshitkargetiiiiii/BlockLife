import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { Roads } from './Roads'
import { Districts } from './Districts'
import { roadMaterial, sidewalkMaterial } from './materials'
import { CompiledSectorVisuals } from './authoring/CompiledSector'
import { WATERFRONT_GATEWAY } from './authoring/sectors/waterfrontGateway'
import {
  LEGACY_CURB_RAMP_Y,
  LEGACY_MARKET_CURB_STRIPE_Y,
  SIDEWALK_SLAB_CENTER_Y,
  SIDEWALK_SLAB_THICKNESS,
  SIDEWALK_TOP_Y,
} from './surfaceHeights'

/**
 * Issue #58 — the legacy sidewalk slabs render their top on the shared 0.03 sidewalk layer (not 0.12),
 * with the curb ramps and market curb stripes coupled to existing tiers, while EVERYTHING else these
 * renderers draw is unchanged. The comparison is against the PRE-CHANGE renderer: its complete mesh
 * dump was captured at `c6d369bc` before this change, and the digests below are that capture. Only
 * the heights of the 30 slabs, 8 ramps and 3 stripes may differ; mapping them back must reproduce it.
 */

vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: () => { throw new Error('no GLB loading in unit tests') },
}))
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

/** Pre-change render dumps (sha256 of the serialized mesh list) and slab footprints, captured at c6d369bc. */
const PRE_CHANGE = {
  roads: { meshes: 92, sha256: '677a2808fdaf9ab97d090e4f244dbcdfc4e046afe94ebec132b676e378c713a1', slabFootprints: '14d7f677ad47284337ab82bf7b03f73b8fdb53d0d8d65a6da13a32fc8f1e1fac' },
  districts: { meshes: 201, sha256: '2d7766653d694e418f674e7d3224cd845db5184fefb6be4383007b0e5b41ece2', slabFootprints: '74e278e6534e7e7826952838f7c45f2fec82f7c119f79cefcd012df1597a3d28' },
  slabCenterY: 0.06, slabTopY: 0.12, curbRampY: 0.13, marketStripeY: 0.065,
}
const CURB_RAMPS: [number, number][] = [[0, -22.6], [0, -29.4], [-22.6, 0], [-29.4, 0], [-2, -41.4], [-2, -48.6], [43.6, 12], [52.4, 12]]
const MARKET_STRIPES: [number, number][] = [[43.2, 13.5], [43.2, 17], [43.2, 20.5]]
/** The issue's recorded player origin (X, Z), inside the west strip of the inner ring. */
const REPORTED_POINT: [number, number] = [-21.856, -18.344]

type MeshRow = {
  path: string
  geometry: string
  parameters: Record<string, number> | null
  position: number[]
  rotation: number[]
  scale: number[]
  world: number[]
  worldBox: { min: number[]; max: number[] }
  materials: string[]
  castShadow: boolean
  receiveShadow: boolean
  visible: boolean
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const matLabel = (m: THREE.Material) => m === sidewalkMaterial ? 'sidewalkMaterial' : m === roadMaterial ? 'roadMaterial'
  : `${m.type}:${(m as THREE.MeshStandardMaterial).color?.getHexString?.() ?? ''}`

/** The exact serialization of the pre-change capture (same fields, order and rounding). */
function dump(root: THREE.Object3D): MeshRow[] {
  root.updateMatrixWorld(true)
  const out: MeshRow[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const path: string[] = []
    for (let p: THREE.Object3D | null = mesh.parent; p; p = p.parent) if (p.name) path.unshift(p.name)
    const box = new THREE.Box3().setFromObject(mesh)
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    out.push({
      path: path.join('/'),
      geometry: mesh.geometry.type,
      parameters: (mesh.geometry as THREE.BufferGeometry & { parameters?: Record<string, number> }).parameters ?? null,
      position: mesh.position.toArray().map(r6), rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(r6), scale: mesh.scale.toArray().map(r6),
      world: mesh.matrixWorld.elements.map(r6),
      worldBox: { min: box.min.toArray().map(r6), max: box.max.toArray().map(r6) },
      materials: mats.map(matLabel), castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, visible: mesh.visible,
    })
  })
  return out
}

async function renderDump(name: string, element: ReactElement) {
  const renderer = await ReactThreeTestRenderer.create(<group name={`capture-${name}`}>{element}</group>)
  const root = renderer.scene.findAll((n) => n.props.name === `capture-${name}`)[0].instance as THREE.Object3D
  const rows = dump(root)
  await renderer.unmount()
  return rows
}

const isSlab = (m: MeshRow) => m.geometry === 'BoxGeometry' && m.materials[0] === 'sidewalkMaterial'
const isRamp = (m: MeshRow) => m.geometry === 'PlaneGeometry' && m.parameters?.width === 1.8 && m.parameters?.height === 1.1
const isMarketStripe = (m: MeshRow) => m.geometry === 'PlaneGeometry' && m.parameters?.width === 1.8 && m.parameters?.height === 0.14
const footprints = (rows: MeshRow[]) => sha256(JSON.stringify(rows.map((s) => [s.worldBox.min[0], s.worldBox.min[2], s.worldBox.max[0], s.worldBox.max[2]])))

/**
 * Map ONLY this change's heights back to the pre-change values. Before normalizing, every affected mesh's
 * NEW local Y, world translation Y (`world[13]`) and world-box min/max Y are asserted exactly, so the
 * normalization cannot hide a wrong world placement; the number of translated meshes is asserted too.
 */
function mapBackToPreChange(rows: MeshRow[], expectedTranslations: number): MeshRow[] {
  let translated = 0
  const mapped = rows.map((m) => {
    const copy: MeshRow = JSON.parse(JSON.stringify(m))
    const translate = (label: string, now: { y: number; minY: number; maxY: number }, before: { y: number; minY: number; maxY: number }) => {
      expect(m.position[1], `${m.path} ${label} local Y`).toBe(r6(now.y))
      expect(m.world[13], `${m.path} ${label} world translation Y`).toBe(r6(now.y))
      expect(m.worldBox.min[1], `${m.path} ${label} world box min Y`).toBe(r6(now.minY))
      expect(m.worldBox.max[1], `${m.path} ${label} world box max Y`).toBe(r6(now.maxY))
      copy.position[1] = before.y
      copy.world[13] = before.y
      copy.worldBox.min[1] = before.minY
      copy.worldBox.max[1] = before.maxY
      translated++
    }
    if (isSlab(m)) {
      translate('slab',
        { y: SIDEWALK_SLAB_CENTER_Y, minY: SIDEWALK_TOP_Y - SIDEWALK_SLAB_THICKNESS, maxY: SIDEWALK_TOP_Y },
        { y: PRE_CHANGE.slabCenterY, minY: 0, maxY: PRE_CHANGE.slabTopY })
    } else if (isRamp(m)) {
      translate('curb ramp',
        { y: LEGACY_CURB_RAMP_Y, minY: LEGACY_CURB_RAMP_Y, maxY: LEGACY_CURB_RAMP_Y },
        { y: PRE_CHANGE.curbRampY, minY: PRE_CHANGE.curbRampY, maxY: PRE_CHANGE.curbRampY })
    } else if (isMarketStripe(m)) {
      translate('market stripe',
        { y: LEGACY_MARKET_CURB_STRIPE_Y, minY: LEGACY_MARKET_CURB_STRIPE_Y, maxY: LEGACY_MARKET_CURB_STRIPE_Y },
        { y: PRE_CHANGE.marketStripeY, minY: PRE_CHANGE.marketStripeY, maxY: PRE_CHANGE.marketStripeY })
    }
    return copy
  })
  expect(translated, 'exactly the intended meshes were translated').toBe(expectedTranslations)
  return mapped
}

describe('issue #58 — legacy sidewalks on the shared 0.03 render layer', () => {
  it('the named heights put the slab TOP (not its centre) on the Gateway / compiled sidewalk layer', () => {
    expect(SIDEWALK_TOP_Y).toBe(0.03)
    expect(SIDEWALK_SLAB_THICKNESS).toBe(0.12)
    expect(SIDEWALK_SLAB_CENTER_Y).toBeCloseTo(-0.03, 12)
    expect(SIDEWALK_SLAB_CENTER_Y + SIDEWALK_SLAB_THICKNESS / 2).toBeCloseTo(SIDEWALK_TOP_Y, 12)
    expect(LEGACY_CURB_RAMP_Y).toBe(0.045)
    expect(LEGACY_MARKET_CURB_STRIPE_Y).toBe(0.032)
  })

  it('Roads: all 10 slabs top at 0.03, and nothing else differs from the pre-change renderer', async () => {
    const rows = await renderDump('Roads', <Roads />)
    expect(rows.length).toBe(PRE_CHANGE.roads.meshes)
    const slabs = rows.filter(isSlab)
    expect(slabs.length, 'central slab pieces').toBe(10)
    for (const s of slabs) {
      expect(s.worldBox.max[1], `${s.path} top`).toBe(r6(SIDEWALK_TOP_Y))
      expect(s.worldBox.min[1], `${s.path} bottom`).toBe(r6(SIDEWALK_TOP_Y - SIDEWALK_SLAB_THICKNESS))
      expect(s.parameters?.height, `${s.path} thickness`).toBe(0.12)
      expect([s.castShadow, s.receiveShadow], `${s.path} shadows`).toEqual([true, true])
    }
    expect(footprints(slabs), 'slab X/Z footprints and connector gaps').toBe(PRE_CHANGE.roads.slabFootprints)
    expect(rows.filter(isRamp).length + rows.filter(isMarketStripe).length, 'no decals in Roads').toBe(0)
    // 10 slabs; Roads has no ramps or stripes.
    expect(sha256(JSON.stringify(mapBackToPreChange(rows, 10))), 'complete Roads render tree vs pre-change').toBe(PRE_CHANGE.roads.sha256)
  })

  it('Districts: all 20 slabs top at 0.03, 8 ramps and 3 market stripes on their tiers, nothing else differs', async () => {
    const rows = await renderDump('Districts', <Districts />)
    expect(rows.length).toBe(PRE_CHANGE.districts.meshes)
    const slabs = rows.filter(isSlab)
    expect(slabs.length, 'district slab pieces').toBe(20)
    for (const s of slabs) {
      expect(s.worldBox.max[1], `${s.path} top`).toBe(r6(SIDEWALK_TOP_Y))
      expect(s.parameters?.height, `${s.path} thickness`).toBe(0.12)
    }
    expect(footprints(slabs), 'slab X/Z footprints').toBe(PRE_CHANGE.districts.slabFootprints)
    const ramps = rows.filter(isRamp)
    expect(ramps.map((m) => [m.position[0], m.position[2]]), 'curb ramp positions').toEqual(CURB_RAMPS)
    expect(ramps.map((m) => m.position[1]), 'curb ramps on the compiled curb-ramp tier').toEqual(CURB_RAMPS.map(() => r6(LEGACY_CURB_RAMP_Y)))
    const stripes = rows.filter(isMarketStripe)
    expect(stripes.map((m) => [m.position[0], m.position[2]]), 'market stripe positions').toEqual(MARKET_STRIPES)
    expect(stripes.map((m) => m.position[1]), 'market stripes on the residential stripe tier').toEqual(MARKET_STRIPES.map(() => r6(LEGACY_MARKET_CURB_STRIPE_Y)))
    // Paint sits above the slab top it lies on (no z-fighting) and below its old outlier.
    for (const y of [LEGACY_CURB_RAMP_Y, LEGACY_MARKET_CURB_STRIPE_Y]) expect(y).toBeGreaterThan(SIDEWALK_TOP_Y)
    expect(LEGACY_CURB_RAMP_Y).toBeLessThan(PRE_CHANGE.curbRampY)
    // 20 slabs + 8 ramps + 3 market stripes = 31 (41 with Roads' 10).
    expect(sha256(JSON.stringify(mapBackToPreChange(rows, 31))), 'complete Districts render tree vs pre-change').toBe(PRE_CHANGE.districts.sha256)
  })

  it('the reported player origin stands on the west inner strip, whose visible top is now 0.03 over flat Y = 0 support', async () => {
    const slabs = (await renderDump('Roads-point', <Roads />)).filter(isSlab)
    const [x, z] = REPORTED_POINT
    const under = slabs.filter((s) => x >= s.worldBox.min[0] && x <= s.worldBox.max[0] && z >= s.worldBox.min[2] && z <= s.worldBox.max[2])
    expect(under.map((s) => s.worldBox), 'exactly the west inner strip').toEqual([
      { min: [-23, r6(SIDEWALK_TOP_Y - SIDEWALK_SLAB_THICKNESS), -21], max: [-21, r6(SIDEWALK_TOP_Y), 21] },
    ])
    // Physical support is the unchanged flat slab (top 0): source-text pin of CityColliders.
    const colliders = readFileSync('src/game/world/CityColliders.tsx', 'utf8')
    expect(colliders, 'city ground collider: half-height 0.5 at centre -0.5 (top 0)').toContain('<CuboidCollider args={[120, 0.5, 110]} position={[16, -0.5, -13]} />')
    expect(colliders, 'no sidewalk-height collider added').not.toMatch(/sidewalk/i)
  })

  it('the reference compiled sidewalk / plaza layer is still 0.03 (the value the legacy slabs now match)', async () => {
    const rows = await renderDump('Compiled', <CompiledSectorVisuals compiled={WATERFRONT_GATEWAY} />)
    const sidewalkPlanes = rows.filter((m) => m.geometry === 'PlaneGeometry' && m.materials[0] === 'sidewalkMaterial' && m.path.startsWith('capture-Compiled/compiled-s0_-2'))
    expect(sidewalkPlanes.length, 'compiled sidewalk / plaza planes').toBeGreaterThan(0)
    expect([...new Set(sidewalkPlanes.map((m) => m.position[1]))], 'compiled sidewalk layer').toEqual([r6(SIDEWALK_TOP_Y)])
    const gateway = readFileSync('src/game/world/gateway/GatewaySector.tsx', 'utf8')
    expect(gateway.match(/position=\{\[road\.(minX - 1\.5|maxX \+ 1\.5), 0\.03, cz\]\}/g)?.length, 'Gateway sidewalk planes at 0.03').toBe(2)
  })
})
