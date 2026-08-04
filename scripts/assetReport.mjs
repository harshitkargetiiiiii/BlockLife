/**
 * Deterministic 3D-asset inventory + budget report (issue #21 §2 import report /
 * §12 perf-regression harness). Walks the GLB assets, parses each container's
 * JSON chunk directly (NO three.js, NO DOM — so it runs headless and is a stable
 * before/after perf harness), and checks per-category browser budgets.
 *
 * Usage: node scripts/assetReport.mjs [modelsDir] [--json out.json]
 * Exit 1 if any asset is over budget (so CI/the gate can enforce §12).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, relative, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const jsonIdx = argv.indexOf('--json')
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
const MODELS = argv[0] && !argv[0].startsWith('--') ? argv[0] : join(ROOT, 'public/assets/models')

// Per-category triangle + texture budgets from issue #21 §11/§12.
const TRI_BUDGET = { characters: 45000, vehicles: 40000, city: 60000, props: 10000 }
const NPC_TRI_BAR = 25000 // characters that aren't the hero
const MAX_TEXTURE = 1024

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (extname(p).toLowerCase() === '.glb') out.push(p)
  }
  return out
}

/** Read the JSON chunk (and locate the BIN chunk) of a binary glTF. */
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('bad GLB magic')
  const length = buf.readUInt32LE(8)
  let offset = 12
  let json = null
  let bin = null
  while (offset + 8 <= length) {
    const chunkLen = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const data = buf.subarray(offset + 8, offset + 8 + chunkLen)
    if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (chunkType === 0x004e4942) bin = data
    offset += 8 + chunkLen
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  return { json, bin }
}

function triangleCount(gltf) {
  let tris = 0
  const accessors = gltf.accessors ?? []
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if ((prim.mode ?? 4) !== 4) continue // only triangles
      const count =
        prim.indices != null
          ? accessors[prim.indices]?.count ?? 0
          : accessors[prim.attributes?.POSITION]?.count ?? 0
      tris += Math.floor(count / 3)
    }
  }
  return tris
}

/** Best-effort embedded-texture dimensions from PNG (IHDR) / JPEG (SOF) headers. */
function imageDims(bytes) {
  if (!bytes || bytes.length < 24) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) {
        o++
        continue
      }
      const marker = bytes[o + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: bytes.readUInt16BE(o + 5), w: bytes.readUInt16BE(o + 7) }
      }
      o += 2 + bytes.readUInt16BE(o + 2)
    }
  }
  return null
}

function textureInfo(gltf, bin) {
  const images = gltf.images ?? []
  const views = gltf.bufferViews ?? []
  const dims = []
  for (const img of images) {
    if (img.bufferView != null && bin) {
      const v = views[img.bufferView]
      const bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)
      dims.push(imageDims(bytes))
    } else dims.push(null)
  }
  return dims
}

function categoryOf(path) {
  return relative(MODELS, path).split(/[\\/]/)[0] // city | props | vehicles | characters
}

const rows = []
let overBudget = 0
for (const file of walk(MODELS).sort()) {
  const buf = readFileSync(file)
  let gltf, bin
  try {
    ;({ json: gltf, bin } = parseGlb(buf))
  } catch (e) {
    rows.push({ file: relative(ROOT, file), error: String(e.message) })
    overBudget++
    continue
  }
  const cat = categoryOf(file)
  const tris = triangleCount(gltf)
  const materials = (gltf.materials ?? []).map((m) => m.name).filter(Boolean)
  const clips = (gltf.animations ?? []).map((a) => a.name).filter(Boolean)
  const tex = textureInfo(gltf, bin)
  const maxTex = tex.reduce((mx, d) => Math.max(mx, d ? Math.max(d.w, d.h) : 0), 0)
  const budget = TRI_BUDGET[cat] ?? Infinity
  const over = tris > budget || maxTex > MAX_TEXTURE
  if (over) overBudget++
  rows.push({
    file: relative(ROOT, file),
    category: cat,
    kb: +(buf.length / 1024).toFixed(1),
    triangles: tris,
    budget: Number.isFinite(budget) ? budget : null,
    npcBar: cat === 'characters' ? NPC_TRI_BAR : null,
    materials,
    clips,
    textures: tex.length,
    maxTexture: maxTex || null,
    over,
  })
}

const pad = (s, n) => String(s).padEnd(n)
console.log(`\n3D asset inventory — ${relative(ROOT, MODELS)} (${rows.length} GLB)\n`)
console.log(pad('file', 46), pad('cat', 11), pad('KB', 8), pad('tris', 8), pad('budget', 8), pad('tex', 6), 'clips')
console.log('-'.repeat(104))
for (const r of rows) {
  if (r.error) {
    console.log(pad(basename(r.file), 46), 'ERROR', r.error)
    continue
  }
  console.log(
    pad(basename(r.file), 46),
    pad(r.category, 11),
    pad(r.kb, 8),
    pad(r.triangles, 8),
    pad(r.budget ?? '-', 8),
    pad(r.maxTexture ?? '-', 6),
    (r.clips.join(',') || '-') + (r.over ? '  ⚠ OVER' : ''),
  )
}
console.log('-'.repeat(104))
console.log('materials/slots per asset (for variant mapping):')
for (const r of rows) if (!r.error) console.log(`  ${basename(r.file)}: [${r.materials.join(', ') || '(none)'}]`)
console.log(`\n${rows.length} assets, ${overBudget} over budget/errored.\n`)

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ modelsDir: relative(ROOT, MODELS), rows }, null, 2))
  console.log(`wrote ${jsonOut}`)
}
process.exit(overBudget > 0 ? 1 : 0)
