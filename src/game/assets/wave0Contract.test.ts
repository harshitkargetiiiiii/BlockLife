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

  // ---- OWNER DECISION 2026-08-31: preserve the wardrobe / identity axes ----
  // The Wave 0 sprint characters carry ONE baked material, so they cannot expose the
  // recolorable material slots that the save-backed player wardrobe and the issue #23
  // identity axes are built on. They therefore ship as CANDIDATE assets and must stay out of
  // the player slot and out of every NPC def until they are re-authored with real material
  // segmentation. These tests are the regression guard for that decision.

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

  it('every NPC def names an asset that can carry its identity axes', () => {
    for (const npc of NPC_DEFS) {
      const def = CHARACTER_ASSETS[npc.characterAssetId ?? DEFAULT_CHARACTER_ASSET_ID]
      expect(def, `${npc.id} resolves an asset`).toBeTruthy()
      expect(
        Object.keys(def.materialSlots).length,
        `${npc.id} keeps recolorable identity axes`,
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

  // ---- Codex review finding 5: office night overlays vs the replacement facades ----
  it('every office window overlay plane sits on the replacement facade, inside it', () => {
    const entry = ASSET_MANIFEST_BY_ID.get('building_office_01')!
    const s = entry.scale![0]
    // Measured local bbox of the committed office GLB, centred in plan.
    const half = { x: 2.6171 * s, z: 2.6643 * s }
    const height = 9.9992 * s
    const defs = WINDOW_OVERLAYS.filter((d) => d.buildingAssetId === 'building_office_01')
    expect(defs.length, 'office overlays are authored').toBeGreaterThan(0)
    for (const d of defs) {
      const normalHalf = d.facade === 'east' || d.facade === 'west' ? half.x : half.z
      const lateralHalf = d.facade === 'east' || d.facade === 'west' ? half.z : half.x
      // The plane must hug its wall — proud of it, but not floating off the building.
      expect(d.facadeDistance, `${d.facade} plane is outside the wall`).toBeGreaterThanOrEqual(normalHalf)
      expect(d.facadeDistance, `${d.facade} plane hugs the wall`).toBeLessThanOrEqual(normalHalf + 0.1)
      // Every window, including its half-width, stays within the facade.
      const outer = d.start[0] + (d.columns - 1) * d.spacing[0] + d.windowSize[0] / 2
      expect(Math.abs(d.start[0]) + d.windowSize[0] / 2, `${d.facade} first column`).toBeLessThanOrEqual(lateralHalf)
      expect(outer, `${d.facade} last column`).toBeLessThanOrEqual(lateralHalf)
      // ...and the top row stays under the roof.
      const top = d.start[1] + (d.rows - 1) * d.spacing[1] + d.windowSize[1] / 2
      expect(top, `${d.facade} top row under the roof`).toBeLessThanOrEqual(height)
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
