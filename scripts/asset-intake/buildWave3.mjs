/**
 * Issue #44 — Integration Wave 3 deterministic asset intake pipeline.
 *
 * Rebuilds the six Wave-3 production BUILDING GLBs from the pristine sprint sources, which are
 * opened READ-ONLY and never modified. Re-running with unchanged inputs reproduces
 * byte-identical outputs, so the recorded output hashes are independently verifiable.
 *
 *   node scripts/asset-intake/buildWave3.mjs [--check]
 *
 * --check rebuilds into a real temporary directory outside the worktree and fails if any
 * committed output differs, which is how CI proves the committed bytes really came from the
 * recorded sources. It never writes inside the worktree.
 *
 * This shares every primitive with Waves 0, 1 and 2 through ./lib.mjs — the same read, assert,
 * normalize, prune, texture-reduce and verify steps — rather than forking a fourth intake
 * pattern. What Wave 3 adds is `facade`: a measured, shape-independent read of WHICH SIDE of a
 * building body its entrance is on, so the manifest's canonical facing is derived from the real
 * vertices instead of guessed from a filename.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSource, buildStatic, describe, fileSha, io, KB, makeCheckDir,
} from './lib.mjs'
import {
  BUILDINGS, MAX_TEXTURE, TEXTURE_FORMAT, TEXTURE_QUALITY, PROVENANCE_OUT, BOUNDS_EPSILON, SCALE_DECIMALS,
} from './wave3.config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = process.argv.includes('--check')
const outDir = CHECK ? makeCheckDir('wave3') : ROOT
const opts = { maxTexture: MAX_TEXTURE, format: TEXTURE_FORMAT, quality: TEXTURE_QUALITY }
const records = []

/**
 * Per-side geometric profile of a building body, measured from the real vertices.
 *
 * Issue #44 forbids guessing orientation from a filename, and a wrong guess is not cosmetic: it
 * puts a shop's shutter against a back alley and turns the authored door anchor into a blank
 * wall. The rendered cardinal captures in the Wave-3 visual spec are the primary evidence; this
 * measurement is the machine-readable half that ships in the provenance so a reviewer can check
 * the manifest's `rotation` against something other than a screenshot.
 *
 * For each of the four cardinal sides we report, in LOCAL model units:
 *   - `span`:   the width of that face (the extent along the side's lateral axis);
 *   - `inset`:  how much the lower body is recessed behind the side's outermost plane, sampled
 *               over the ENTRANCE BAND (the bottom 30% of the body, where doors and shutters
 *               live). A flat wall reads ~0; a recessed shopfront, a porch or an open roller
 *               shutter reads clearly positive.
 *   - `lowVerts`: how many vertices sit in that entrance band within 12% of the side's plane —
 *               door frames, steps, awnings and shutter slats are geometry, so an entrance side
 *               is markedly denser than a blank gable.
 *
 * Nothing here PICKS the facing: the manifest declares it and the visual evidence proves it.
 * This is the measurement a reviewer reads alongside both.
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

  // axis: 0 = X, 2 = Z. sign: +1 = the max side, -1 = the min side.
  const side = (axis, sign) => {
    const lateral = axis === 0 ? 2 : 0
    const plane = sign > 0 ? hi[axis] : lo[axis]
    const depth = size[axis]
    const near = band.filter((p) => Math.abs(p[axis] - plane) <= depth * 0.12)
    // Outermost surface of the entrance band on this side, vs the body's overall plane.
    const bandPlane = band.length
      ? (sign > 0 ? Math.max(...band.map((p) => p[axis])) : Math.min(...band.map((p) => p[axis])))
      : plane
    return {
      span: round(size[lateral]),
      inset: round(Math.abs(plane - bandPlane)),
      lowVerts: near.length,
    }
  }
  return {
    rule: 'per-side span / entrance-band inset / near-plane vertex density, measured in the bottom 30% of the body',
    bandTop: round(bandTop),
    bandVertices: band.length,
    // Model-local cardinal names, using the repo's convention that +z is 'south'.
    south: side(2, 1),
    north: side(2, -1),
    east: side(0, 1),
    west: side(0, -1),
  }
}

for (const def of BUILDINGS) {
  if (!existsSync(def.src)) throw new Error(`${def.id}: approved source missing at ${def.src}`)
  const source = assertSource(def, 'source', def.src, def.expect)
  source.structure = await describe(def.src)
  if (def.expect?.triangles && source.structure.triangles !== def.expect.triangles)
    throw new Error(`${def.id}: source triangles ${source.structure.triangles} != approved ${def.expect.triangles}`)
  if (def.expect?.bytes && source.bytes !== def.expect.bytes)
    throw new Error(`${def.id}: source bytes ${source.bytes} != approved ${def.expect.bytes}`)

  // Grounding is decided from the MEASURED source, not declared by hand: an already-grounded
  // source yields offset 0 and is left completely alone. All six Wave-3 sources are
  // bottom-origin, so this is an assertion rather than a transform.
  const groundOffsetY = def.ground ? +(-source.structure.bounds.min[1]).toFixed(4) : 0

  const record = {
    id: def.id, label: def.label, kind: 'building', placements: def.placements, output: def.out,
    sources: [source],
    groundOffsetY,
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

  const outPath = await buildStatic(def, outDir, opts)
  record.outputSha256 = fileSha(outPath)
  record.outputBytes = statSync(outPath).size
  record.structure = await describe(outPath)
  record.facades = measureFacades((await io.read(outPath)).getRoot())
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
  issue: 44, wave: 3,
  note: 'Rebuild with: node scripts/asset-intake/buildWave3.mjs   |   verify with --check',
  maxTexture: MAX_TEXTURE, textureFormat: TEXTURE_FORMAT, textureQuality: TEXTURE_QUALITY,
  boundsEpsilon: BOUNDS_EPSILON, scaleDecimals: SCALE_DECIMALS,
  projection:
    'Uniform scale s = floor(min(w / fx, d / fz) * 1e4) / 1e4, where (w, d) is the placement’s AUTHORED '
    + 'def.size footprint in src/game/world/cityLayout.ts and (fx, fz) are the measured local X/Z extents '
    + 'after the canonical-facing yaw that points the body’s front at the authored door (each measured '
    + 'dimension inflated by boundsEpsilon first). Recomputed in src/game/assets/wave3Contract.test.ts.',
  assets: records,
}, null, 2) + '\n')

console.log(`\nWave 3 intake — ${records.length} production building assets\n`)
for (const r of records) {
  const src = r.sources[0]
  console.log(`${r.output}   (placements: ${r.placements.join(', ')})`)
  console.log(`  ${KB(src.bytes)} KB source -> ${KB(r.outputBytes)} KB output  (${(100 - (r.outputBytes / src.bytes) * 100).toFixed(1)}% smaller)`)
  console.log(`  tris=${r.structure.triangles} mats=[${r.structure.materials.map((m) => m.name).join(',')}] tex=${r.structure.textures.map((t) => `${t.width}x${t.height} ${t.mime}`).join(',')}`)
  console.log(`  local bbox size=[${r.structure.bounds.size.join(', ')}] min=[${r.structure.bounds.min.join(', ')}] groundOffsetY=${r.groundOffsetY}`)
  console.log(`  cameras=${r.structure.cameras} lights=${r.structure.lights} ext=[${r.structure.extensions.join(',')}]`)
  const f = r.facades
  console.log(`  facade band<=${f.bandTop}: `
    + ['south', 'north', 'east', 'west'].map((k) => `${k} span=${f[k].span} inset=${f[k].inset} v=${f[k].lowVerts}`).join('  '))
  console.log(`  sha256=${r.outputSha256}`)
}
console.log(`\nwrote ${PROVENANCE_OUT}`)
