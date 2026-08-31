/**
 * Issue #38 — Integration Wave 0 deterministic asset intake pipeline.
 *
 * Rebuilds every Wave-0 production GLB from the pristine sprint sources, which are
 * opened READ-ONLY and never modified. Re-running with unchanged inputs reproduces
 * byte-identical outputs, so the recorded output hashes are verifiable.
 *
 *   node scripts/asset-intake/buildWave0.mjs [--check]
 *
 * --check rebuilds into a temp dir and fails if any committed output differs, which is
 * how CI proves the committed bytes really came from the recorded sources.
 *
 * Characters: the three per-clip sprint GLBs share a byte-identical mesh, texture and
 * 24-bone skeleton. The pipeline PROVES that before merging, then grafts the Walk/Run
 * clips onto the base document's own joints BY BONE NAME. Geometry, skin weights, bind
 * matrices and the c432d433d51d hierarchy are therefore untouched; only animation and
 * texture payload change. This reuses the H0 assembly idea (one GLB, embedded semantic
 * clips, no retarget) rather than introducing a second character/animation system.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, mergeDocuments, prune, textureCompress, unpartition } from '@gltf-transform/functions'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  CHARACTERS, STATICS, MAX_TEXTURE, TEXTURE_FORMAT, TEXTURE_QUALITY, PROVENANCE_OUT,
} from './wave0.config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = process.argv.includes('--check')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const fileSha = (p) => sha256(readFileSync(p))
const KB = (n) => +(n / 1024).toFixed(1)

/** Bone-name + parent topology signature — the same rule as humanRigContract.test.ts. */
function skeletonSignature(skin) {
  const joints = skin.listJoints()
  const set = new Set(joints)
  const rows = joints.map((j) => {
    const p = j.getParentNode?.()
    return `${j.getName()}<${p && set.has(p) ? p.getName() : 'ROOT'}`
  })
  return { count: joints.length, sig: createHash('sha1').update(rows.join('|')).digest('hex').slice(0, 12) }
}

function meshDigest(root) {
  const h = createHash('sha256')
  for (const m of root.listMeshes()) {
    for (const prim of m.listPrimitives()) {
      for (const name of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']) {
        const a = prim.getAttribute(name)
        if (a) h.update(Buffer.from(a.getArray().buffer, a.getArray().byteOffset, a.getArray().byteLength))
      }
      const idx = prim.getIndices()
      if (idx) h.update(Buffer.from(idx.getArray().buffer, idx.getArray().byteOffset, idx.getArray().byteLength))
    }
  }
  return h.digest('hex')
}

/** Structural facts read back from real bytes — never from a report. */
async function describe(path) {
  const doc = await io.read(path)
  const root = doc.getRoot()
  let tris = 0
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      const i = p.getIndices(), pos = p.getAttribute('POSITION')
      tris += ((i ? i.getCount() : pos.getCount()) / 3)
    }
  }
  const skin = root.listSkins()[0]
  const textures = root.listTextures().map((t) => {
    const size = t.getSize()
    return { name: t.getName() || null, mime: t.getMimeType(), width: size?.[0] ?? null, height: size?.[1] ?? null, bytes: t.getImage()?.byteLength ?? 0 }
  })
  const materials = root.listMaterials().map((m) => ({
    name: m.getName() || null,
    metallic: m.getMetallicFactor(),
    roughness: +m.getRoughnessFactor().toFixed(3),
    emissive: m.getEmissiveFactor().map((v) => +v.toFixed(3)),
    emissiveTexture: !!m.getEmissiveTexture(),
    specularExtension: !!m.getExtension('KHR_materials_specular'),
  }))
  const clips = root.listAnimations().map((a) => {
    let dur = 0
    for (const s of a.listSamplers()) { const inp = s.getInput(); if (inp) dur = Math.max(dur, inp.getMax([])[0]) }
    return { name: a.getName(), channels: a.listChannels().length, duration: +dur.toFixed(3) }
  })
  return {
    bytes: statSync(path).size, triangles: Math.round(tris),
    meshes: root.listMeshes().length, materials, textures, clips,
    skin: skin ? skeletonSignature(skin) : null,
    cameras: root.listCameras().length, scenes: root.listScenes().length,
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
  }
}

/** Downscale + re-encode every texture to <= MAX_TEXTURE, deterministically. */
async function reduceTextures(doc) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: TEXTURE_FORMAT, resize: [MAX_TEXTURE, MAX_TEXTURE], resizeFilter: 'lanczos3', quality: TEXTURE_QUALITY }),
    dedup(), prune({ keepAttributes: false, keepLeaves: false }),
  )
}

async function buildCharacter(def, outDir) {
  // --- Prove the merge precondition on real bytes before touching anything.
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

  // --- Base document keeps ALL geometry/skin/texture. Only clips are added.
  const doc = ref.doc
  const root = doc.getRoot()
  const jointsByName = new Map(ref.skin.listJoints().map((j) => [j.getName(), j]))
  // The base's own clip becomes the base role, renamed to its semantic name.
  const baseAnims = root.listAnimations()
  if (baseAnims.length !== 1) throw new Error(`${def.id}: expected exactly 1 clip in base, got ${baseAnims.length}`)
  baseAnims[0].setName(def.base)

  for (const role of roles) {
    if (role === def.base) continue
    const donor = parts[role]
    const donorAnims = donor.root.listAnimations()
    if (donorAnims.length !== 1) throw new Error(`${def.id}: expected exactly 1 clip in ${role}, got ${donorAnims.length}`)
    // Merge the donor document in, then retarget its channels onto the base joints by
    // name and drop everything else the merge dragged along.
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
  // Keep only the base scene; prune drops the donor scenes/meshes/skins/textures.
  for (const scene of root.listScenes()) if (scene !== root.getDefaultScene()) scene.dispose()
  await doc.transform(prune({ keepAttributes: false, keepLeaves: false }), dedup())
  await reduceTextures(doc)
  // mergeDocuments brings each donor's own Buffer along; GLB allows at most one.
  await doc.transform(unpartition())

  const outPath = join(outDir, def.out)
  mkdirSync(dirname(outPath), { recursive: true })
  await io.write(outPath, doc)
  return outPath
}

async function buildStatic(def, outDir) {
  const doc = await io.read(def.src)
  const root = doc.getRoot()
  if (root.listMaterials().length !== 1)
    throw new Error(`${def.id}: expected exactly 1 material, got ${root.listMaterials().length}`)
  // Normalize the single material name so the existing variant/slot pipeline can bind it.
  root.listMaterials()[0].setName(def.materialName)
  await doc.transform(dedup(), prune({ keepAttributes: false, keepLeaves: false }))
  await reduceTextures(doc)
  const outPath = join(outDir, def.out)
  mkdirSync(dirname(outPath), { recursive: true })
  await io.write(outPath, doc)
  return outPath
}

const outDir = CHECK ? join(ROOT, '.wave0-check') : ROOT
const records = []

for (const def of CHARACTERS) {
  const sources = Object.entries(def.sources).map(([role, p]) => ({
    role, path: p, sha256: fileSha(p), bytes: statSync(p).size, structure: null,
  }))
  for (const s of sources) s.structure = await describe(s.path)
  const outPath = await buildCharacter(def, outDir)
  records.push({
    id: def.id, label: def.label, kind: 'character', output: def.out,
    outputSha256: fileSha(outPath), outputBytes: statSync(outPath).size,
    sources,
    operations: [
      'merge 3 per-clip GLBs -> 1 production GLB (clips grafted onto the base skeleton by bone name)',
      'rename clips to canonical semantic roles Idle / Walk / Run',
      'prune + dedup (drops the two duplicate meshes/skins/textures the merge introduced)',
      `textureCompress resize <=${MAX_TEXTURE} targetFormat=${TEXTURE_FORMAT} quality=${TEXTURE_QUALITY} filter=lanczos3`,
    ],
    attribution: def.attribution, license: def.license,
    structure: await describe(outPath),
  })
}

for (const def of STATICS) {
  const record = {
    id: def.id, label: def.label, kind: 'static', output: def.out,
    sources: [{ role: 'source', path: def.src, sha256: fileSha(def.src), bytes: statSync(def.src).size, structure: await describe(def.src) }],
    operations: [
      `normalize single material name -> "${def.materialName}" (existing variant-slot pipeline)`,
      'dedup + prune',
      `textureCompress resize <=${MAX_TEXTURE} targetFormat=${TEXTURE_FORMAT} quality=${TEXTURE_QUALITY} filter=lanczos3`,
    ],
    attribution: def.attribution, license: def.license,
  }
  const outPath = await buildStatic(def, outDir)
  record.outputSha256 = fileSha(outPath)
  record.outputBytes = statSync(outPath).size
  record.structure = await describe(outPath)
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
  issue: 38, wave: 0,
  note: 'Rebuild with: node scripts/asset-intake/buildWave0.mjs   |   verify with --check',
  maxTexture: MAX_TEXTURE, textureFormat: TEXTURE_FORMAT, textureQuality: TEXTURE_QUALITY,
  assets: records,
}, null, 2) + '\n')

console.log(`\nWave 0 intake — ${records.length} production assets\n`)
for (const r of records) {
  const srcKB = r.sources.reduce((a, s) => a + s.bytes, 0) / 1024
  console.log(`${r.output}`)
  console.log(`  ${KB(srcKB * 1024)} KB source (${r.sources.length} file${r.sources.length > 1 ? 's' : ''}) -> ${KB(r.outputBytes)} KB output  (${(100 - (r.outputBytes / (srcKB * 1024)) * 100).toFixed(1)}% smaller)`)
  console.log(`  tris=${r.structure.triangles} mats=[${r.structure.materials.map((m) => m.name).join(',')}] tex=${r.structure.textures.map((t) => `${t.width}x${t.height} ${t.mime}`).join(',')}`)
  console.log(`  clips=[${r.structure.clips.map((c) => `${c.name} ${c.duration}s`).join(', ')}] bones=${r.structure.skin?.count ?? 0} sig=${r.structure.skin?.sig ?? '-'}`)
  console.log(`  sha256=${r.outputSha256}`)
}
console.log(`\nwrote ${PROVENANCE_OUT}`)
