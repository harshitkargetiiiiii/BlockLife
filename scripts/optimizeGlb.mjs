/**
 * GLB texture-budget optimizer (issue #21 §2/§12 asset-staging step). Downscales
 * every embedded texture so its longest side is ≤ maxSize (default 1024, the
 * texture budget), using the system `sips` for the pixel resize and
 * gltf-transform to rebuild the container/buffers correctly. Also prunes and
 * dedupes unused data. Geometry is untouched. Deterministic for a given input.
 *
 * Usage: node scripts/optimizeGlb.mjs <in.glb> <out.glb> [maxSize]
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, prune } from '@gltf-transform/functions'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [input, output, maxArg] = process.argv.slice(2)
if (!input || !output) {
  console.error('usage: optimizeGlb.mjs <in.glb> <out.glb> [maxSize]')
  process.exit(2)
}
const MAX = Number(maxArg) || 1024

const io = new NodeIO()
const doc = await io.read(input)
const tmp = mkdtempSync(join(tmpdir(), 'glbtex-'))

let resized = 0
for (const tex of doc.getRoot().listTextures()) {
  const img = tex.getImage()
  if (!img) continue
  const mime = tex.getMimeType()
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png'
  const f = join(tmp, `t_${resized}.${ext}`)
  writeFileSync(f, Buffer.from(img))
  // Query current dimensions; only resize if larger than MAX.
  const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f]).toString()
  const w = Number(dims.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0)
  const h = Number(dims.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0)
  if (Math.max(w, h) > MAX) {
    execFileSync('sips', ['--resampleHeightWidthMax', String(MAX), f], { stdio: 'ignore' })
    tex.setImage(new Uint8Array(readFileSync(f)))
    resized++
  }
}

await doc.transform(dedup(), prune())
await io.write(output, doc)
console.log(`optimized ${output}: ${resized} texture(s) resized to ≤${MAX}px`)
