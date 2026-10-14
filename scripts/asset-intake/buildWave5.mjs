/**
 * Integration Wave 5 deterministic asset intake pipeline — the live police cruiser body.
 *
 * Rebuilds the one Wave-5 production GLB from its pristine sprint source, which is opened
 * READ-ONLY and never modified. Unchanged inputs reproduce byte-identical output, so the recorded
 * hash is independently verifiable.
 *
 *   node scripts/asset-intake/buildWave5.mjs [--check]
 *
 * --check rebuilds into a real temporary directory OUTSIDE the worktree and fails if the committed
 * output differs. It never writes inside the worktree.
 *
 * This is the Wave 1–4 static-vehicle path verbatim through ./lib.mjs (assert source → normalize the
 * single material name → dedup/prune → texture reduce → assert mesh digest + bounds unchanged →
 * assert runtime-safe). What it adds is only the fit: the envelope-bound uniform scale is COMPUTED
 * here from the shipped bytes and recorded, so the manifest's `scale` is checkable, not transcribed.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSource, buildStatic, describe, fileSha, makeCheckDir } from './lib.mjs'
import {
  VEHICLES, CRUISER_ENVELOPE, MAX_TEXTURE, TEXTURE_FORMAT, TEXTURE_QUALITY, PROVENANCE_OUT,
  BOUNDS_EPSILON, SCALE_DECIMALS,
} from './wave5.config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = process.argv.includes('--check')
const outDir = CHECK ? makeCheckDir('wave5') : ROOT
const TEXTURE_OPTS = { maxTexture: MAX_TEXTURE, format: TEXTURE_FORMAT, quality: TEXTURE_QUALITY }
const records = []

/**
 * Every approved vehicle source is modelled with its LENGTH on model-local X; the cruiser group
 * places `CarMesh` with its length on local Z. So the body carries a +π/2 yaw (the convention the
 * shipped compact car and the four Wave-4 parked bodies already use), which maps model X → world Z
 * and model Z → world X. The largest UNIFORM scale that keeps all three rendered extents inside the
 * envelope is the binding ratio; it is floored to SCALE_DECIMALS so rounding can never push a face
 * past the envelope.
 */
function fitInside(size, env) {
  const [sx, sy, sz] = size // model-local
  // Same formula (and the same BOUNDS_EPSILON guard) the Wave 4 parked-body contract recomputes.
  const ratios = {
    length: (2 * env.halfZ) / (sx + BOUNDS_EPSILON),
    width: (2 * env.halfX) / (sz + BOUNDS_EPSILON),
    height: env.maxY / (sy + BOUNDS_EPSILON),
  }
  const binding = Object.entries(ratios).sort((a, b) => a[1] - b[1])[0]
  const k = 10 ** SCALE_DECIMALS
  const scale = Math.floor(binding[1] * k) / k
  return {
    scale, binding: binding[0], ratios,
    rendered: { width: +(sz * scale).toFixed(4), height: +(sy * scale).toFixed(4), length: +(sx * scale).toFixed(4) },
  }
}

for (const def of VEHICLES) {
  if (!existsSync(def.src)) throw new Error(`${def.id}: approved source missing at ${def.src}`)
  const source = assertSource(def, 'source', def.src, def.expect)
  source.structure = await describe(def.src)
  if (source.structure.triangles !== def.expect.triangles)
    throw new Error(`${def.id}: source triangles ${source.structure.triangles} != approved ${def.expect.triangles}`)
  if (source.bytes !== def.expect.bytes)
    throw new Error(`${def.id}: source bytes ${source.bytes} != approved ${def.expect.bytes}`)

  const groundOffsetY = def.ground ? +(-source.structure.bounds.min[1]).toFixed(4) : 0
  const outPath = await buildStatic(def, outDir, TEXTURE_OPTS)
  const structure = await describe(outPath)
  const fit = fitInside(structure.bounds.size, CRUISER_ENVELOPE)
  for (const [axis, v] of Object.entries({ halfX: fit.rendered.width / 2, halfZ: fit.rendered.length / 2, maxY: fit.rendered.height })) {
    if (v > CRUISER_ENVELOPE[axis] + BOUNDS_EPSILON)
      throw new Error(`${def.id}: fitted ${axis} ${v} exceeds the cruiser envelope ${CRUISER_ENVELOPE[axis]}`)
  }
  records.push({
    id: def.id, label: def.label, kind: 'vehicle', envelope: def.envelope,
    output: def.out, outputSha256: fileSha(outPath), outputBytes: statSync(outPath).size,
    sources: [source], groundOffsetY,
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
      `fit: +pi/2 yaw, uniform scale ${fit.scale} (${fit.binding}-bound) inside the cruiser envelope`,
    ],
    fit: { yaw: 'PI/2', envelope: CRUISER_ENVELOPE, ...fit },
    attribution: def.attribution, license: def.license,
    structure,
  })
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
  wave: 5,
  note: 'Rebuild with: node scripts/asset-intake/buildWave5.mjs   |   verify with --check',
  maxTexture: MAX_TEXTURE, textureFormat: TEXTURE_FORMAT, textureQuality: TEXTURE_QUALITY,
  boundsEpsilon: BOUNDS_EPSILON, scaleDecimals: SCALE_DECIMALS, cruiserEnvelope: CRUISER_ENVELOPE,
  assets: records,
}, null, 2) + '\n')
for (const r of records) console.log(`${r.id}  ${r.outputBytes} B  sha ${r.outputSha256.slice(0, 16)}…  scale ${r.fit.scale} (${r.fit.binding})  rendered ${JSON.stringify(r.fit.rendered)}`)
