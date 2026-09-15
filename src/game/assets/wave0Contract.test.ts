// @vitest-environment node
// (GLTFLoader.parse reads the GLB binary chunks; jsdom mis-handles that.)
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspect } from '../../../scripts/human-proof/inspectRig.mjs'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import {
  CANDIDATE_CHARACTER_ASSET_IDS,
  CHARACTER_ASSETS,
  DEFAULT_CHARACTER_ASSET_ID,
  PLAYER_CHARACTER_ASSET_ID,
  WAVE4_NAMED_BODIES,
  resolveClips,
} from '../characters/characterManifest'
import { NPC_DEFS } from '../../data/npcs'
import { WINDOW_OVERLAYS } from '../world/windowOverlayData'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../traffic/vehicleObstacles'
import provenance from '../../../docs/asset-provenance/wave0-provenance.json'

/**
 * Issue #38 Integration Wave 0 — asset contract, asserted against the REAL committed bytes.
 * Nothing here trusts the sprint report or the provenance file's own claims: every structural
 * fact is re-parsed from the GLB that actually ships.
 */

const CHARACTERS = ['blocklife_kabir_01', 'blocklife_ravi_01'] as const
const STATICS = ['prop_park_bench_01', 'building_office_01', 'vehicle_compact_car_01'] as const
const WAVE0_STATIC_FILES = [
  'public/assets/models/vehicles/compact_sedan_01.glb',
  'public/assets/models/city/arch_office_01.glb',
  'public/assets/models/props/prop_park_bench_01.glb',
]
const MAX_TEXTURE = 1024

/** Minimal GLB JSON-chunk reader — same approach as scripts/assetReport.mjs. */
function readGlb(path: string) {
  const buf = readFileSync(path)
  const length = buf.readUInt32LE(8)
  let offset = 12
  let json: any = null
  let bin: Buffer | null = null
  while (offset + 8 <= length) {
    const chunkLen = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const data = buf.subarray(offset + 8, offset + 8 + chunkLen)
    if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (chunkType === 0x004e4942) bin = data
    offset += 8 + chunkLen
  }
  return { json, bin, bytes: buf }
}

function imageDims(bytes: Buffer) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) { o++; continue }
      const m = bytes[o + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: bytes.readUInt16BE(o + 5), w: bytes.readUInt16BE(o + 7) }
      }
      o += 2 + bytes.readUInt16BE(o + 2)
    }
  }
  return null
}

function textureDims(path: string) {
  const { json, bin } = readGlb(path)
  return (json.images ?? []).map((img: any) => {
    const v = json.bufferViews[img.bufferView]
    return imageDims(bin!.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength))
  })
}

describe('issue #38 Wave 0 — production GLB contract (real bytes)', () => {
  it('every Wave 0 manifest entry is enabled, has a fallback, attribution and license', () => {
    for (const id of [...CHARACTERS, ...STATICS]) {
      const entry = ASSET_MANIFEST_BY_ID.get(id)
      expect(entry, `manifest entry ${id}`).toBeTruthy()
      expect(entry!.enabled, `${id} enabled`).toBe(true)
      expect(entry!.glbPath, `${id} glbPath`).toMatch(/\.glb$/)
      expect(entry!.fallbackKey, `${id} fallbackKey`).toBeTruthy()
      expect(entry!.attribution, `${id} attribution`).toBeTruthy()
      expect(entry!.license, `${id} license`).toBeTruthy()
    }
  })

  it('characters keep the canonical 24-bone rig and valid skinning', async () => {
    for (const id of CHARACTERS) {
      const path = `public/${ASSET_MANIFEST_BY_ID.get(id)!.glbPath}`
      const r = await inspect(path)
      expect(r.bones, `${id} bones`).toBe(24)
      expect(r.hierarchySignature, `${id} hierarchy`).toBe('c432d433d51d')
      expect(r.bindMatrices, `${id} bind matrices`).toBe(24)
      expect(r.skinInfluences.nanVerts, `${id} NaN weights`).toBe(0)
      expect(r.skinInfluences.zeroWeightVerts, `${id} zero-weight verts`).toBe(0)
      expect(r.skinInfluences.maxPerVertex, `${id} max influences`).toBeGreaterThan(1)
      expect(r.skinInfluences.maxPerVertex, `${id} max influences`).toBeLessThanOrEqual(4)
      expect(r.groundedBounds.baseAtGround, `${id} grounded`).toBe(true)
    }
  })

  it('each character ships ONE GLB carrying all three semantic clips', async () => {
    for (const id of CHARACTERS) {
      const path = `public/${ASSET_MANIFEST_BY_ID.get(id)!.glbPath}`
      const r = await inspect(path)
      expect(r.clips.map((c: { name: string }) => c.name).sort(), `${id} clips`).toEqual(['Idle', 'Run', 'Walk'])
      // The roles must resolve through the EXISTING alias path — no new animation system.
      const def = CHARACTER_ASSETS[id]
      expect(def, `${id} character def`).toBeTruthy()
      const clips = r.clips.map((c: { name: string; duration: number }) => ({ name: c.name, duration: c.duration }) as never)
      const { resolved, missing } = resolveClips(def, clips)
      expect(missing, `${id} missing roles`).toEqual([])
      expect(Object.keys(resolved).sort(), `${id} resolved roles`).toEqual(['idle', 'run', 'walk'])
    }
  })

  // ---- OWNER DECISION 2026-08-31, NARROWED by issue #47 (2026-09-04) ----
  // A baked single-material body cannot expose the recolorable material slots the SAVE-BACKED
  // PLAYER WARDROBE is built on, so it may never be the player. That half of the Wave 0 decision
  // is permanent and is still guarded here, verbatim.
  //
  // The other half — "and out of every NPC def" — was a blanket rule Wave 0 adopted because at
  // the time no baked body had an owner-approved 1:1 identity to justify a runtime slot. Issue
  // #47 replaces it deliberately, not by weakening it: a NAMED NPC may ride the ONE approved
  // body that depicts that exact character, the mapping is strict 1:1 and injective, and it is
  // gated by `WAVE4_NAMED_BODIES` + `src/game/assets/wave4Contract.test.ts` — which additionally
  // proves each body was BUILT from that same character's sources, that no body serves two
  // people, that the player is not in the mapping, and that every NPC without one keeps the
  // wardrobe-capable rig with its full registry identity as the fallback.
  //
  // What remains true here, and is what these tests now assert: `CANDIDATE_CHARACTER_ASSET_IDS`
  // is the register of approved bodies with NO runtime home, and a candidate must stay out of
  // both the player slot and every NPC def.

  it('the player keeps the wardrobe-capable rig, not a baked-material candidate', () => {
    expect(PLAYER_CHARACTER_ASSET_ID).toBe(DEFAULT_CHARACTER_ASSET_ID)
    expect(PLAYER_CHARACTER_ASSET_ID).toBe('blocklife_person')
    const player = CHARACTER_ASSETS[PLAYER_CHARACTER_ASSET_ID]
    expect(player).toBeTruthy()
    // The player must expose the wardrobe axes the save format and issue #23 depend on.
    for (const slot of ['shirt', 'pants', 'hair']) {
      expect(Object.keys(player.materialSlots), `player exposes ${slot}`).toContain(slot)
    }
    expect(CANDIDATE_CHARACTER_ASSET_IDS).not.toContain(PLAYER_CHARACTER_ASSET_ID as never)
  })

  it('candidate characters are loadable but wired to no runtime slot', () => {
    for (const id of CANDIDATE_CHARACTER_ASSET_IDS) {
      const def = CHARACTER_ASSETS[id]
      expect(def, `${id} is a valid, loadable definition`).toBeTruthy()
      // They are candidates precisely BECAUSE they have no recolor slots — assert the reason
      // holds, so re-authoring one with real slots forces this decision to be revisited.
      expect(Object.keys(def.materialSlots), `${id} has no recolor slots`).toEqual([])
      expect(id, `${id} must not be the player`).not.toBe(PLAYER_CHARACTER_ASSET_ID)
      // ...and no NPC may name one, or that NPC silently loses its identity/accessory axes.
      const users = NPC_DEFS.filter((n) => n.characterAssetId === id).map((n) => n.id)
      expect(users, `${id} must not be referenced by any NPC def`).toEqual([])
    }
  })

  it('every NPC def names a real asset, and any NPC WITHOUT an approved 1:1 body keeps the identity axes', () => {
    for (const npc of NPC_DEFS) {
      const def = CHARACTER_ASSETS[npc.characterAssetId ?? DEFAULT_CHARACTER_ASSET_ID]
      expect(def, `${npc.id} resolves an asset`).toBeTruthy()
      // A named 1:1 body IS that character's authored identity (issue #47); everyone else must
      // still name a rig that can carry the recolorable axes issue #23 gave them.
      if (WAVE4_NAMED_BODIES[npc.id] === npc.characterAssetId) continue
      expect(
        Object.keys(def.materialSlots).length,
        `${npc.id} has no approved 1:1 body, so it must keep recolorable identity axes`,
      ).toBeGreaterThan(0)
    }
  })

  // ---- Codex review finding 4: the sedan's scale axes ----
  it('the sedan GLB projects onto the CarMesh reference shell, not a swapped one', () => {
    const entry = ASSET_MANIFEST_BY_ID.get('vehicle_compact_car_01')!
    expect(entry.glbPath).toBe('assets/models/vehicles/compact_sedan_01.glb')
    // Measured local bbox of the committed GLB (pinned byte-identical by buildWave0 --check).
    const LOCAL = { x: 1.8963, y: 0.8432, z: 0.9320 }
    const [sx, sy, sz] = entry.scale!
    // The entry yaws 90° about Y, so local X -> world LENGTH and local Z -> world WIDTH.
    expect(entry.rotation?.[1]).toBeCloseTo(Math.PI / 2, 6)
    const world = { width: LOCAL.z * sz, height: LOCAL.y * sy, length: LOCAL.x * sx }
    expect(world.width, 'world width').toBeCloseTo(2.0, 2)
    expect(world.height, 'world height').toBeCloseTo(1.61, 2)
    expect(world.length, 'world length').toBeCloseTo(3.81, 2)
    // The shell must not overhang the collider box it is projected onto.
    expect(world.width / 2).toBeLessThanOrEqual(CAR_HALF_WIDTH + 1e-6)
    expect(world.length / 2).toBeLessThanOrEqual(CAR_HALF_LENGTH + 1e-6)
  })

  // ---- Codex review finding 5, re-measured by issue #64: office night glow vs the REAL glass ----
  // The whole-building bounding box is not the glazing. The office's windows are recessed behind its
  // piers, so the Wave 0 grids — planes "just outside the AABB" — floated 0.03–0.46 m in front of the
  // actual surface and crossed the sign band, sills and parapet (issue #63 native night capture).
  // These tests measure against the shipped triangles instead.

  /**
   * Glass panes the office grids light, in calibrated model metres on the overlay's own axes (lateral =
   * z on the east face, x on the south face). Located by 1 mm scans of the outermost surface from each
   * pane's centre until it left the pane's glass plane by > 12 mm, rounded INWARD to 1 cm, and reviewed
   * against the baked atlas: the lower glazed floor's clean panes. The upper floor's glass carries baked
   * bars/muntins, and the south face's narrow left light breaks the uniform column spacing; neither is lit.
   */
  const OFFICE_GLASS_PANES: Record<'east' | 'south', { lateral: [number, number]; y: [number, number] }[]> = {
    east: [
      { lateral: [-1.49, -0.60], y: [3.86, 4.32] }, { lateral: [-0.46, 0.48], y: [3.86, 4.33] }, { lateral: [0.62, 1.48], y: [3.85, 4.32] },
      { lateral: [-1.49, -0.61], y: [4.41, 4.94] }, { lateral: [-0.46, 0.48], y: [4.41, 4.92] }, { lateral: [0.62, 1.48], y: [4.41, 4.94] },
    ],
    south: [
      { lateral: [-0.26, 0.51], y: [3.86, 4.32] }, { lateral: [0.65, 1.50], y: [3.85, 4.32] },
      { lateral: [-0.26, 0.51], y: [4.39, 4.94] }, { lateral: [0.65, 1.50], y: [4.39, 4.93] },
    ],
  }

  /** Every overlay cell's rectangle, laid out exactly as WindowOverlays.buildInstances places it. */
  function officeCells() {
    const defs = WINDOW_OVERLAYS.filter((d) => d.buildingAssetId === 'building_office_01')
    return defs.flatMap((d) => Array.from({ length: d.rows * d.columns }, (_, i) => {
      const row = Math.floor(i / d.columns)
      const col = i % d.columns
      const lateral = d.start[0] + col * d.spacing[0]
      const y = d.start[1] + row * d.spacing[1]
      const [hw, hh] = [d.windowSize[0] / 2, d.windowSize[1] / 2]
      return { d, name: `${d.facade} r${row}c${col}`, lateral: [lateral - hw, lateral + hw] as [number, number], y: [y - hh, y + hh] as [number, number] }
    }))
  }

  it('every office overlay cell lies inside exactly one measured glass pane, inset by at least 5 cm', () => {
    const entry = ASSET_MANIFEST_BY_ID.get('building_office_01')!
    const s = entry.scale![0]
    // Measured local bbox of the committed office GLB, centred in plan: the OUTER guards only.
    const half = { x: 2.6171 * s, z: 2.6643 * s }
    const height = 9.9992 * s
    const defs = WINDOW_OVERLAYS.filter((d) => d.buildingAssetId === 'building_office_01')
    expect(defs.map((d) => d.facade), 'one grid per camera-facing office facade').toEqual(['east', 'south'])
    const used = new Map<string, string>()
    for (const cell of officeCells()) {
      const { d } = cell
      const facade = d.facade as 'east' | 'south'
      const normalHalf = facade === 'east' ? half.x : half.z
      const lateralHalf = facade === 'east' ? half.z : half.x
      // A recessed pane's plane is INSIDE the whole-building extreme, never forced out to it.
      expect(d.facadeDistance, `${cell.name} plane inside the building extreme`).toBeLessThan(normalHalf)
      expect(Math.max(...cell.lateral.map(Math.abs)), `${cell.name} within the facade width`).toBeLessThanOrEqual(lateralHalf)
      expect(cell.y[1], `${cell.name} under the roof`).toBeLessThanOrEqual(height)
      const hosts = OFFICE_GLASS_PANES[facade].map((pane, i) => ({ pane, key: `${facade}#${i}` })).filter(({ pane }) =>
        cell.lateral[0] - pane.lateral[0] >= 0.05 && pane.lateral[1] - cell.lateral[1] >= 0.05 &&
        cell.y[0] - pane.y[0] >= 0.05 && pane.y[1] - cell.y[1] >= 0.05)
      expect(hosts.map((h) => h.key), `${cell.name} sits inset inside exactly one pane`).toHaveLength(1)
      expect(used.has(hosts[0].key), `${cell.name} shares its pane with ${used.get(hosts[0].key)}`).toBe(false)
      used.set(hosts[0].key, cell.name)
    }
    expect(used.size, 'every measured pane carries exactly one cell').toBe(OFFICE_GLASS_PANES.east.length + OFFICE_GLASS_PANES.south.length)
  })

  it('every office overlay plane sits 15–40 mm proud of planar, recessed glass at every SAMPLED point of its rectangle (real triangles)', () => {
    const entry = ASSET_MANIFEST_BY_ID.get('building_office_01')!
    const s = entry.scale![0]
    const { json, bin } = readGlb(`public/${entry.glbPath}`)
    // One identity node and one indexed primitive: the POSITION accessor is already model space.
    expect(json.nodes, 'single untransformed node').toHaveLength(1)
    expect(json.nodes[0].matrix ?? json.nodes[0].translation ?? json.nodes[0].rotation ?? json.nodes[0].scale).toBeUndefined()
    expect(json.meshes[0].primitives, 'single primitive').toHaveLength(1)
    const primitive = json.meshes[0].primitives[0]
    const read = (index: number, width: number) => {
      const accessor = json.accessors[index]
      const view = json.bufferViews[accessor.bufferView]
      const size = accessor.componentType === 5126 ? 4 : accessor.componentType === 5123 ? 2 : 4
      const stride = view.byteStride ?? size * width
      const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
      const out = new Float64Array(accessor.count * width)
      for (let k = 0; k < out.length; k++) {
        const at = base + Math.floor(k / width) * stride + (k % width) * size
        out[k] = accessor.componentType === 5126 ? bin!.readFloatLE(at) : accessor.componentType === 5123 ? bin!.readUInt16LE(at) : bin!.readUInt32LE(at)
      }
      return out
    }
    const positions = read(primitive.attributes.POSITION, 3).map((v) => v * s)
    const indices = read(primitive.indices, 1)
    expect(indices.length, 'the shipped index count').toBe(49770)
    /** Outermost surface depth along the facade normal at (lateral, y): an axis-aligned ray from outside. */
    const outermost = (facade: 'east' | 'south', lateral: number, y: number) => {
      const [normalAxis, lateralAxis] = facade === 'east' ? [0, 2] : [2, 0]
      let best = -Infinity
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3]
        const [ax, ay, bx, by, cx, cy] = [positions[a + lateralAxis], positions[a + 1], positions[b + lateralAxis], positions[b + 1], positions[c + lateralAxis], positions[c + 1]]
        const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if (Math.abs(den) < 1e-12) continue
        const w0 = ((by - cy) * (lateral - cx) + (cx - bx) * (y - cy)) / den
        const w1 = ((cy - ay) * (lateral - cx) + (ax - cx) * (y - cy)) / den
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue
        best = Math.max(best, w0 * positions[a + normalAxis] + w1 * positions[b + normalAxis] + (1 - w0 - w1) * positions[c + normalAxis])
      }
      return best
    }
    const halfNormal = { east: 2.6171 * s, south: 2.6643 * s }
    for (const cell of officeCells()) {
      const facade = cell.d.facade as 'east' | 'south'
      // Sampled, not a continuous proof: an 11 × 11 lattice over the rectangle, its centre, four corners and edges included.
      const depths: number[] = []
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          depths.push(outermost(facade, cell.lateral[0] + (cell.lateral[1] - cell.lateral[0]) * i / 10, cell.y[0] + (cell.y[1] - cell.y[0]) * j / 10))
        }
      }
      const [nearest, deepest] = [Math.max(...depths), Math.min(...depths)]
      expect(Number.isFinite(deepest), `${cell.name} has surface under every sampled point`).toBe(true)
      expect(nearest - deepest, `${cell.name} samples one planar pane (no sill, mullion or transom sampled)`).toBeLessThanOrEqual(0.006)
      expect(halfNormal[facade] - nearest, `${cell.name} sampled surface is recessed glass, not a pier or wall`).toBeGreaterThanOrEqual(0.3)
      expect(cell.d.facadeDistance - nearest, `${cell.name} plane is in front of every sampled glass point`).toBeGreaterThanOrEqual(0.015)
      expect(cell.d.facadeDistance - deepest, `${cell.name} plane hugs every sampled glass point`).toBeLessThanOrEqual(0.04)
    }
  })

  it('every Wave 0 texture is at most 1024 and is a format the asset gate can measure', () => {
    const files = [
      ...CHARACTERS.map((id) => `public/${ASSET_MANIFEST_BY_ID.get(id)!.glbPath}`),
      ...WAVE0_STATIC_FILES,
    ]
    for (const f of files) {
      const dims = textureDims(f)
      expect(dims.length, `${f} texture count`).toBeGreaterThan(0)
      for (const d of dims) {
        // A null here means the gate cannot measure the format (e.g. WebP) and would pass
        // vacuously — that is a failure, not a pass.
        expect(d, `${f} texture dimensions must be measurable (PNG/JPEG)`).not.toBeNull()
        expect(Math.max(d!.w, d!.h), `${f} texture edge`).toBeLessThanOrEqual(MAX_TEXTURE)
      }
    }
  })

  it('Wave 0 materials are non-emissive, non-metallic and free of stray scene objects', () => {
    const files = [
      ...CHARACTERS.map((id) => `public/${ASSET_MANIFEST_BY_ID.get(id)!.glbPath}`),
      ...WAVE0_STATIC_FILES,
    ]
    for (const f of files) {
      const { json } = readGlb(f)
      expect(json.cameras ?? [], `${f} cameras`).toHaveLength(0)
      expect(json.extensions?.KHR_lights_punctual?.lights ?? [], `${f} lights`).toHaveLength(0)
      expect((json.extensionsUsed ?? []).filter((e: string) => /draco|meshopt|ktx2/i.test(e)), `${f} loader deps`).toHaveLength(0)
      for (const m of json.materials ?? []) {
        const pbr = m.pbrMetallicRoughness ?? {}
        expect(pbr.metallicFactor ?? 1, `${f} material ${m.name} metallic`).toBe(0)
        expect(m.emissiveFactor ?? [0, 0, 0], `${f} material ${m.name} emissive`).toEqual([0, 0, 0])
        expect(m.emissiveTexture, `${f} material ${m.name} emissive texture`).toBeUndefined()
        expect(m.extensions?.KHR_materials_specular, `${f} material ${m.name} specular boost`).toBeUndefined()
      }
      for (const img of json.images ?? []) {
        expect(img.uri, `${f} external texture URL`).toBeUndefined() // embedded only, no network fetch
      }
    }
  })

  it('committed bytes match the recorded provenance hashes', () => {
    for (const asset of provenance.assets) {
      const actual = createHash('sha256').update(readFileSync(asset.output)).digest('hex')
      expect(actual, `${asset.output} output hash`).toBe(asset.outputSha256)
    }
  })
})
