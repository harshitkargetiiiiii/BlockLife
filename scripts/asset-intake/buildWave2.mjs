/**
 * Issue #42 — Integration Wave 2 deterministic asset intake pipeline.
 *
 * Rebuilds the three Wave-2 production street-prop GLBs from the pristine sprint sources, which
 * are opened READ-ONLY and never modified. Re-running with unchanged inputs reproduces
 * byte-identical outputs, so the recorded output hashes are independently verifiable.
 *
 *   node scripts/asset-intake/buildWave2.mjs [--check]
 *
 * --check rebuilds into a real temporary directory outside the worktree and fails if any
 * committed output differs, which is how CI proves the committed bytes really came from the
 * recorded sources. It never writes inside the worktree.
 *
 * This shares every primitive with Waves 0 and 1 through ./lib.mjs — the same read, assert,
 * normalize, prune, texture-reduce and verify steps — rather than forking a third intake
 * pattern. What Wave 2 adds to the shared library is `ground`: a centred-origin source (the
 * hydrant) is grounded with a ROOT-NODE TRANSLATION, so mesh accessors, indices, topology and
 * triangle count stay byte-identical and the mesh-digest assertion still holds.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSource, buildStatic, describe, fileSha, io, KB, makeCheckDir,
} from './lib.mjs'
import {
  PROPS, MAX_TEXTURE, TEXTURE_FORMAT, TEXTURE_QUALITY, PROVENANCE_OUT, BOUNDS_EPSILON, SCALE_DECIMALS,
} from './wave2.config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = process.argv.includes('--check')
const outDir = CHECK ? makeCheckDir('wave2') : ROOT
const opts = { maxTexture: MAX_TEXTURE, format: TEXTURE_FORMAT, quality: TEXTURE_QUALITY }
const records = []

/**
 * Measure where a lamp's light-emitting HEAD sits on the body, from the real vertices.
 *
 * The approved streetlight is a vintage shepherd's-crook lantern: the pole runs up the origin
 * and the lantern hangs forward off the crook, so "the light is at the top of the pole" is
 * simply false for this body — the emitter is offset in Z and is NOT the topmost geometry (the
 * finial above it is). Guessing would put the repo's functional night light inside the pole or
 * floating in the air, which is exactly the defect the Wave-2 evidence has to rule out.
 *
 * The rule, applied to the LOCAL bbox and deliberately shape-independent:
 *   1. slice the model into 20 equal-height slabs and count vertices per slab;
 *   2. take the busiest slab ABOVE mid-height — a lantern head is by far the densest thing up
 *      there (2,096 vertices in its widest belt, against ~20 for the bare crook arm);
 *   3. grow that band outwards while neighbouring slabs still hold >= 25% of the peak count;
 *   4. the emitter is the axis-aligned bbox of the band; its centre is where the bulb goes and
 *      its SMALLEST half-extent is the largest radius that stays inside the lantern body.
 *
 * Returned in LOCAL model units; the manifest scales it by the projected uniform scale.
 */
function measureEmitter(root) {
  const prim = root.listMeshes()[0].listPrimitives()[0]
  const arr = prim.getAttribute('POSITION').getArray()
  const pts = []
  for (let i = 0; i < arr.length; i += 3) pts.push([arr[i], arr[i + 1], arr[i + 2]])
  const maxY = Math.max(...pts.map((p) => p[1]))
  const SLABS = 20
  const h = maxY / SLABS
  const counts = new Array(SLABS).fill(0)
  for (const p of pts) counts[Math.min(SLABS - 1, Math.floor(p[1] / h))]++
  let peak = -1, peakN = -1
  for (let b = Math.ceil(SLABS / 2); b < SLABS; b++) if (counts[b] > peakN) { peakN = counts[b]; peak = b }
  const threshold = peakN * 0.25
  let lo = peak, hi = peak
  while (lo - 1 >= 0 && counts[lo - 1] >= threshold) lo--
  while (hi + 1 < SLABS && counts[hi + 1] >= threshold) hi++
  const band = pts.filter((p) => p[1] >= lo * h && p[1] < (hi + 1) * h)
  const min = [0, 1, 2].map((k) => Math.min(...band.map((p) => p[k])))
  const max = [0, 1, 2].map((k) => Math.max(...band.map((p) => p[k])))
  const round = (n) => +n.toFixed(4)
  return {
    rule: 'busiest 1/20-height slab above mid-height, grown while neighbours hold >=25% of the peak vertex count',
    band: [round(lo * h), round((hi + 1) * h)],
    vertices: band.length,
    min: min.map(round),
    max: max.map(round),
    center: [0, 1, 2].map((k) => round((min[k] + max[k]) / 2)),
    halfExtents: [0, 1, 2].map((k) => round((max[k] - min[k]) / 2)),
  }
}

for (const def of PROPS) {
  if (!existsSync(def.src)) throw new Error(`${def.id}: approved source missing at ${def.src}`)
  const source = assertSource(def, 'source', def.src, def.expect)
  source.structure = await describe(def.src)
  if (def.expect?.triangles && source.structure.triangles !== def.expect.triangles)
    throw new Error(`${def.id}: source triangles ${source.structure.triangles} != approved ${def.expect.triangles}`)
  if (def.expect?.bytes && source.bytes !== def.expect.bytes)
    throw new Error(`${def.id}: source bytes ${source.bytes} != approved ${def.expect.bytes}`)

  // Grounding is decided from the MEASURED source, not declared by hand: an already-grounded
  // source yields offset 0 and is left completely alone.
  const groundOffsetY = def.ground ? +(-source.structure.bounds.min[1]).toFixed(4) : 0

  const record = {
    id: def.id, label: def.label, kind: 'prop', propType: def.propType, output: def.out,
    sources: [source],
    groundOffsetY,
    operations: [
      `assert approved source SHA-256 ${def.expect.sha256} + ${def.expect.bytes} bytes + ${def.expect.triangles} triangles before reading (read-only)`,
      `normalize single material name -> "${def.materialName}" (baked atlas — exposes NO recolorable slot)`,
      ...(groundOffsetY !== 0
        ? [`ground by root-node translation +${groundOffsetY} on Y (mesh accessors untouched); assert rendered minimum y=0`]
        : ['origin already at the base — no vertical transform applied']),
      'dedup + prune',
      `textureCompress resize <=${MAX_TEXTURE} targetFormat=${TEXTURE_FORMAT} quality=${TEXTURE_QUALITY} filter=lanczos3`,
      'assert mesh digest unchanged (geometry, indices, topology, triangle count, proportions preserved)',
      'assert bounds unchanged except the declared grounding offset on Y',
      'assert runtime-safe: metallic 0, emissive [0,0,0], no unlit/lights/cameras, no draco/meshopt/KTX2, embedded textures only',
    ],
    attribution: def.attribution, license: def.license,
  }

  const outPath = await buildStatic(def, outDir, opts)
  record.outputSha256 = fileSha(outPath)
  record.outputBytes = statSync(outPath).size
  record.structure = await describe(outPath)
  if (def.measureEmitter) record.emitter = measureEmitter((await io.read(outPath)).getRoot())
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
  issue: 42, wave: 2,
  note: 'Rebuild with: node scripts/asset-intake/buildWave2.mjs   |   verify with --check',
  maxTexture: MAX_TEXTURE, textureFormat: TEXTURE_FORMAT, textureQuality: TEXTURE_QUALITY,
  boundsEpsilon: BOUNDS_EPSILON, scaleDecimals: SCALE_DECIMALS,
  projection:
    'Uniform scale s = floor(min(visualHalf.x / extX, visualHalf.z / extZ, (vertical[1]-vertical[0]) / sizeY) * 1e4) / 1e4, '
    + 'against the AUTHORED envelope in src/game/world/propPlacement.ts and the measured local bbox '
    + '(each measured dimension inflated by boundsEpsilon first). Recomputed in src/game/assets/wave2Contract.test.ts.',
  assets: records,
}, null, 2) + '\n')

console.log(`\nWave 2 intake — ${records.length} production street-prop assets\n`)
for (const r of records) {
  const src = r.sources[0]
  console.log(`${r.output}   (prop type: ${r.propType})`)
  console.log(`  ${KB(src.bytes)} KB source -> ${KB(r.outputBytes)} KB output  (${(100 - (r.outputBytes / src.bytes) * 100).toFixed(1)}% smaller)`)
  console.log(`  tris=${r.structure.triangles} mats=[${r.structure.materials.map((m) => m.name).join(',')}] tex=${r.structure.textures.map((t) => `${t.width}x${t.height} ${t.mime}`).join(',')}`)
  console.log(`  local bbox size=[${r.structure.bounds.size.join(', ')}] min=[${r.structure.bounds.min.join(', ')}] groundOffsetY=${r.groundOffsetY}`)
  console.log(`  cameras=${r.structure.cameras} lights=${r.structure.lights} ext=[${r.structure.extensions.join(',')}]`)
  if (r.emitter) console.log(`  emitter band=[${r.emitter.band.join(', ')}] center=[${r.emitter.center.join(', ')}] halfExtents=[${r.emitter.halfExtents.join(', ')}]`)
  console.log(`  sha256=${r.outputSha256}`)
}
console.log(`\nwrote ${PROVENANCE_OUT}`)
