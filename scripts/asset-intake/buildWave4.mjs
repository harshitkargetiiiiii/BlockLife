/**
 * Issue #47 — Integration Wave 4 deterministic asset intake pipeline.
 *
 * Rebuilds every Wave-4 production GLB from the pristine sprint sources, which are opened
 * READ-ONLY and never modified. Re-running with unchanged inputs reproduces byte-identical
 * outputs, so the recorded output hashes are independently verifiable.
 *
 *   node scripts/asset-intake/buildWave4.mjs [--check]
 *
 * --check rebuilds into a real temporary directory OUTSIDE the worktree and fails if any
 * committed output differs, which is how CI proves the committed bytes really came from the
 * recorded sources. It never writes inside the worktree.
 *
 * Everything here is shared with Waves 0–3 through ./lib.mjs — the same read, assert, normalize,
 * prune, texture-reduce and verify steps — rather than forking a fifth intake pattern:
 *
 *   • CHARACTERS take the Wave-0 path verbatim: prove the three per-clip sources share a
 *     byte-identical mesh and the same 24-bone `c432d433d51d` skeleton, graft Walk/Run onto the
 *     base document's own joints BY BONE NAME, rename the clips to the canonical semantic roles.
 *     Geometry, skin weights and bind matrices are never touched. What Wave 4 ADDS is
 *     (a) a source SHA-256 assertion before every read (Wave 3's `assertSource`, which the Wave-0
 *     character path predated), and (b) a real SKINNED height measurement of the shipped bytes
 *     through three.js — `describe()`'s node-space box is meaningless for a skinned mesh, and the
 *     manifest's declared `bounds.visualHeight` has to be measured, not transcribed.
 *   • VEHICLES and the BUILDING take the Wave-1/2/3 static path verbatim (`buildStatic`), which
 *     asserts the mesh digest and the bounding box are unchanged across the transform.
 *   • The building additionally records Wave 3's per-side `facades` measurement, so its declared
 *     canonical facing is checkable against geometry rather than a filename.
 */
import { mergeDocuments, prune, dedup, unpartition } from '@gltf-transform/functions'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSource, buildStatic, describe, fileSha, io, KB, makeCheckDir, meshDigest, reduceTextures,
  skeletonSignature,
} from './lib.mjs'
import { inspect as inspectRig } from '../human-proof/inspectRig.mjs'
import {
  BUILDINGS, CHARACTERS, VEHICLES, MAX_TEXTURE, TEXTURE_FORMAT, TEXTURE_QUALITY,
  PROVENANCE_OUT, BOUNDS_EPSILON, SCALE_DECIMALS, MAX_RENDERED_HEIGHT, PROP_ENVELOPES,
} from './wave4.config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = process.argv.includes('--check')
const outDir = CHECK ? makeCheckDir('wave4') : ROOT
const TEXTURE_OPTS = { maxTexture: MAX_TEXTURE, format: TEXTURE_FORMAT, quality: TEXTURE_QUALITY }
const records = []

/**
 * Per-side geometric profile of a building body, measured from the real vertices — the Wave-3
 * measurement, unchanged. Issue #47 forbids guessing orientation, and a wrong guess is not
 * cosmetic: it turns the authored door anchor into a blank wall. The rendered cardinals are the
 * primary evidence; this is the machine-readable half that ships in the provenance.
 */
function measureFacades(root) {
  const prim = root.listMeshes()[0].listPrimitives()[0]
  const arr = prim.getAttribute('POSITION').getArray()
  const pts = []
  for (let i = 0; i < arr.length; i += 3) pts.push([arr[i], arr[i + 1], arr[i + 2]])
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])))
  const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])))
  const size = [0, 1, 2].map((k) => hi[k] - lo[k])
  const bandTop = lo[1] + size[1] * 0.3
  const band = pts.filter((p) => p[1] <= bandTop)
  const round = (n) => +n.toFixed(4)

  const side = (axis, sign) => {
    const lateral = axis === 0 ? 2 : 0
    const plane = sign > 0 ? hi[axis] : lo[axis]
    const depth = size[axis]
    const near = band.filter((p) => Math.abs(p[axis] - plane) <= depth * 0.12)
    const bandPlane = band.length
      ? (sign > 0 ? Math.max(...band.map((p) => p[axis])) : Math.min(...band.map((p) => p[axis])))
      : plane
    return { span: round(size[lateral]), inset: round(Math.abs(plane - bandPlane)), lowVerts: near.length }
  }
  return {
    rule: 'per-side span / entrance-band inset / near-plane vertex density, measured in the bottom 30% of the body',
    bandTop: round(bandTop),
    bandVertices: band.length,
    south: side(2, 1), north: side(2, -1), east: side(0, 1), west: side(0, -1),
  }
}

/** Wave-0 character assembly, verbatim. Geometry/skin/bind matrices are never touched. */
async function buildCharacter(def, dir) {
  const parts = {}
  for (const [role, src] of Object.entries(def.sources)) {
    const doc = await io.read(src)
    const root = doc.getRoot()
    const skin = root.listSkins()[0]
    if (!skin) throw new Error(`${src}: no skin`)
    parts[role] = { doc, root, skin, sig: skeletonSignature(skin), mesh: meshDigest(root), src }
  }
  const roles = Object.keys(parts)
  const ref = parts[def.base]
  for (const r of roles) {
    if (parts[r].sig.sig !== ref.sig.sig || parts[r].sig.count !== ref.sig.count)
      throw new Error(`${def.id}: skeleton mismatch on ${r} (${parts[r].sig.sig} vs ${ref.sig.sig}) — refusing to merge`)
    if (parts[r].mesh !== ref.mesh)
      throw new Error(`${def.id}: mesh mismatch on ${r} — refusing to merge`)
  }

  const doc = ref.doc
  const root = doc.getRoot()
  const jointsByName = new Map(ref.skin.listJoints().map((j) => [j.getName(), j]))
  const baseAnims = root.listAnimations()
  if (baseAnims.length !== 1) throw new Error(`${def.id}: expected exactly 1 clip in base, got ${baseAnims.length}`)
  baseAnims[0].setName(def.base)

  for (const role of roles) {
    if (role === def.base) continue
    const donor = parts[role]
    if (donor.root.listAnimations().length !== 1)
      throw new Error(`${def.id}: expected exactly 1 clip in ${role}, got ${donor.root.listAnimations().length}`)
    const before = new Set(root.listAnimations())
    mergeDocuments(doc, donor.doc)
    const added = root.listAnimations().filter((a) => !before.has(a))
    if (added.length !== 1) throw new Error(`${def.id}: merge added ${added.length} clips for ${role}`)
    const clip = added[0]
    clip.setName(role)
    for (const ch of clip.listChannels()) {
      const target = ch.getTargetNode()
      if (!target) continue
      const mapped = jointsByName.get(target.getName())
      if (!mapped) throw new Error(`${def.id}: ${role} channel targets unknown bone "${target.getName()}"`)
      ch.setTargetNode(mapped)
    }
  }
  for (const scene of root.listScenes()) if (scene !== root.getDefaultScene()) scene.dispose()
  await doc.transform(prune({ keepAttributes: false, keepLeaves: false }), dedup())
  await reduceTextures(doc, TEXTURE_OPTS)
  await doc.transform(unpartition())

  // The merge must not have disturbed the rig the whole character pipeline depends on.
  const outSkin = root.listSkins()[0]
  const outSig = skeletonSignature(outSkin)
  if (outSig.sig !== ref.sig.sig || outSig.count !== ref.sig.count)
    throw new Error(`${def.id}: assembled skeleton ${outSig.sig}/${outSig.count} != source ${ref.sig.sig}/${ref.sig.count}`)
  if (meshDigest(root) !== ref.mesh)
    throw new Error(`${def.id}: geometry changed during assembly`)

  const outPath = join(dir, def.out)
  mkdirSync(dirname(outPath), { recursive: true })
  await io.write(outPath, doc)
  return outPath
}

// ---- Characters -------------------------------------------------------------------------
for (const def of CHARACTERS) {
  const sources = []
  for (const [role, path] of Object.entries(def.sources)) {
    if (!existsSync(path)) throw new Error(`${def.id} (${role}): approved source missing at ${path}`)
    const s = assertSource(def, role, path, def.expect?.[role])
    if (def.expect?.[role]?.bytes && s.bytes !== def.expect[role].bytes)
      throw new Error(`${def.id} (${role}): source bytes ${s.bytes} != approved ${def.expect[role].bytes}`)
    s.structure = await describe(path)
    sources.push(s)
  }
  const outPath = await buildCharacter(def, outDir)
  const structure = await describe(outPath)
  // Real SKINNED bounds through three.js — `describe()` walks node matrices only, which for a
  // skinned mesh reports the (meaningless) armature-node box, not the metre height that the
  // manifest declares and the city is scaled against.
  const rig = await inspectRig(outPath)
  const measuredHeight = rig.groundedBounds.size[1]
  if (Math.abs(measuredHeight - def.heightMeters) > 0.02)
    throw new Error(`${def.id}: measured rig height ${measuredHeight} m != declared ${def.heightMeters} m`)
  if (!rig.groundedBounds.baseAtGround)
    throw new Error(`${def.id}: rig is not grounded (min y = ${rig.groundedBounds.min[1]})`)
  if (rig.skinInfluences.zeroWeightVerts || rig.skinInfluences.nanVerts)
    throw new Error(`${def.id}: broken skin weights (zero=${rig.skinInfluences.zeroWeightVerts} nan=${rig.skinInfluences.nanVerts})`)

  records.push({
    id: def.id, label: def.label, kind: 'character', npc: def.npc, output: def.out,
    outputSha256: fileSha(outPath), outputBytes: statSync(outPath).size,
    sources,
    operations: [
      'assert every approved per-clip source SHA-256 + byte count before reading (read-only)',
      'assert the three sources share one mesh digest and one 24-bone c432d433d51d skeleton',
      'merge 3 per-clip GLBs -> 1 production GLB (clips grafted onto the base skeleton by bone name)',
      'rename clips to canonical semantic roles Idle / Walk / Run',
      'prune + dedup (drops the two duplicate meshes/skins/textures the merge introduced)',
      `textureCompress resize <=${MAX_TEXTURE} targetFormat=${TEXTURE_FORMAT} quality=${TEXTURE_QUALITY} filter=lanczos3`,
      'assert assembled skeleton signature + mesh digest identical to the source rig',
      'assert grounded skinned bounds and the declared metre height, measured through three.js',
    ],
    attribution: def.attribution, license: def.license,
    structure,
    rig: {
      bones: rig.bones,
      hierarchySignature: rig.hierarchySignature,
      bindMatrices: rig.bindMatrices,
      skinInfluences: rig.skinInfluences,
      groundedBounds: rig.groundedBounds,
      declaredHeightMeters: def.heightMeters,
      measuredHeightMeters: measuredHeight,
    },
  })
}

// ---- Static bodies (parked vehicles + the one building) ----------------------------------
for (const def of [...VEHICLES, ...BUILDINGS]) {
  if (!existsSync(def.src)) throw new Error(`${def.id}: approved source missing at ${def.src}`)
  const source = assertSource(def, 'source', def.src, def.expect)
  source.structure = await describe(def.src)
  if (def.expect?.triangles && source.structure.triangles !== def.expect.triangles)
    throw new Error(`${def.id}: source triangles ${source.structure.triangles} != approved ${def.expect.triangles}`)
  if (def.expect?.bytes && source.bytes !== def.expect.bytes)
    throw new Error(`${def.id}: source bytes ${source.bytes} != approved ${def.expect.bytes}`)

  const groundOffsetY = def.ground ? +(-source.structure.bounds.min[1]).toFixed(4) : 0
  const isVehicle = 'propType' in def
  const record = {
    id: def.id, label: def.label, kind: isVehicle ? 'vehicle' : 'building',
    ...(isVehicle ? { propType: def.propType } : { placements: def.placements }),
    output: def.out, sources: [source], groundOffsetY,
    operations: [
      `assert approved source SHA-256 ${def.expect.sha256} + ${def.expect.bytes} bytes + ${def.expect.triangles} triangles before reading (read-only)`,
      `normalize single material name -> "${def.materialName}" (baked atlas — exposes NO recolorable slot)`,
      ...(groundOffsetY !== 0
        ? [`ground by root-node translation +${groundOffsetY} on Y (mesh accessors untouched); assert rendered minimum y=0`]
        : ['origin already at the base — no vertical transform applied; rendered minimum y=0 asserted']),
      'dedup + prune',
      `textureCompress resize <=${MAX_TEXTURE} targetFormat=${TEXTURE_FORMAT} quality=${TEXTURE_QUALITY} filter=lanczos3`,
      'assert mesh digest unchanged (geometry, indices, topology, triangle count, proportions preserved)',
      'assert bounds unchanged except the declared grounding offset on Y',
      'assert runtime-safe: metallic 0, emissive [0,0,0], no unlit/lights/cameras, no draco/meshopt/KTX2, embedded textures only',
    ],
    attribution: def.attribution, license: def.license,
  }
  const outPath = await buildStatic(def, outDir, TEXTURE_OPTS)
  record.outputSha256 = fileSha(outPath)
  record.outputBytes = statSync(outPath).size
  record.structure = await describe(outPath)
  if (!isVehicle) record.facades = measureFacades((await io.read(outPath)).getRoot())
  records.push(record)
}

if (CHECK) {
  let bad = 0
  for (const r of records) {
    const committed = join(ROOT, r.output)
    if (!existsSync(committed)) { console.error(`✗ missing committed output ${r.output}`); bad++; continue }
    const have = fileSha(committed)
    if (have !== r.outputSha256) { console.error(`✗ ${r.output}\n    committed ${have}\n    rebuilt   ${r.outputSha256}`); bad++ }
    else console.log(`✓ ${r.output} reproduces byte-identically (${have.slice(0, 16)}…)`)
  }
  process.exit(bad ? 1 : 0)
}

mkdirSync(join(ROOT, dirname(PROVENANCE_OUT)), { recursive: true })
writeFileSync(join(ROOT, PROVENANCE_OUT), JSON.stringify({
  issue: 47, wave: 4,
  note: 'Rebuild with: node scripts/asset-intake/buildWave4.mjs   |   verify with --check',
  maxTexture: MAX_TEXTURE, textureFormat: TEXTURE_FORMAT, textureQuality: TEXTURE_QUALITY,
  boundsEpsilon: BOUNDS_EPSILON, scaleDecimals: SCALE_DECIMALS, maxRenderedHeight: MAX_RENDERED_HEIGHT,
  propEnvelopes: PROP_ENVELOPES,
  projection: {
    characters:
      'No scale is applied: each rig is authored in metres with its feet at y = 0, and its measured '
      + 'height is asserted against the declared CHARACTER_ASSETS bounds. Rendering goes through the '
      + 'existing AnimatedCharacter path; the procedural blocklife_person stays the fallback.',
    vehicles:
      'Uniform scale s = floor(min((2*halfZ) / sizeX, (2*halfX) / sizeZ, maxY / sizeY) * 1e4) / 1e4, where '
      + '(halfX, halfZ, maxY) is the AUTHORED VISUAL ENVELOPE for the prop type in '
      + 'src/game/world/propPlacement.ts and (sizeX, sizeY, sizeZ) are the measured local extents '
      + '(each inflated by boundsEpsilon first). Every body carries a +PI/2 yaw, which puts its '
      + 'model-local X (length) on the placement’s local Z (longitudinal axis). '
      + 'Recomputed in src/game/assets/wave4Contract.test.ts.',
    buildings:
      'Uniform scale s = floor(min((w/2) / hx, (d/2) / hz, MAX_RENDERED_HEIGHT / sizeY) * 1e4) / 1e4, where '
      + '(w, d) is the placement’s AUTHORED def.size footprint in src/game/world/cityLayout.ts and '
      + '(hx, hz) are the measured local half-extents after the canonical-facing yaw. '
      + 'MAX_RENDERED_HEIGHT is the camera-engulf ceiling derived in src/game/camera/cameraGeometry.ts. '
      + 'Recomputed in src/game/assets/wave4Contract.test.ts.',
  },
  assets: records,
}, null, 2) + '\n')

console.log(`\nWave 4 intake — ${records.length} production assets\n`)
for (const r of records) {
  const srcBytes = r.sources.reduce((a, s) => a + s.bytes, 0)
  console.log(`${r.output}${r.npc ? `   (npc: ${r.npc})` : ''}${r.placements ? `   (placements: ${r.placements.join(', ')})` : ''}${r.propType ? `   (prop type: ${r.propType})` : ''}`)
  console.log(`  ${KB(srcBytes)} KB source (${r.sources.length} file${r.sources.length > 1 ? 's' : ''}) -> ${KB(r.outputBytes)} KB output  (${(100 - (r.outputBytes / srcBytes) * 100).toFixed(1)}% smaller)`)
  console.log(`  tris=${r.structure.triangles} mats=[${r.structure.materials.map((m) => m.name).join(',')}] tex=${r.structure.textures.map((t) => `${t.width}x${t.height} ${t.mime}`).join(',')}`)
  console.log(`  cameras=${r.structure.cameras} lights=${r.structure.lights} ext=[${r.structure.extensions.join(',')}]`)
  if (r.kind === 'character') {
    console.log(`  clips=[${r.structure.clips.map((c) => `${c.name} ${c.duration}s`).join(', ')}] bones=${r.rig.bones} sig=${r.rig.hierarchySignature}`)
    console.log(`  rig bounds size=[${r.rig.groundedBounds.size.join(', ')}] grounded=${r.rig.groundedBounds.baseAtGround} height=${r.rig.measuredHeightMeters} m`)
  } else {
    console.log(`  local bbox size=[${r.structure.bounds.size.join(', ')}] min=[${r.structure.bounds.min.join(', ')}] groundOffsetY=${r.groundOffsetY}`)
  }
  if (r.facades) {
    const f = r.facades
    console.log(`  facade band<=${f.bandTop}: `
      + ['south', 'north', 'east', 'west'].map((k) => `${k} span=${f[k].span} inset=${f[k].inset} v=${f[k].lowVerts}`).join('  '))
  }
  console.log(`  sha256=${r.outputSha256}`)
}
console.log(`\nwrote ${PROVENANCE_OUT}`)
