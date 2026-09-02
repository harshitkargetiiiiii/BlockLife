/**
 * Shared deterministic asset-intake primitives (issue #38 Wave 0, generalized for issue #40
 * Wave 1). Every pristine sprint source is opened READ-ONLY; nothing here ever writes back to
 * an input path.
 *
 * The contract these helpers exist to keep: re-running an intake with unchanged inputs must
 * reproduce byte-identical outputs, so the hashes recorded in the provenance registry are
 * independently verifiable with `--check`.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, textureCompress } from '@gltf-transform/functions'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
export const fileSha = (p) => sha256(readFileSync(p))
export const KB = (n) => +(n / 1024).toFixed(1)

/** Bone-name + parent topology signature — the same rule as humanRigContract.test.ts. */
export function skeletonSignature(skin) {
  const joints = skin.listJoints()
  const set = new Set(joints)
  const rows = joints.map((j) => {
    const p = j.getParentNode?.()
    return `${j.getName()}<${p && set.has(p) ? p.getName() : 'ROOT'}`
  })
  return { count: joints.length, sig: createHash('sha1').update(rows.join('|')).digest('hex').slice(0, 12) }
}

export function meshDigest(root) {
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

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const mul = (a, b) => {
  const o = new Array(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  }
  return o
}
const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

/**
 * Scene-graph-aware local bounding box, in the model's OWN space with every node matrix
 * applied. The manifest's scale is derived from this, so it must reflect exactly what
 * three.js will load — reading raw POSITION accessors instead would silently ignore a
 * node transform and produce a wrongly-scaled shell.
 */
export function measureBounds(root) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const visit = (node, parent) => {
    const world = mul(parent, node.getMatrix())
    const mesh = node.getMesh()
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')
        if (!pos) continue
        const arr = pos.getArray()
        for (let i = 0; i < arr.length; i += 3) {
          const v = apply(world, arr[i], arr[i + 1], arr[i + 2])
          for (let a = 0; a < 3; a++) {
            if (v[a] < min[a]) min[a] = v[a]
            if (v[a] > max[a]) max[a] = v[a]
          }
        }
      }
    }
    for (const child of node.listChildren()) visit(child, world)
  }
  if (scene) for (const node of scene.listChildren()) visit(node, IDENTITY)
  const round = (n) => +n.toFixed(4)
  return {
    min: min.map(round),
    max: max.map(round),
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map(round),
  }
}

/** Structural facts read back from real bytes — never from a report. */
export async function describe(path) {
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
    lights: root.listExtensionsUsed()
      .filter((e) => e.extensionName === 'KHR_lights_punctual')
      .reduce((n, e) => n + (e.listProperties?.().length ?? 0), 0),
    bounds: measureBounds(root),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
  }
}

/** Downscale + re-encode every texture to <= maxTexture, deterministically. */
export async function reduceTextures(doc, { maxTexture, format, quality }) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: format, resize: [maxTexture, maxTexture], resizeFilter: 'lanczos3', quality }),
    dedup(), prune({ keepAttributes: false, keepLeaves: false }),
  )
}

/**
 * The runtime-safety invariants issue #40 requires, asserted on the document that is ABOUT to
 * be written. Anything that would make the shipped GLB self-lit, network-dependent, or
 * dependent on a loader extension the app does not register is a hard build failure — never a
 * silently-accepted output.
 */
export function assertRuntimeSafe(id, doc) {
  const root = doc.getRoot()
  const fail = (msg) => { throw new Error(`${id}: ${msg}`) }
  if (root.listCameras().length) fail(`${root.listCameras().length} camera(s) in a production asset`)
  for (const ext of root.listExtensionsUsed().map((e) => e.extensionName)) {
    if (/KHR_lights_punctual|KHR_materials_unlit|draco|meshopt|KHR_texture_basisu/i.test(ext))
      fail(`banned extension ${ext}`)
  }
  for (const m of root.listMaterials()) {
    const name = m.getName() || '(unnamed)'
    if (m.getMetallicFactor() !== 0) fail(`material ${name} metallic ${m.getMetallicFactor()} != 0`)
    if (m.getEmissiveFactor().some((v) => v !== 0)) fail(`material ${name} emissive ${m.getEmissiveFactor()} != [0,0,0]`)
    if (m.getEmissiveTexture()) fail(`material ${name} carries an emissive texture (self-glow at night)`)
    if (m.getExtension('KHR_materials_specular')) fail(`material ${name} carries KHR_materials_specular`)
  }
  for (const t of root.listTextures()) {
    if (t.getURI()) fail(`texture ${t.getName() || '(unnamed)'} has an external URI — embedded only`)
    if (!t.getImage()) fail(`texture ${t.getName() || '(unnamed)'} has no embedded image`)
  }
}

/**
 * Deterministic grounding for a source whose origin is CENTRED rather than at its base
 * (issue #42: the approved fire hydrant reports minY = -1, because it skipped the remesh
 * stage where `origin_at: bottom` is applied).
 *
 * The shift is applied as a ROOT-NODE TRANSLATION, never by rewriting vertices: every mesh
 * accessor byte — positions, indices, UVs, topology, triangle count — is left exactly as the
 * owner approved it, which is why `buildStatic` can still assert a byte-identical mesh digest
 * across the transform. `measureBounds` walks node matrices, so the shift is visible in the
 * measured bounds exactly as three.js will render it.
 */
function translateSceneRoots(root, offsetY) {
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  if (!scene) throw new Error('grounding: document has no scene')
  for (const node of scene.listChildren()) {
    const [x, y, z] = node.getTranslation()
    node.setTranslation([x, y + offsetY, z])
  }
}

/**
 * Static (non-skinned) intake: material-name normalization for the existing variant/paint slot
 * contract, prune/dedupe, texture reduction. GEOMETRY AND INDICES ARE NEVER TOUCHED — the mesh
 * digest is asserted identical across the transform, so a regression in a future gltf-transform
 * release cannot silently reshape an approved asset.
 *
 * The ORIGIN is untouched too unless the def opts into `ground: true`, in which case the whole
 * scene is translated (node transform only — see `translateSceneRoots`) so the rendered minimum
 * is exactly y = 0. The bounds check below is what proves it: the box must move by EXACTLY the
 * declared offset on Y and by nothing at all on X/Z, and its size must be unchanged.
 */
export async function buildStatic(def, outDir, opts) {
  const doc = await io.read(def.src)
  const root = doc.getRoot()
  if (root.listMaterials().length !== 1)
    throw new Error(`${def.id}: expected exactly 1 material, got ${root.listMaterials().length}`)
  if (root.listMeshes().length !== 1)
    throw new Error(`${def.id}: expected exactly 1 mesh, got ${root.listMeshes().length}`)
  const before = { mesh: meshDigest(root), bounds: measureBounds(root) }

  root.listMaterials()[0].setName(def.materialName)
  const groundOffsetY = def.ground ? -before.bounds.min[1] : 0
  if (groundOffsetY !== 0) translateSceneRoots(root, groundOffsetY)
  await doc.transform(dedup(), prune({ keepAttributes: false, keepLeaves: false }))
  await reduceTextures(doc, opts)

  const after = { mesh: meshDigest(root), bounds: measureBounds(root) }
  if (after.mesh !== before.mesh)
    throw new Error(`${def.id}: geometry changed during intake (${before.mesh.slice(0, 12)} -> ${after.mesh.slice(0, 12)})`)
  const expected = {
    min: before.bounds.min.map((v, i) => (i === 1 ? v + groundOffsetY : v)),
    max: before.bounds.max.map((v, i) => (i === 1 ? v + groundOffsetY : v)),
    size: before.bounds.size,
  }
  for (const key of ['min', 'max', 'size']) {
    for (let i = 0; i < 3; i++) {
      if (Math.abs(after.bounds[key][i] - expected[key][i]) > 1e-4)
        throw new Error(
          `${def.id}: bounds.${key}[${i}] changed during intake — ${after.bounds[key][i]} != ${expected[key][i]}`,
        )
    }
  }
  if (def.ground && after.bounds.min[1] !== 0)
    throw new Error(`${def.id}: grounding failed — rendered minimum is y=${after.bounds.min[1]}, not 0`)
  assertRuntimeSafe(def.id, doc)

  const outPath = join(outDir, def.out)
  mkdirSync(dirname(outPath), { recursive: true })
  await io.write(outPath, doc)
  return outPath
}

/**
 * `--check` rebuilds into a REAL temporary directory outside the repository and removes it on
 * every exit path, so verifying never dirties the worktree (issue #38 Codex review, finding 7).
 */
export function makeCheckDir(tag) {
  let dir = mkdtempSync(join(tmpdir(), `blocklife-${tag}-check-`))
  const cleanup = () => {
    if (!dir) return
    const d = dir
    dir = null
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  process.on('exit', cleanup)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130) })
  process.on('uncaughtException', (err) => { cleanup(); console.error(err); process.exit(1) })
  return dir
}

/**
 * Assert a pristine source is EXACTLY the owner-approved file before it is read for intake.
 * SHA-256 is the authoritative identity; the byte count is a secondary, human-readable check.
 */
export function assertSource(def, role, path, expected) {
  const actual = fileSha(path)
  if (expected?.sha256 && actual !== expected.sha256)
    throw new Error(`${def.id} (${role}): source hash mismatch\n  path     ${path}\n  expected ${expected.sha256}\n  actual   ${actual}`)
  return { role, path, sha256: actual, bytes: statSync(path).size }
}
