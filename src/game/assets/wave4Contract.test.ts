// @vitest-environment node
// (GLTFLoader.parse and the raw GLB chunks are read directly; jsdom mis-handles both.)
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspect } from '../../../scripts/human-proof/inspectRig.mjs'
import { ASSET_MANIFEST, ASSET_MANIFEST_BY_ID } from './assetManifest'
import {
  CANDIDATE_CHARACTER_ASSET_IDS,
  CHARACTER_ASSETS,
  DEFAULT_CHARACTER_ASSET_ID,
  PLAYER_CHARACTER_ASSET_ID,
  WAVE4_NAMED_BODIES,
  resolveClips,
} from '../characters/characterManifest'
import { IDENTITY_FALLBACK_SUFFIX } from '../characters/NpcCharacter'
import { NAMED_IDENTITIES } from '../characters/populationAppearance'
import { NPC_DEFS } from '../../data/npcs'
import { BUILDINGS, PROPS } from '../world/cityLayout'
import { PROP_PLACEMENT } from '../world/propPlacement'
import { PROP_SOLIDITY } from '../world/propSolidity'
import { VEHICLE_DEFS } from '../vehicles/vehicleRegistry'
import { MAX_WORLD_RENDER_HEIGHT } from '../camera/cameraGeometry'
import {
  PARKED_BODY_ASSET_IDS,
  PARKED_BODY_MIN_SEPARATION,
  PARKED_BODY_POOLS,
  assignParkedBodies,
  parkedBodyAssignment,
} from '../world/parkedVehicleBodies'
import {
  BOUNDS_EPSILON, SCALE_DECIMALS, MAX_TEXTURE, MAX_RENDERED_HEIGHT, PROP_ENVELOPES,
  RIG_HEIGHT_METERS, RIG_FIT_TOLERANCE_METERS, RIG_FIT,
  CHARACTERS as WAVE4_CHARACTERS, BUILDINGS as WAVE4_BUILDINGS,
} from '../../../scripts/asset-intake/wave4.config.mjs'
import provenance from '../../../docs/asset-provenance/wave4-provenance.json'

/**
 * Issue #47 Integration Wave 4 — the production asset contract, asserted against the REAL
 * committed bytes. Nothing here trusts the sprint ledgers, the issue's tables or the provenance
 * file's own claims: every structural fact is re-parsed from the GLB that actually ships, and
 * every projection number is recomputed from the AUTHORED data (`cityLayout`, `propPlacement`)
 * rather than copied out of the manifest.
 *
 * The wave's three safety properties, in the order the issue states them:
 *   1. a STRICT 1:1 named-resident mapping that cannot swap, share or reach the player;
 *   2. parked bodies that fit INSIDE the authored visual envelope and change no gameplay datum;
 *   3. ONE building body on ONE placement, with the authored lot untouched.
 */

// ---------------------------------------------------------------------------------------------
// Shipped inventory — the exact bodies this wave adds, and the placements they reach.
// ---------------------------------------------------------------------------------------------

/** NPC id → (body asset id, shipped GLB). The whole of Priority 1. */
const NAMED: { npc: string; assetId: string; file: string; heightMeters: number }[] = [
  { npc: 'npc_ravi_01', assetId: 'blocklife_ravi_01', file: 'public/assets/models/characters/blocklife_ravi_01.glb', heightMeters: 1.76 },
  { npc: 'npc_maya_01', assetId: 'blocklife_maya_01', file: 'public/assets/models/characters/blocklife_maya_01.glb', heightMeters: 1.7 },
  { npc: 'npc_bruno_01', assetId: 'blocklife_bruno_01', file: 'public/assets/models/characters/blocklife_bruno_01.glb', heightMeters: 1.84 },
  { npc: 'npc_kim_01', assetId: 'blocklife_kim_01', file: 'public/assets/models/characters/blocklife_kim_01.glb', heightMeters: 1.71 },
  { npc: 'npc_nisha_01', assetId: 'blocklife_nisha_01', file: 'public/assets/models/characters/blocklife_nisha_01.glb', heightMeters: 1.7 },
]

/** Parked-vehicle bodies: id → (shipped GLB, the authored prop type it is fitted to). */
const PARKED: { assetId: string; file: string; propType: 'parked_car' | 'parked_truck'; fallbackKey: string }[] = [
  { assetId: 'vehicle_parked_hatchback_01', file: 'public/assets/models/vehicles/parked_hatchback_01.glb', propType: 'parked_car', fallbackKey: 'CarMesh' },
  { assetId: 'vehicle_parked_pickup_01', file: 'public/assets/models/vehicles/parked_pickup_01.glb', propType: 'parked_car', fallbackKey: 'CarMesh' },
  { assetId: 'vehicle_parked_delivery_van_01', file: 'public/assets/models/vehicles/parked_delivery_van_01.glb', propType: 'parked_truck', fallbackKey: 'TruckMesh' },
  { assetId: 'vehicle_parked_box_truck_01', file: 'public/assets/models/vehicles/parked_box_truck_01.glb', propType: 'parked_truck', fallbackKey: 'TruckMesh' },
]

const TOWER = {
  placement: 'building_gate_tower_02',
  assetId: 'building_gate_tower_02',
  file: 'public/assets/models/city/arch_apartment_02.glb',
  /** Measured front of the model — the provenance facade profile plus the rendered cardinals. */
  canonicalFacing: 'south' as const,
}

/**
 * The authored facts this wave's ONE building placement shipped with at the exact base commit
 * (efda5d6). Issue #47 requires every one of them to survive untouched, so the whole tuple is
 * pinned rather than a count: a wave that "fits" a model by nudging a lot fails right here.
 */
const AUTHORED_TOWER = {
  position: [34, -94] as [number, number],
  size: [8, 14, 8] as [number, number, number],
  door: 'east' as const,
  label: undefined as string | undefined,
}

/** scripts/assetReport.mjs TRI_BUDGET, and issue #47's own per-source ceilings. */
const TRI_BUDGET = { characters: 25000, vehicles: 25000, city: 60000 }

/** Issue #47's hard scope ceiling. */
const MAX_NEW_SOURCE_GLBS = 12
const MAX_TOUCHED_PLACEMENTS = 36

// ---------------------------------------------------------------------------------------------
// Byte-level helpers (same approach as scripts/assetReport.mjs — no three.js, no DOM).
// ---------------------------------------------------------------------------------------------

function readGlb(path: string) {
  const buf = readFileSync(path)
  const length = buf.readUInt32LE(8)
  let offset = 12
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  return { json, bin }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.images ?? []).map((img: any) => {
    const v = json.bufferViews[img.bufferView]
    return imageDims(bin!.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength))
  })
}

function triangles(path: string) {
  const { json } = readGlb(path)
  let tris = 0
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const count = prim.indices != null
        ? json.accessors[prim.indices].count
        : json.accessors[prim.attributes.POSITION].count
      tris += count / 3
    }
  }
  return Math.round(tris)
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** The provenance record for a shipped output, keyed by the file it claims to have produced. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recordFor = (file: string) => provenance.assets.find((a: any) => a.output === file)!

const npcDef = (id: string) => NPC_DEFS.find((n) => n.id === id)!
const buildingDef = (id: string) => BUILDINGS.find((b) => b.id === id)!

const FACING_YAW = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 } as const

const ALL_WAVE4_FILES = [
  ...NAMED.filter((n) => n.assetId !== 'blocklife_ravi_01').map((n) => n.file),
  ...PARKED.map((p) => p.file),
  TOWER.file,
]

describe('issue #47 Wave 4 — shipped bytes, provenance and scope', () => {
  it('every shipped output is byte-identical to what the recorded intake produced', () => {
    // The intake's own `--check` proves the bytes are REPRODUCIBLE from the approved sources.
    // This proves the committed file is the one that run produced — the other half.
    expect(provenance.assets.length, 'assets recorded by the Wave 4 intake').toBe(9)
    for (const a of provenance.assets) {
      expect(existsSync(a.output), `${a.output} exists`).toBe(true)
      expect(sha256(a.output), `${a.output} sha256`).toBe(a.outputSha256)
      expect(readFileSync(a.output).byteLength, `${a.output} byte count`).toBe(a.outputBytes)
    }
  })

  it('every source it was built from is an approved sprint file, named with its hash', () => {
    // The pristine sources live outside the repo, so the HASH is the contract that travels with
    // the wave. (When the intake root is present the intake itself re-asserts these before
    // reading; here we assert the record is complete and self-consistent.)
    for (const a of provenance.assets) {
      expect(a.sources.length, `${a.output} sources`).toBeGreaterThanOrEqual(1)
      for (const s of a.sources) {
        expect(s.path, `${a.output} source path`).toContain('BlockLife-intake/asset-sprint-2026-08-31')
        expect(s.sha256, `${a.output} source sha256`).toMatch(/^[0-9a-f]{64}$/)
        expect(s.bytes, `${a.output} source bytes`).toBeGreaterThan(0)
        // The approved sources are pristine Meshy outputs: no camera, no light, one mesh.
        expect(s.structure.cameras, `${s.path} cameras`).toBe(0)
        expect(s.structure.lights, `${s.path} lights`).toBe(0)
      }
    }
  })

  it('stays inside the issue’s hard scope ceiling: ≤12 new source GLBs, ≤36 touched placements', () => {
    // NEW source GLBs = the files this wave adds to public/. Ravi is deliberately not one:
    // his approved source was already built into production by Wave 0, and this wave RECONCILES
    // that existing body into his runtime slot rather than rebuilding it.
    expect(ALL_WAVE4_FILES.length, 'new source GLBs').toBe(9)
    expect(ALL_WAVE4_FILES.length).toBeLessThanOrEqual(MAX_NEW_SOURCE_GLBS)

    const parkedPlacements = PROPS.filter((p) => p.type === 'parked_car' || p.type === 'parked_truck')
    const touched = NAMED.length + parkedPlacements.length + 1 // + the one building placement
    expect(touched, 'existing authored placements this wave repaints').toBe(35)
    expect(touched).toBeLessThanOrEqual(MAX_TOUCHED_PLACEMENTS)
  })

  it('every Wave 4 manifest entry is enabled, keeps its procedural fallback, and is credited', () => {
    for (const { assetId } of [...NAMED, ...PARKED, TOWER]) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)
      expect(entry, `manifest entry ${assetId}`).toBeTruthy()
      expect(entry!.enabled, `${assetId} enabled`).toBe(true)
      expect(entry!.glbPath, `${assetId} glbPath`).toMatch(/\.glb$/)
      // The GLB is a projection, never a dependency: the procedural component stays declared.
      expect(entry!.fallbackKey, `${assetId} fallbackKey`).toBeTruthy()
      expect(entry!.attribution, `${assetId} attribution`).toBeTruthy()
      expect(entry!.license, `${assetId} license`).toBeTruthy()
    }
  })

  it('every body is within its per-source triangle and texture budget, measured from the bytes', () => {
    const budgets: [string, number][] = [
      ...NAMED.map((n) => [n.file, TRI_BUDGET.characters] as [string, number]),
      ...PARKED.map((p) => [p.file, TRI_BUDGET.vehicles] as [string, number]),
      [TOWER.file, TRI_BUDGET.city],
    ]
    for (const [file, maxTris] of budgets) {
      expect(triangles(file), `${file} triangles`).toBeLessThanOrEqual(maxTris)
      for (const dim of textureDims(file)) {
        expect(dim, `${file} texture header readable`).toBeTruthy()
        expect(Math.max(dim!.w, dim!.h), `${file} texture size`).toBeLessThanOrEqual(MAX_TEXTURE)
      }
    }
  })

  it('no shipped body is self-lit, and none carries a camera, a light or a loader extension', () => {
    // The intake refuses all of these before writing; this re-reads the shipped file, because a
    // self-illuminated body would break the day/night/rain material bar the issue sets.
    for (const file of ALL_WAVE4_FILES) {
      const { json } = readGlb(file)
      expect(json.cameras ?? [], `${file} cameras`).toEqual([])
      for (const ext of json.extensionsUsed ?? []) {
        expect(ext, `${file} extension ${ext}`).not.toMatch(/lights_punctual|unlit|draco|meshopt|basisu/i)
      }
      for (const m of json.materials ?? []) {
        expect(m.emissiveFactor ?? [0, 0, 0], `${file} material ${m.name} emissive`).toEqual([0, 0, 0])
        expect(m.emissiveTexture, `${file} material ${m.name} emissive texture`).toBeUndefined()
        expect(m.pbrMetallicRoughness?.metallicFactor ?? 1, `${file} material ${m.name} metallic`).toBe(0)
        expect(m.extensions?.KHR_materials_specular, `${file} material ${m.name} specular boost`).toBeUndefined()
      }
      for (const img of json.images ?? []) {
        expect(img.uri, `${file} texture is embedded, not an external URI`).toBeUndefined()
      }
    }
  })
})

describe('issue #47 Wave 4 — Priority 1: named residents, strict 1:1', () => {
  it('keeps the canonical 24-bone rig, valid skinning and a grounded base', async () => {
    for (const { assetId, file, heightMeters } of NAMED) {
      const r = await inspect(file)
      expect(r.bones, `${assetId} bones`).toBe(24)
      expect(r.hierarchySignature, `${assetId} hierarchy`).toBe('c432d433d51d')
      expect(r.bindMatrices, `${assetId} bind matrices`).toBe(24)
      expect(r.skinInfluences.nanVerts, `${assetId} NaN weights`).toBe(0)
      expect(r.skinInfluences.zeroWeightVerts, `${assetId} zero-weight verts`).toBe(0)
      expect(r.skinInfluences.maxPerVertex, `${assetId} max influences`).toBeLessThanOrEqual(4)
      expect(r.groundedBounds.baseAtGround, `${assetId} grounded`).toBe(true)
      // The declared bounds are the authored contract the whole city is scaled against, so they
      // are re-measured from the shipped bytes rather than trusted.
      expect(r.groundedBounds.size[1], `${assetId} measured height`).toBeCloseTo(heightMeters, 2)
      // Wave 4 FITS the body to the rig it replaces, so the manifest deliberately declares the
      // RIG's bounds rather than this model's raw height (see the rig-fit gate below). What must
      // tie back to the measured source height is the RENDERED height.
      expect(
        CHARACTER_ASSETS[assetId].scale * r.groundedBounds.size[1],
        `${assetId} rendered height`,
      ).toBeCloseTo(RIG_HEIGHT_METERS, 3)
    }
  })

  it('each body carries all three semantic clips, resolved through the EXISTING alias path', async () => {
    for (const { assetId, file } of NAMED) {
      const r = await inspect(file)
      expect(r.clips.map((c: { name: string }) => c.name).sort(), `${assetId} clips`).toEqual(['Idle', 'Run', 'Walk'])
      const def = CHARACTER_ASSETS[assetId]
      const clips = r.clips.map((c: { name: string; duration: number }) => ({ name: c.name, duration: c.duration }) as never)
      const { resolved, missing } = resolveClips(def, clips)
      expect(missing, `${assetId} missing roles`).toEqual([])
      expect(Object.keys(resolved).sort(), `${assetId} resolved roles`).toEqual(['idle', 'run', 'walk'])
      // No second animation system: these ride the same controller as blocklife_person, and
      // never opt into the walk-as-idle hold the two issue #21 humanoids need.
      expect(def.staticIdle, `${assetId} needs no staticIdle workaround`).toBeUndefined()
    }
  })

  it('the mapping is exactly 1:1 — total, injective, and matched by the NPC defs', () => {
    const entries = Object.entries(WAVE4_NAMED_BODIES)
    expect(entries.length, 'named residents with an approved body').toBe(NAMED.length)
    expect(new Set(entries.map(([, body]) => body)).size, 'no body serves two people').toBe(entries.length)
    for (const { npc, assetId } of NAMED) {
      expect(WAVE4_NAMED_BODIES[npc], `${npc} registry entry`).toBe(assetId)
      expect(npcDef(npc).characterAssetId, `${npc} runtime slot`).toBe(assetId)
    }
    // …and no OTHER npc quietly names one of these bodies.
    for (const npc of NPC_DEFS) {
      if (WAVE4_NAMED_BODIES[npc.id]) continue
      expect(NAMED.map((n) => n.assetId), `${npc.id} must not borrow a named body`)
        .not.toContain(npc.characterAssetId!)
    }
  })

  it('each body was BUILT from the sources of the character it depicts — no cross-wiring', () => {
    // The strongest form of "no identity swapping": the manifest mapping is checked against the
    // intake config's own per-character source paths, so a body cannot be renamed onto another
    // NPC without the file it came from disagreeing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configById = new Map(WAVE4_CHARACTERS.map((c: any) => [c.id, c]))
    const SLUG: Record<string, string> = {
      blocklife_maya_01: 'maya-okafor',
      blocklife_bruno_01: 'bruno-castillo',
      blocklife_kim_01: 'officer-kim',
      blocklife_nisha_01: 'nisha-rao',
    }
    for (const { npc, assetId } of NAMED) {
      if (assetId === 'blocklife_ravi_01') continue // built by Wave 0; reconciled, not rebuilt
      const cfg = configById.get(assetId)
      expect(cfg, `${assetId} intake config`).toBeTruthy()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((cfg as any).npc, `${assetId} intake-declared NPC`).toBe(npc)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const src of Object.values((cfg as any).sources) as string[]) {
        expect(src, `${assetId} source belongs to ${SLUG[assetId]}`).toContain(`/${SLUG[assetId]}-`)
      }
      for (const s of recordFor(`public/${ASSET_MANIFEST_BY_ID.get(assetId)!.glbPath}`).sources) {
        expect(s.path, `${assetId} provenance source`).toContain(`/${SLUG[assetId]}-`)
      }
    }
  })

  it('the PLAYER is untouched: still the wardrobe-capable rig, never a baked body', () => {
    expect(PLAYER_CHARACTER_ASSET_ID).toBe('blocklife_person')
    const player = CHARACTER_ASSETS[PLAYER_CHARACTER_ASSET_ID]
    for (const slot of ['skin', 'hair', 'shirt', 'pants', 'shoes', 'accessory']) {
      expect(Object.keys(player.materialSlots), `player exposes ${slot}`).toContain(slot)
    }
    expect(Object.values(WAVE4_NAMED_BODIES), 'the player slot is not in the mapping')
      .not.toContain(PLAYER_CHARACTER_ASSET_ID)
    for (const { assetId } of NAMED) {
      expect(assetId, 'a named body is never the player').not.toBe(PLAYER_CHARACTER_ASSET_ID)
    }
  })

  it('Leo keeps his procedural body — the ineligible source is not swapped for someone else’s', () => {
    // His approved 1:1 source is a hard-hat construction worker; his shipped role is
    // "Delivery guy" with a delivery-bag accessory. Issue #47: keep the current body.
    expect(WAVE4_NAMED_BODIES.npc_leo_01, 'Leo has no approved body this wave').toBeUndefined()
    const leo = npcDef('npc_leo_01')
    expect(leo.characterAssetId, 'Leo stays on the wardrobe-capable rig').toBe('blocklife_person')
    expect(leo.role, 'Leo’s shipped role').toBe('Delivery guy')
    expect(NAMED_IDENTITIES.npc_leo_01.accessoryVariant, 'the delivery-bag signifier survives').toBe('bag')
    expect(Object.keys(CHARACTER_ASSETS[leo.characterAssetId!].materialSlots).length).toBeGreaterThan(0)
    // No character asset is a hard-hat body borrowed from another slot.
    expect(ASSET_MANIFEST.some((e) => /leo|construction|delivery-worker/i.test(e.glbPath ?? ''))).toBe(false)
  })

  it('the fallback CHAIN restores the pre-wave rig, not a capsule', () => {
    // Issue #47: "Fallbacks must retain the current procedural character plus its current
    // appearance/wardrobe." For these NPCs the CURRENT character was the wardrobe-capable rig
    // wearing a registry identity — the capsule was only ever the last resort beneath it. So the
    // chain a named body falls back through must pass through that rig, and the rig it names has
    // to be the one that can actually carry the identity.
    const identity = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]
    expect(identity, 'the identity rig exists').toBeTruthy()
    expect(Object.keys(identity.materialSlots).length, 'the fallback rig can carry the axes')
      .toBeGreaterThan(0)
    expect(IDENTITY_FALLBACK_SUFFIX, 'the fallback instance is separately observable').toBe('#identity')
    // Every named body is a DIFFERENT def from the identity rig — otherwise the wrap would be a
    // no-op and the chain would silently be two-deep again.
    for (const { assetId } of NAMED) {
      expect(assetId, 'a named body is never the identity rig itself').not.toBe(identity.id)
      expect(Object.keys(CHARACTER_ASSETS[assetId].materialSlots), `${assetId} is a baked body`).toEqual([])
    }
  })

  it('the FALLBACK still carries each resident’s full registry identity, unchanged', () => {
    // Issue #47: "Fallbacks must retain the current procedural character plus its current
    // appearance/wardrobe." `NAMED_IDENTITIES` is that appearance and this wave must not edit
    // it — the values below are the ones shipped at the base commit.
    expect(NAMED_IDENTITIES.npc_ravi_01).toEqual({ skinColor: '#e0ac69', accentColor: '#2b1b17', shirtColor: '#4a7fd4', pantsColor: '#2b3a55', shoesColor: '#2b2620', accessoryColor: '#b62032', hairVariant: 'short', accessoryVariant: 'scarf', bodyBuild: 'average' })
    expect(NAMED_IDENTITIES.npc_maya_01).toEqual({ skinColor: '#c68642', accentColor: '#0b0b0b', shirtColor: '#e0576f', pantsColor: '#333333', shoesColor: '#2b2620', accessoryColor: '#f4a259', hairVariant: 'bun', accessoryVariant: 'none', bodyBuild: 'average' })
    expect(NAMED_IDENTITIES.npc_kim_01).toEqual({ skinColor: '#f1c27d', accentColor: '#2b1b17', shirtColor: '#3f5f8f', pantsColor: '#2b3a55', shoesColor: '#111111', accessoryColor: '#1e2631', hairVariant: 'short', accessoryVariant: 'glasses', bodyBuild: 'broad' })
    expect(NAMED_IDENTITIES.npc_bruno_01).toEqual({ skinColor: '#8d5524', accentColor: '#0b0b0b', shirtColor: '#d4763a', pantsColor: '#333333', shoesColor: '#5c4033', accessoryColor: '#b62032', hairVariant: 'short', accessoryVariant: 'none', bodyBuild: 'stocky' })
    expect(NAMED_IDENTITIES.npc_leo_01).toEqual({ skinColor: '#ffdbac', accentColor: '#a8763e', shirtColor: '#6cc24a', pantsColor: '#333333', shoesColor: '#2b2620', accessoryColor: '#e2b04a', hairVariant: 'short', accessoryVariant: 'bag', bodyBuild: 'tall' })
    expect(NAMED_IDENTITIES.npc_nisha_01).toEqual({ skinColor: '#c68642', accentColor: '#2b1b17', shirtColor: '#9a5fc0', pantsColor: '#3d405b', shoesColor: '#5c4033', accessoryColor: '#d9b382', hairVariant: 'long', accessoryVariant: 'scarf', bodyBuild: 'average' })
    for (const { assetId } of NAMED) {
      expect(CHARACTER_ASSETS[assetId].fallback.primitiveStyle, `${assetId} fallback`).toBe('blocklife_primitive')
    }
  })

  it('leaves every gameplay datum on the six residents exactly as authored', () => {
    // Ids, names, roles, colours, walk speeds and routine SHAPES are gameplay/authoring data.
    // The wave changes pixels; a diff that moved any of these would fail here.
    const AUTHORED: Record<string, { name: string; role: string; bodyColor: string; walkSpeed: number; routineSegments: number }> = {
      npc_ravi_01: { name: 'Ravi', role: 'Your friend', bodyColor: '#4a7fd4', walkSpeed: 1.6, routineSegments: 3 },
      npc_maya_01: { name: 'Maya', role: 'Food truck owner', bodyColor: '#e0576f', walkSpeed: 1.5, routineSegments: 2 },
      npc_bruno_01: { name: 'Coach Bruno', role: 'Gym trainer', bodyColor: '#d4763a', walkSpeed: 1.3, routineSegments: 1 },
      npc_leo_01: { name: 'Leo', role: 'Delivery guy', bodyColor: '#6cc24a', walkSpeed: 2.4, routineSegments: 1 },
      npc_kim_01: { name: 'Officer Kim', role: 'Neighborhood patrol', bodyColor: '#3f5f8f', walkSpeed: 1.8, routineSegments: 1 },
      npc_nisha_01: { name: 'Nisha', role: 'Your neighbor', bodyColor: '#9a5fc0', walkSpeed: 1.4, routineSegments: 3 },
    }
    expect(NPC_DEFS.length, 'the cast is not resized').toBe(6)
    for (const [id, a] of Object.entries(AUTHORED)) {
      const def = npcDef(id)
      expect(def.name, `${id} name`).toBe(a.name)
      expect(def.role, `${id} role`).toBe(a.role)
      expect(def.bodyColor, `${id} authored body colour`).toBe(a.bodyColor)
      expect(def.walkSpeed, `${id} walk speed`).toBe(a.walkSpeed)
      expect(def.routine.length, `${id} routine segments`).toBe(a.routineSegments)
      expect(def.ambientLines.length, `${id} ambient lines`).toBe(3)
    }
  })

  it('keeps the candidate register honest: a candidate is still in no runtime slot', () => {
    for (const id of CANDIDATE_CHARACTER_ASSET_IDS) {
      expect(Object.values(WAVE4_NAMED_BODIES), `${id} is not a named body`).not.toContain(id)
      expect(NPC_DEFS.some((n) => n.characterAssetId === id), `${id} unused by NPCs`).toBe(false)
      expect(id, `${id} is not the player`).not.toBe(PLAYER_CHARACTER_ASSET_ID)
    }
  })
})

describe('issue #47 Wave 4 — Priority 2: parked-vehicle diversity', () => {
  it('adds exactly four bodies and NO vehicle class, seat, tuning or ownership entry', () => {
    expect(PARKED.length, 'additional parked bodies').toBe(4)
    expect(PARKED_BODY_ASSET_IDS.slice().sort()).toEqual(PARKED.map((p) => p.assetId).sort())
    // The ownable-class registry is untouched: no parked body is a drivable class.
    const classBodies = VEHICLE_DEFS.map((d) => d.assetId).filter(Boolean)
    for (const { assetId } of PARKED) {
      expect(classBodies, `${assetId} must not be a vehicle class body`).not.toContain(assetId)
    }
    expect(VEHICLE_DEFS.length, 'ownable vehicle classes').toBe(4)
  })

  it('fits INSIDE the authored visual envelope — recomputed from propPlacement and the bytes', () => {
    for (const { assetId, propType } of PARKED) {
      const env = PROP_ENVELOPES[propType]
      // The config's envelope literals must BE the authored table, not a copy that drifted.
      expect(env.halfX, `${propType} halfX`).toBe(PROP_PLACEMENT[propType].visualHalf[0])
      expect(env.halfZ, `${propType} halfZ`).toBe(PROP_PLACEMENT[propType].visualHalf[1])
      expect(env.maxY, `${propType} maxY`).toBe(PROP_PLACEMENT[propType].vertical[1])

      const size = recordFor(`public/${ASSET_MANIFEST_BY_ID.get(assetId)!.glbPath}`).structure.bounds.size as [number, number, number]
      const k = Math.min(
        (2 * env.halfZ) / (size[0] + BOUNDS_EPSILON),
        (2 * env.halfX) / (size[2] + BOUNDS_EPSILON),
        env.maxY / (size[1] + BOUNDS_EPSILON),
      )
      const scale = Math.floor(k * 10 ** SCALE_DECIMALS) / 10 ** SCALE_DECIMALS

      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      expect(entry.scale, `${assetId} uniform scale`).toEqual([scale, scale, scale])
      // The +90° yaw is what puts the model's own LENGTH axis on the placement's longitudinal
      // axis. Getting it backwards is exactly how a body ends up across its parking bay.
      expect(entry.rotation[1], `${assetId} yaw`).toBeCloseTo(Math.PI / 2, 6)
      expect(entry.positionOffset, `${assetId} sits on the ground plane`).toEqual([0, 0, 0])

      const world = { depth: size[0] * scale, height: size[1] * scale, width: size[2] * scale }
      expect(world.depth, `${assetId} length inside the envelope`).toBeLessThanOrEqual(2 * env.halfZ)
      expect(world.width, `${assetId} width inside the envelope`).toBeLessThanOrEqual(2 * env.halfX)
      expect(world.height, `${assetId} height inside the envelope`).toBeLessThanOrEqual(env.maxY)
      // …and the manifest states those same numbers in the placement's local frame.
      expect(entry.bounds!.depth, `${assetId} declared depth`).toBeCloseTo(world.depth, 3)
      expect(entry.bounds!.width, `${assetId} declared width`).toBeCloseTo(world.width, 3)
      expect(entry.bounds!.height, `${assetId} declared height`).toBeCloseTo(world.height, 3)
      // A parked body is far below the camera, but the invariant is universal, not situational.
      expect(world.height, `${assetId} camera clearance`).toBeLessThan(MAX_WORLD_RENDER_HEIGHT)
    }
  })

  it('keeps the complete procedural vehicle as the fallback, and claims no recolorable slot', () => {
    for (const { assetId, fallbackKey } of PARKED) {
      const entry = ASSET_MANIFEST_BY_ID.get(assetId)!
      expect(entry.category, `${assetId} category`).toBe('vehicles')
      expect(entry.fallbackKey, `${assetId} fallback`).toBe(fallbackKey)
      // One baked atlas: panels, glass, lights and tyres share a texture, so tinting a "paint"
      // slot would recolour the windows. Wave 1 settled this; the declaration stays honest.
      expect(entry.materialSlots, `${assetId} slot map declared`).toBeDefined()
      expect(Object.keys(entry.materialSlots!), `${assetId} exposes no slot`).toEqual([])
      expect(entry.variants, `${assetId} declares no palette`).toBeUndefined()
    }
  })

  it('covers every authored parked placement, from the pool for its own type', () => {
    const assignment = parkedBodyAssignment()
    const placements = PROPS.filter((p) => p.type === 'parked_car' || p.type === 'parked_truck')
    expect(placements.length, 'authored parked placements').toBe(29)
    expect(assignment.size, 'placements with a body').toBe(placements.length)
    for (const p of placements) {
      const body = assignment.get(p.id)
      expect(body, `${p.id} has a body`).toBeTruthy()
      expect(PARKED_BODY_POOLS[p.type as 'parked_car' | 'parked_truck'], `${p.id} pool`).toContain(body!)
    }
  })

  it('is deterministic: the shipped assignment re-derives exactly from the authored data', () => {
    for (const type of ['parked_car', 'parked_truck'] as const) {
      const placements = PROPS.filter((p) => p.type === type).map((p) => ({
        id: p.id,
        position: p.position as readonly [number, number],
      }))
      const derived = assignParkedBodies(placements, PARKED_BODY_POOLS[type])
      for (const [id, body] of derived) {
        expect(parkedBodyAssignment().get(id), `${id} re-derives`).toBe(body)
      }
      // Order-independence: shuffling the input must not change one assignment.
      const shuffled = assignParkedBodies([...placements].reverse(), PARKED_BODY_POOLS[type])
      for (const [id, body] of derived) expect(shuffled.get(id), `${id} order-independent`).toBe(body)
    }
  })

  it('never puts two identical bodies side by side, and uses the pool in balance', () => {
    for (const type of ['parked_car', 'parked_truck'] as const) {
      const placements = PROPS.filter((p) => p.type === type)
      const bodyOf = (id: string) => parkedBodyAssignment().get(id)!
      let closestSame = Infinity
      let worst = ''
      for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
          const a = placements[i], b = placements[j]
          if (bodyOf(a.id) !== bodyOf(b.id)) continue
          const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1])
          if (d < closestSame) { closestSame = d; worst = `${a.id} & ${b.id}` }
        }
      }
      expect(closestSame, `${type}: closest identical pair is ${worst}`).toBeGreaterThanOrEqual(
        PARKED_BODY_MIN_SEPARATION,
      )
      const counts = PARKED_BODY_POOLS[type].map(
        (body) => placements.filter((p) => bodyOf(p.id) === body).length,
      )
      // "Visually balanced": no body may carry more than one placement's worth of extra load.
      expect(Math.max(...counts) - Math.min(...counts), `${type} pool balance`).toBeLessThanOrEqual(1)
    }
  })

  it('changes NO gameplay datum on a parked placement', () => {
    // Collision, the visual envelope and the authored placement set are all untouched: this
    // wave only decides which body draws. The literals are the ones shipped at the base commit.
    expect(PROP_SOLIDITY.parked_car).toEqual({ half: [1, 0.6, 2] })
    expect(PROP_SOLIDITY.parked_truck).toEqual({ half: [1.15, 1, 2.3] })
    expect(PROP_PLACEMENT.parked_car).toEqual({ visualHalf: [1.0, 2.0], vertical: [0, 1.4], support: 'ground' })
    expect(PROP_PLACEMENT.parked_truck).toEqual({ visualHalf: [1.15, 2.3], vertical: [0, 2.1], support: 'ground' })

    const cars = PROPS.filter((p) => p.type === 'parked_car')
    const trucks = PROPS.filter((p) => p.type === 'parked_truck')
    expect(cars.length, 'authored parked_car placements').toBe(19)
    expect(trucks.length, 'authored parked_truck placements').toBe(10)
    // A digest of every authored id + position + rotation: nothing moved, nothing was added.
    const digest = createHash('sha256')
      .update(
        [...cars, ...trucks]
          .map((p) => `${p.id}|${p.position[0]}|${p.position[1]}|${p.rotationY ?? 0}`)
          .sort()
          .join('\n'),
      )
      .digest('hex')
    expect(digest, 'authored parked placements are byte-stable').toBe(
      '480af2071dafce36ad4e166eab36ecaaaffa93570e2e50229604330ca8b14bf0',
    )
  })
})

describe('issue #47 Wave 4 — Priority 3: one building body, one placement', () => {
  it('ships exactly ONE building body, on ONE authored placement', () => {
    expect(WAVE4_BUILDINGS.length, 'approved building bodies admitted').toBe(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((WAVE4_BUILDINGS[0] as any).placements).toEqual([TOWER.placement])
    expect(recordFor(TOWER.file).kind).toBe('building')
  })

  it('leaves the authored lot, door, label and occluder box exactly where they were', () => {
    const def = buildingDef(TOWER.placement)
    expect(def.position, 'authored position').toEqual(AUTHORED_TOWER.position)
    expect(def.size, 'authored footprint + height (collider/occluder/routing authority)').toEqual(AUTHORED_TOWER.size)
    expect(def.door, 'authored entrance side').toBe(AUTHORED_TOWER.door)
    expect(def.label, 'authored label').toBe(AUTHORED_TOWER.label)
    expect(def.visual, 'no archetype projection is introduced').toBeUndefined()
    expect(def.paletteVariant, 'the baked atlas tints nothing').toBeUndefined()
  })

  it('derives the uniform scale from the AUTHORED lot and the measured bytes', () => {
    const def = buildingDef(TOWER.placement)
    const yaw = FACING_YAW[AUTHORED_TOWER.door] - FACING_YAW[TOWER.canonicalFacing]
    const { min, max, size } = recordFor(TOWER.file).structure.bounds
    const hxModel = Math.max(Math.abs(min[0]), Math.abs(max[0])) + BOUNDS_EPSILON
    const hzModel = Math.max(Math.abs(min[2]), Math.abs(max[2])) + BOUNDS_EPSILON
    const swapped = Math.abs(Math.sin(yaw)) > 0.5
    const hx = swapped ? hzModel : hxModel
    const hz = swapped ? hxModel : hzModel
    const k = Math.min(
      def.size[0] / 2 / hx,
      def.size[2] / 2 / hz,
      MAX_RENDERED_HEIGHT / (size[1] + BOUNDS_EPSILON),
    )
    const scale = Math.floor(k * 10 ** SCALE_DECIMALS) / 10 ** SCALE_DECIMALS

    const entry = ASSET_MANIFEST_BY_ID.get(TOWER.assetId)!
    expect(entry.scale, 'uniform scale').toEqual([scale, scale, scale])
    expect(entry.rotation[1], 'canonical-facing yaw').toBeCloseTo(yaw, 6)
    expect(entry.bounds!.width, 'declared model-local width').toBeCloseTo(size[0] * scale, 3)
    expect(entry.bounds!.height, 'declared height').toBeCloseTo(size[1] * scale, 3)
    expect(entry.bounds!.depth, 'declared model-local depth').toBeCloseTo(size[2] * scale, 3)
    // HEIGHT binds here, which is a camera invariant, not an aesthetic choice.
    expect(scale, 'the height bound is the binding one').toBeCloseTo(MAX_RENDERED_HEIGHT / size[1], 3)
    expect(entry.renderedTopY, 'occlusion reads the rendered top, not the authored box')
      .toBeCloseTo(size[1] * scale, 3)
    expect(entry.renderedTopY!, 'below the camera-engulf ceiling').toBeLessThanOrEqual(MAX_WORLD_RENDER_HEIGHT)
    // The body stays inside the authored footprint on both axes.
    const worldHalfX = (swapped ? size[2] : size[0]) / 2 * scale
    const worldHalfZ = (swapped ? size[0] : size[2]) / 2 * scale
    expect(worldHalfX, 'inside the lot on X').toBeLessThanOrEqual(def.size[0] / 2)
    expect(worldHalfZ, 'inside the lot on Z').toBeLessThanOrEqual(def.size[2] / 2)
  })

  it('declares the canonical facing the MEASURED facades support', () => {
    // The intake measures per-side entrance-band vertex density; the rendered cardinals in
    // tests/visual/wave4-asset-visuals.spec.ts are the primary evidence. This is the
    // machine-readable half: the declared front must be the densest entrance elevation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = (recordFor(TOWER.file) as any).facades
    expect(f, 'facade profile recorded').toBeTruthy()
    const densest = (['south', 'north', 'east', 'west'] as const)
      .map((k) => [k, f[k].lowVerts as number] as const)
      .sort((a, b) => b[1] - a[1])[0][0]
    expect(densest, 'measured entrance elevation').toBe(TOWER.canonicalFacing)
  })

  it('the intake ceiling is the SAME number the camera module derives', () => {
    expect(MAX_RENDERED_HEIGHT, 'wave4.config.mjs MAX_RENDERED_HEIGHT').toBe(MAX_WORLD_RENDER_HEIGHT)
  })

  it('admits no other building: every rejection stays outside production', () => {
    // Issue #47 names the facades that must never be forced onto a differently-named building.
    // None of them may appear in the shipped manifest at all.
    const forbidden = /hospital|bank|school|police_station|laundromat|clothing_shop|fire_station|clinic|pharmacy|restaurant|park_utility|suburban_house|duplex|mixed_use/i
    for (const e of ASSET_MANIFEST) {
      expect(forbidden.test(e.glbPath ?? ''), `${e.id} ships a rejected building body`).toBe(false)
    }
  })
})

describe('issue #47 Wave 4 — named bodies are FITTED to the rig they replace', () => {
  /**
   * The defect this gate exists for.
   *
   * The approved sprint bodies are authored at real-world human height (1.70-1.84 m). The body
   * they replace is not: `blocklife_person` stands 2.930 m, and it is what every one of these
   * NPCs rendered as before this wave AND what the player still renders as. Mounted at scale 1,
   * each named resident came out at ~60 % of the player's height — visible immediately in the
   * "player beside each named resident" baseline, and measured at a 1.674x rendered silhouette
   * ratio against 1.665 predicted from the bytes.
   *
   * The rule is the character restatement of CONVENTIONS #36: the thing being replaced sizes the
   * body, never the reverse. Every named body must render at exactly the height its NPC had
   * before Wave 4, so nothing anchored to that height — speech bubbles, the interaction prompt,
   * occlusion, the crowd's read of scale — moves.
   */
  const heights = new Map<string, number>()
  const measure = async (assetId: string): Promise<number> => {
    const cached = heights.get(assetId)
    if (cached !== undefined) return cached
    const def = CHARACTER_ASSETS[assetId]
    const rig = await inspect(`public/${def.modelPath}`)
    const h = rig.groundedBounds.size[1]
    heights.set(assetId, h)
    return h
  }

  it('the reference rig still measures what the fitted scales were derived from', async () => {
    const measured = await measure(DEFAULT_CHARACTER_ASSET_ID)
    expect(
      Math.abs(measured - RIG_HEIGHT_METERS),
      `${DEFAULT_CHARACTER_ASSET_ID} measures ${measured} m, but the fitted scales were derived ` +
        `from ${RIG_HEIGHT_METERS} m. Re-derive every scale in WAVE4_NAMED_BODIES.`,
    ).toBeLessThanOrEqual(RIG_FIT_TOLERANCE_METERS)
  })

  it('every pinned height and sha still matches the committed bytes', async () => {
    for (const [assetId, pin] of Object.entries(RIG_FIT)) {
      const def = CHARACTER_ASSETS[assetId]
      expect(def, `${assetId} is pinned in RIG_FIT but absent from CHARACTER_ASSETS`).toBeTruthy()
      const bytes = readFileSync(`public/${def.modelPath}`)
      expect(createHash('sha256').update(bytes).digest('hex'), `${assetId} bytes changed`).toBe(pin.sha256)
      const measured = await measure(assetId)
      expect(Math.abs(measured - pin.heightMeters), `${assetId} height drifted`).toBeLessThanOrEqual(RIG_FIT_TOLERANCE_METERS)
    }
  })

  it('each named body renders at the reference rig height, so no NPC changes size', async () => {
    for (const assetId of Object.values(WAVE4_NAMED_BODIES)) {
      const def = CHARACTER_ASSETS[assetId]
      const rendered = def.scale * (await measure(assetId))
      expect(
        Math.abs(rendered - RIG_HEIGHT_METERS),
        `${assetId} renders ${rendered.toFixed(4)} m against the rig's ${RIG_HEIGHT_METERS} m ` +
          `(scale ${def.scale}). A named resident must not change size when it gains a body.`,
      ).toBeLessThanOrEqual(RIG_FIT_TOLERANCE_METERS)
    }
  })

  it('the player is NOT rescaled — the reference rig stays at scale 1', () => {
    expect(CHARACTER_ASSETS[PLAYER_CHARACTER_ASSET_ID].scale).toBe(1)
    expect(CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID].scale).toBe(1)
  })

  it('a fitted body keeps its own bounds but adopts the rig ANCHORS, so no label moves', () => {
    /**
     * These two are deliberately different, and the difference is not cosmetic.
     *
     * `bounds` describe the MODEL and are validated against it (`characterBounds`), so each body
     * keeps its own measured numbers. `anchors` are world offsets that are NOT multiplied by
     * `def.scale` — they place the name label and the interaction prompt — so a body that now
     * renders at the rig's height must use the RIG's anchors, or every label attached to that NPC
     * moves relative to where it sat before this wave.
     */
    const ref = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]
    for (const assetId of Object.values(WAVE4_NAMED_BODIES)) {
      const def = CHARACTER_ASSETS[assetId]
      expect(def.anchors, `${assetId} anchors`).toEqual(ref.anchors)
      expect(def.bounds.visualHeight, `${assetId} keeps its own measured bounds`)
        .toBeCloseTo(RIG_FIT[assetId].heightMeters, 2)
    }
  })
})
