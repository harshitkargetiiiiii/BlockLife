/**
 * Issue #40 — Integration Wave 1 deterministic asset intake pipeline.
 *
 * Rebuilds the three Wave-1 production vehicle GLBs from the pristine sprint sources, which
 * are opened READ-ONLY and never modified. Re-running with unchanged inputs reproduces
 * byte-identical outputs, so the recorded output hashes are verifiable.
 *
 *   node scripts/asset-intake/buildWave1.mjs [--check]
 *
 * --check rebuilds into a real temporary directory and fails if any committed output differs,
 * which is how CI proves the committed bytes really came from the recorded sources. It never
 * writes inside the worktree.
 *
 * This shares its primitives with Wave 0 through ./lib.mjs — the same read, normalize, prune,
 * texture-reduce and verify steps — rather than forking a second intake pattern. Beyond Wave 0
 * it additionally (a) asserts each source's approved SHA-256 BEFORE reading it, (b) asserts the
 * mesh digest and bounds are unchanged by the transform, and (c) asserts the runtime-safety
 * invariants of issue #40 (metallic 0, emissive [0,0,0], no unlit/light/camera, no external
 * texture URL) on the document about to be written.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSource, buildStatic, describe, fileSha, KB, makeCheckDir,
} from './lib.mjs'
import { segmentPaintedVehicle } from './segmentation.mjs'
import {
  VEHICLES, MAX_TEXTURE, TEXTURE_FORMAT, TEXTURE_QUALITY, PROVENANCE_OUT, FOOTPRINT_FILL,
} from './wave1.config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = process.argv.includes('--check')
const outDir = CHECK ? makeCheckDir('wave1') : ROOT
const opts = { maxTexture: MAX_TEXTURE, format: TEXTURE_FORMAT, quality: TEXTURE_QUALITY }
const records = []

for (const def of VEHICLES) {
  if (!existsSync(def.src)) throw new Error(`${def.id}: approved source missing at ${def.src}`)
  const source = assertSource(def, 'source', def.src, def.expect)
  source.structure = await describe(def.src)
  if (def.expect?.triangles && source.structure.triangles !== def.expect.triangles)
    throw new Error(`${def.id}: source triangles ${source.structure.triangles} != approved ${def.expect.triangles}`)
  // Recorded, not enforced: the SHA-256 above is the authoritative identity. See the note in
  // wave1.config.mjs about issue #40's van byte column.
  const byteNote = def.expect?.bytes && source.bytes !== def.expect.bytes
    ? `issue #40 table lists ${def.expect.bytes} bytes; the file matching the approved SHA-256 is ${source.bytes}`
    : null

  const record = {
    id: def.id, label: def.label, kind: 'vehicle', vehicleDefId: def.vehicleDefId, output: def.out,
    sources: [source],
    byteNote,
    operations: [
      `assert approved source SHA-256 ${def.expect.sha256} before reading (read-only)`,
      `normalize single material name -> "${def.materialName}" (existing variant/paint slot pipeline)`,
      'dedup + prune',
      `textureCompress resize <=${MAX_TEXTURE} targetFormat=${TEXTURE_FORMAT} quality=${TEXTURE_QUALITY} filter=lanczos3`,
      'assert mesh digest + bounds unchanged (geometry, indices, origin, wheel count preserved)',
      'assert runtime-safe: metallic 0, emissive [0,0,0], no unlit/lights/cameras, embedded textures only',
    ],
    attribution: def.attribution, license: def.license,
  }
  const outPath = await buildStatic(def, outDir, opts)
  // Issue #50: a DERIVED segmentation step, deliberately AFTER buildStatic rather than inside it.
  // buildStatic's contract is that geometry is byte-identical to the approved source; keeping the
  // split outside it means that guarantee still holds for the document this reads, and the split's
  // own invariants (same triangles, same vertex positions once composed) are asserted separately.
  if (def.segmentation) {
    record.segmentation = await segmentPaintedVehicle(outPath, outDir, def.segmentation)
    record.operations.push(
      `issue #50: split into ${record.segmentation.parts.length} position-connected parts (body + ${record.segmentation.wheels.length} wheels, each with its own node pivot); vertices copied verbatim, no weld, no UV rewrite`,
      `issue #50: derive paint mask -> ${def.segmentation.maskOut} (${record.segmentation.paintMask.bytes} bytes) so a recolor cannot reach glass, lamps, tyres or trim`,
      'issue #50: assert triangle count, referenced-vertex count and every composed vertex position unchanged',
    )
    record.segmentation.maskSha256 = fileSha(join(outDir, def.segmentation.maskOut))
    record.segmentation.maskOutput = def.segmentation.maskOut
  }
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
    // Issue #50: the derived paint mask is a shipped output too, so --check has to prove its bytes
    // came from this pipeline as well — otherwise the one file the recolor depends on would be the
    // only unverified thing in the wave.
    if (r.segmentation) {
      const maskPath = join(ROOT, r.segmentation.maskOutput)
      if (!existsSync(maskPath)) { console.error(`✗ missing committed output ${r.segmentation.maskOutput}`); bad++ }
      else {
        const haveMask = fileSha(maskPath)
        if (haveMask !== r.segmentation.maskSha256) { console.error(`✗ ${r.segmentation.maskOutput}\n    committed ${haveMask}\n    rebuilt   ${r.segmentation.maskSha256}`); bad++ }
        else console.log(`✓ ${r.segmentation.maskOutput} reproduces byte-identically (${haveMask.slice(0, 16)}…)`)
      }
    }
  }
  process.exit(bad ? 1 : 0)
}

mkdirSync(join(ROOT, dirname(PROVENANCE_OUT)), { recursive: true })
writeFileSync(join(ROOT, PROVENANCE_OUT), JSON.stringify({
  issue: 40, wave: 1,
  derivedBy: { issue: 50, note: 'The sports coupe carries an additional DERIVED segmentation step (scripts/asset-intake/segmentation.mjs) so saved paint and wheel selections are visible on the approved body. The approved source is unchanged and still read-only.' },
  note: 'Rebuild with: node scripts/asset-intake/buildWave1.mjs   |   verify with --check',
  maxTexture: MAX_TEXTURE, textureFormat: TEXTURE_FORMAT, textureQuality: TEXTURE_QUALITY,
  footprintFill: FOOTPRINT_FILL,
  projection: 'Uniform scale s = min(2*halfLength*fill/localX, 2*halfWidth*fill/localZ) from vehicleRegistry; rotation [0, PI/2, 0] maps the model nose (local -X) onto the shell nose (world +Z). Recomputed in src/game/assets/wave1Contract.test.ts.',
  assets: records,
}, null, 2) + '\n')

console.log(`\nWave 1 intake — ${records.length} production vehicle assets\n`)
for (const r of records) {
  const src = r.sources[0]
  console.log(`${r.output}   (${r.vehicleDefId})`)
  console.log(`  ${KB(src.bytes)} KB source -> ${KB(r.outputBytes)} KB output  (${(100 - (r.outputBytes / src.bytes) * 100).toFixed(1)}% smaller)`)
  console.log(`  tris=${r.structure.triangles} mats=[${r.structure.materials.map((m) => m.name).join(',')}] tex=${r.structure.textures.map((t) => `${t.width}x${t.height} ${t.mime}`).join(',')}`)
  console.log(`  local bbox size=[${r.structure.bounds.size.join(', ')}] min=[${r.structure.bounds.min.join(', ')}]`)
  console.log(`  cameras=${r.structure.cameras} lights=${r.structure.lights} ext=[${r.structure.extensions.join(',')}]`)
  if (r.byteNote) console.log(`  note: ${r.byteNote}`)
  console.log(`  sha256=${r.outputSha256}`)
}
console.log(`\nwrote ${PROVENANCE_OUT}`)
