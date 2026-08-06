/**
 * Normalize a raw Meshy GLB to BlockLife's canonical material-slot contract
 * (issue #21 §2 import/staging step). Third-party generators emit geometry with
 * unnamed / missing materials; the runtime variant system (§3) targets materials
 * by NAME, so this deterministic pass ensures a named material exists and is
 * assigned to every primitive that lacks one. Geometry is untouched — only the
 * material naming is normalized. Editing the glTF JSON chunk directly keeps it
 * dependency-free and reproducible (same input → same output).
 *
 * Usage:
 *   node scripts/normalizeMeshyGlb.mjs <in.glb> [--paint-name paint]
 *        [--base-color 0.84,0.90,0.93] [--out out.glb]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
function flag(name, def) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const input = args[0]
if (!input) {
  console.error('usage: normalizeMeshyGlb.mjs <in.glb> [--paint-name paint] [--base-color r,g,b] [--out out.glb]')
  process.exit(2)
}
const paintName = flag('--paint-name', 'paint')
const output = flag('--out', input)
const baseColor = flag('--base-color', '0.843,0.902,0.933')
  .split(',')
  .map(Number)

const buf = readFileSync(input)
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)')
const total = buf.readUInt32LE(8)
let o = 12
let json = null
let bin = null
while (o + 8 <= total) {
  const cl = buf.readUInt32LE(o)
  const ct = buf.readUInt32LE(o + 4)
  const data = buf.subarray(o + 8, o + 8 + cl)
  if (ct === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
  else if (ct === 0x004e4942) bin = Buffer.from(data)
  o += 8 + cl
}
if (!json) throw new Error('GLB has no JSON chunk')

json.materials = json.materials ?? []
let idx = json.materials.findIndex((m) => m.name === paintName)
if (idx < 0) {
  json.materials.push({
    name: paintName,
    pbrMetallicRoughness: {
      baseColorFactor: [baseColor[0], baseColor[1], baseColor[2], 1],
      metallicFactor: 0.15,
      roughnessFactor: 0.55,
    },
  })
  idx = json.materials.length - 1
}
let assigned = 0
for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    if (prim.material == null) {
      prim.material = idx
      assigned++
    }
  }
}

function padTo4(b, padByte) {
  const rem = b.length % 4
  return rem === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - rem, padByte)])
}
const jsonBuf = padTo4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
const chunks = []
const jc = Buffer.alloc(8)
jc.writeUInt32LE(jsonBuf.length, 0)
jc.writeUInt32LE(0x4e4f534a, 4)
chunks.push(jc, jsonBuf)
if (bin) {
  const binBuf = padTo4(bin, 0x00)
  const bc = Buffer.alloc(8)
  bc.writeUInt32LE(binBuf.length, 0)
  bc.writeUInt32LE(0x004e4942, 4)
  chunks.push(bc, binBuf)
}
const body = Buffer.concat(chunks)
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + body.length, 8)
writeFileSync(output, Buffer.concat([header, body]))
console.log(
  `normalized ${output}: material '${paintName}' assigned to ${assigned} primitive(s); ${json.materials.length} material(s) total`,
)
