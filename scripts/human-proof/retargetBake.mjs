/**
 * Human Visual Gold Standard v1 — H0 technical proof, step 2: build-time retarget + bake (issue #27).
 *
 * Zero-credit, Blender-free, deterministic. Proves the REQUIRED production path:
 *   load body skeleton+skin → validate hierarchy signature → retarget ONE canonical source clip
 *   (the owned male walk) onto the body's proportions (three SkeletonUtils.retargetClip) →
 *   author per-body diagnostic clips (idle/run/seated/elbow+knee) on the body's own rest pose →
 *   BAKE the body-specific clips into an optimized GLB with semantic idle/walk/run/seat names.
 * The runtime then loads those EMBEDDED clips through the existing AnimatedCharacter path.
 *
 * Clip ownership: Walk = the repo-owned Meshy walk clip (recorded license), retargeted.
 * Idle/Run/Seated/ElbowKnee = ORIGINAL in-repository deterministic diagnostic test data authored
 * here (not final art). Outputs are DIAGNOSTIC ONLY — written to a gitignored _proof/ dir, never
 * the production manifest.
 *
 * Usage: node scripts/human-proof/retargetBake.mjs
 */
globalThis.self ??= globalThis
// Minimal FileReader polyfill for GLTFExporter binary concat (same technique as buildCharacterGlb.mjs).
class FR {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(b).toString('base64'); this.onloadend?.() }) }
}
globalThis.FileReader ??= FR
globalThis.Blob ??= (await import('node:buffer')).Blob

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import * as THREE from 'three'
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
const { retargetClip } = await import('three/examples/jsm/utils/SkeletonUtils.js')
import { inspect } from './inspectRig.mjs'

const CH = 'public/assets/models/characters/'
// Diagnostic output lives OUTSIDE public/ so `vite build` never copies it into dist/.
const OUT = 'dev-review-assets/_proof/'
mkdirSync(OUT, { recursive: true })

const parse = (p) => { const b = readFileSync(p); const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej)) }
const skinnedOf = (g) => { let s = null; g.scene.traverse((o) => { if (o.isSkinnedMesh && !s) s = o }); return s }
const boneByName = (mesh, name) => mesh.skeleton.bones.find((b) => b.name === name)

/** Compose a per-body diagnostic quaternion clip from local rest × axis-angle bends. */
function bendClip(mesh, name, spec, duration, hold = false) {
  const times = hold ? [0, duration] : [0, duration / 2, duration]
  const tracks = []
  for (const [boneName, [ax, ay, az, angle]] of Object.entries(spec)) {
    const bone = boneByName(mesh, boneName)
    if (!bone) continue
    const rest = bone.quaternion.clone()
    const bent = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax, ay, az).normalize(), angle))
    const frames = hold ? [bent, bent] : [rest, bent, rest]
    const values = []
    for (const q of frames) values.push(q.x, q.y, q.z, q.w)
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values))
  }
  return new THREE.AnimationClip(name, duration, tracks)
}

/** Time-scale a clip (Run = faster Walk). */
function timeScale(clip, factor, name) {
  const c = clip.clone(); c.name = name
  for (const t of c.tracks) t.times = t.times.map((x) => x * factor)
  c.resetDuration()
  return c
}

function flattenMaterials(scene, color) {
  // Modern three auto-enables skinning for SkinnedMesh; a flat material is fine for the
  // DEFORMATION review (textures aren't decodable headless and are irrelevant to skinning).
  scene.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 }) })
}

/** retargetClip emits `.bones[X].prop` tracks; GLTFExporter binds by node name `X.prop`. */
function normalizeTrackNames(clip) {
  for (const t of clip.tracks) t.name = t.name.replace(/^\.bones\[(.+?)\]/, '$1')
  return clip
}

/**
 * Skeletal clips are rotation-driven: keep every `.quaternion` track + ONLY the hip `.position`
 * (root translation). Drop per-bone `.scale` (the Meshy clip bakes scale — the retarget's scale
 * explosion / scrunch source) and per-limb `.position` (stretches bones on a different-proportion
 * body). This is the fix the H0 proof validates.
 */
function skeletalCleanup(clip) {
  clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'Hips.position')
  clip.resetDuration?.()
  return clip
}

function exportGlb(scene, animations, outPath) {
  return new Promise((res, rej) => new GLTFExporter().parse(scene, (glb) => { writeFileSync(outPath, Buffer.from(glb)); res(glb.byteLength) }, rej, { binary: true, animations }))
}

const male = await parse(CH + 'blocklife_male_01.glb')
const female = await parse(CH + 'blocklife_female_01.glb')
const maleMesh = skinnedOf(male), femaleMesh = skinnedOf(female)
const walkSource = male.animations[0] // owned Meshy walk clip

// Hierarchy-signature gate: reject retarget if the topology differs (never on proportions).
const mi = await inspect(CH + 'blocklife_male_01.glb'), fi = await inspect(CH + 'blocklife_female_01.glb')
if (mi.hierarchySignature !== fi.hierarchySignature) { console.log('REJECT: hierarchy signatures differ — not retarget-compatible'); process.exit(1) }
console.log(`hierarchy signature gate: PASS (${mi.hierarchySignature}); body rest deltas are retarget input`)

const bodies = [{ name: 'male', gltf: male, mesh: maleMesh, skin: '#c98d63' }, { name: 'female', gltf: female, mesh: femaleMesh, skin: '#d8a077' }]
const report = []

for (const b of bodies) {
  // 1) canonical Walk retargeted from the male source onto THIS body's proportions
  const walk = skeletalCleanup(normalizeTrackNames(retargetClip(b.mesh, maleMesh, walkSource, { preserveHipPosition: false })))
  walk.name = 'Walk'
  // 2) per-body authored diagnostic clips (original test data), on this body's own rest pose
  const run = timeScale(walk, 0.62, 'Run')
  const idle = bendClip(b.mesh, 'Idle', { Spine: [1, 0, 0, 0.05], neck: [1, 0, 0, 0.04] }, 2.4)
  // knees bend (Leg local +x), elbows bend (ForeArm local +x) — signs verified in the motion review
  const elbowKnee = bendClip(b.mesh, 'ElbowKnee', { LeftLeg: [1, 0, 0, 1.3], RightLeg: [1, 0, 0, 1.3], LeftForeArm: [1, 0, 0, 1.3], RightForeArm: [1, 0, 0, 1.3] }, 2.0)
  const seated = bendClip(b.mesh, 'Seated', { LeftUpLeg: [1, 0, 0, 1.4], RightUpLeg: [1, 0, 0, 1.4], LeftLeg: [1, 0, 0, -1.4], RightLeg: [1, 0, 0, -1.4] }, 1.0, true)
  const clips = [idle, walk, run, elbowKnee, seated]

  // Control: the body's OWN embedded walk, renamed 'Walk', with NO retarget — to isolate
  // retarget quality (this is the per-body-embedded path the proof recommends).
  const control = skeletalCleanup(normalizeTrackNames(b.gltf.animations[0].clone()))
  control.name = 'Walk'

  flattenMaterials(b.gltf.scene, b.skin)
  await exportGlb(b.gltf.scene, [control], `${OUT}${b.name}_control.glb`)
  const bytes = await exportGlb(b.gltf.scene, clips, `${OUT}${b.name}_proof.glb`)
  report.push({ body: b.name, out: `${b.name}_proof.glb`, bytes, clips: clips.map((c) => `${c.name}:${c.duration.toFixed(2)}s/${c.tracks.length}tr`) })
  console.log(`baked ${b.name}_proof.glb  ${(bytes / 1024).toFixed(0)} KB  clips=[${clips.map((c) => c.name).join(', ')}]  walk retargeted tracks=${walk.tracks.length}`)
}

writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 2))
console.log('\nDIAGNOSTIC proof GLBs written to', OUT, '(gitignored). Determinism: same inputs → same output.')
