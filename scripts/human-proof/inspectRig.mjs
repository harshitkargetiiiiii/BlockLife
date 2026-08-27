/**
 * Human Visual Gold Standard v1 — H0 technical proof, step 1: rig inspection (issue #27).
 *
 * Zero-credit diagnostic. Loads a character GLB headless (three GLTFLoader + a one-line `self`
 * polyfill — no Blender) and reports the skeleton contract the retarget/bake pipeline depends on:
 * bone names + parent hierarchy, units, rest transforms, skin-influence counts, zero/invalid
 * weights, max influences per vertex, bind-matrix count, grounded bounds, and a hierarchy
 * signature (exact-match) kept separate from body rest-pose data (may differ per body).
 *
 * Usage: node scripts/human-proof/inspectRig.mjs <a.glb> [b.glb ...]
 */
globalThis.self ??= globalThis
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { createHash } from 'node:crypto'

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')

function parse(path) {
  const b = readFileSync(path)
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej))
}

function skinnedOf(gltf) {
  let s = null
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !s) s = o })
  return s
}

/** Exact-match structural signature: bone names + parent indices (NOT translations). */
export function hierarchySignature(skeleton) {
  const idx = new Map(skeleton.bones.map((b, i) => [b, i]))
  const rows = skeleton.bones.map((b) => `${b.name}<${b.parent && idx.has(b.parent) ? skeleton.bones[idx.get(b.parent)].name : 'ROOT'}`)
  return createHash('sha1').update(rows.join('|')).digest('hex').slice(0, 12)
}

export async function inspect(path) {
  const gltf = await parse(path)
  const mesh = skinnedOf(gltf)
  const skel = mesh.skeleton
  const bones = skel.bones
  const idx = new Map(bones.map((b, i) => [b, i]))

  // skin influence analysis from geometry skinIndex/skinWeight (4-wide)
  const wAttr = mesh.geometry.getAttribute('skinWeight')
  const iAttr = mesh.geometry.getAttribute('skinIndex')
  const vcount = wAttr.count
  let maxInfluences = 0, zeroWeightVerts = 0, nanVerts = 0
  const influenceHist = [0, 0, 0, 0, 0] // #verts with 0..4 nonzero influences
  const usedBones = new Set()
  for (let v = 0; v < vcount; v++) {
    let nz = 0, sum = 0, bad = false
    for (let k = 0; k < 4; k++) {
      const w = wAttr.getComponent(v, k)
      if (Number.isNaN(w)) bad = true
      if (w > 1e-5) { nz++; sum += w; usedBones.add(iAttr.getComponent(v, k)) }
    }
    if (bad) nanVerts++
    if (nz === 0) zeroWeightVerts++
    maxInfluences = Math.max(maxInfluences, nz)
    influenceHist[Math.min(nz, 4)]++
  }

  // grounded bounds
  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const size = new THREE.Vector3(); box.getSize(size)

  const hipsY = (bones.find((b) => /hips/i.test(b.name))?.position.y) ?? 0
  const units = hipsY > 10 ? 'centimeters (~100x)' : 'meters'

  return {
    file: path.split('/').pop(),
    bones: bones.length,
    hierarchySignature: hierarchySignature(skel),
    units,
    forwardAxisConvention: '+z (repo character convention; verify visually)',
    bindMatrices: skel.boneInverses.length,
    skinInfluences: { vertices: vcount, maxPerVertex: maxInfluences, zeroWeightVerts, nanVerts, histogram_0to4: influenceHist, distinctBonesUsed: usedBones.size },
    groundedBounds: { min: box.min.toArray().map((v) => +v.toFixed(3)), max: box.max.toArray().map((v) => +v.toFixed(3)), size: size.toArray().map((v) => +v.toFixed(3)), baseAtGround: Math.abs(box.min.y) < (units.startsWith('meters') ? 0.05 : 5) },
    restTransforms: bones.map((b) => ({ name: b.name, parent: b.parent && idx.has(b.parent) ? bones[idx.get(b.parent)].name : 'ROOT', t: b.position.toArray().map((v) => +v.toFixed(3)) })),
    clips: gltf.animations.map((a) => ({ name: a.name, tracks: a.tracks.length, duration: +a.duration.toFixed(3) })),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = process.argv.slice(2)
  const out = []
  for (const p of paths) {
    const r = await inspect(p)
    out.push(r)
    console.log(`\n===== ${r.file} =====`)
    console.log(`bones=${r.bones}  units=${r.units}  hierarchySig=${r.hierarchySignature}  bindMatrices=${r.bindMatrices}`)
    console.log(`skin: verts=${r.skinInfluences.vertices} maxInfluences=${r.skinInfluences.maxPerVertex} zeroWeight=${r.skinInfluences.zeroWeightVerts} NaN=${r.skinInfluences.nanVerts} hist(0..4)=${JSON.stringify(r.skinInfluences.histogram_0to4)} bonesUsed=${r.skinInfluences.distinctBonesUsed}`)
    console.log(`bounds: min=${JSON.stringify(r.groundedBounds.min)} max=${JSON.stringify(r.groundedBounds.max)} baseAtGround=${r.groundedBounds.baseAtGround}`)
    console.log(`clips: ${JSON.stringify(r.clips)}`)
  }
  if (out.length >= 2) {
    const [a, b] = out.slice(-2)
    console.log(`\n===== COMPARE ${a.file} vs ${b.file} =====`)
    console.log(`hierarchy signature match (exact): ${a.hierarchySignature === b.hierarchySignature}`)
    if (a.hierarchySignature === b.hierarchySignature) {
      let maxDT = 0
      for (let i = 0; i < a.restTransforms.length; i++)
        for (let k = 0; k < 3; k++) maxDT = Math.max(maxDT, Math.abs(a.restTransforms[i].t[k] - b.restTransforms[i].t[k]))
      console.log(`max rest-pose translation delta: ${maxDT.toFixed(3)} → body rest-pose data DIFFERS (expected; input to retarget, NOT a rejection reason)`)
    }
  }
}
