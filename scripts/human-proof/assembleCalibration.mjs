/**
 * Human Visual Gold Standard v1 — H0 Calibration: assemble ONE 5-clip GLB (issue #27).
 *
 * Deterministic, Blender-free, texture-preserving. Merges the calibration body's FREE Meshy
 * Smart-Rig walk + run (each shipped as a separate `_withSkin.glb`) onto ONE textured skinned
 * mesh, then AUTHORS three short deterministic clips (Idle / Turn / Seated) on the SAME 24-bone
 * canonical skeleton (hierarchy signature c432d433d51d) — the per-body-embedded architecture the
 * H0 technical proof validated (no cross-body retarget). Output clip set: Idle, Walk, Run, Turn,
 * Seated. Walk/Run root drift is pinned to frame-0 so locomotion plays IN PLACE (the runtime moves
 * the actor via physics). gltf-transform is used (not headless three GLTFExporter) precisely so the
 * baked face/normal textures survive — three can't decode PNGs headless.
 *
 * Walk/Run = the repo-owned Meshy rig clips (recorded provenance). Idle/Turn/Seated = ORIGINAL
 * in-repository deterministic clips authored here. Input _withSkin GLBs are gitignored under _proof/.
 *
 * Usage: node scripts/human-proof/assembleCalibration.mjs
 */
import { NodeIO } from '@gltf-transform/core'

const DIR = 'public/assets/models/characters/_proof/'
const io = new NodeIO()

// ---- quaternion helpers (x,y,z,w) ----
const axisAngle = (ax, ay, az, ang) => {
  const l = Math.hypot(ax, ay, az) || 1
  const s = Math.sin(ang / 2)
  return [(ax / l) * s, (ay / l) * s, (az / l) * s, Math.cos(ang / 2)]
}
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]

const nodesByName = (doc) => {
  const m = {}
  for (const n of doc.getRoot().listNodes()) m[n.getName()] = n
  return m
}

// The rig's BIND pose is a T-pose (arms straight out). The Meshy walk/run clips pose the arms
// themselves, but the AUTHORED clips must not inherit the T-pose — bring the arms down to the
// sides. A deterministic neutral down pose = the component-wise mean of the walk clip's per-arm-bone
// rotation over the whole cycle (the fore/aft swing cancels out). Legs/spine keep the bind pose
// (T-pose legs are already straight + together, correct for standing).
const ARM_BONES = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'RightShoulder', 'RightArm', 'RightForeArm']
function averageRotation(anim, boneName) {
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() !== 'rotation' || ch.getTargetNode()?.getName() !== boneName) continue
    const a = ch.getSampler().getOutput().getArray()
    const acc = [0, 0, 0, 0]
    const n = a.length / 4
    for (let i = 0; i < n; i++) {
      // align sign to the first sample so the mean doesn't cancel across the double cover.
      const dot = a[i * 4] * a[0] + a[i * 4 + 1] * a[1] + a[i * 4 + 2] * a[2] + a[i * 4 + 3] * a[3]
      const s = dot < 0 ? -1 : 1
      for (let k = 0; k < 4; k++) acc[k] += s * a[i * 4 + k]
    }
    const l = Math.hypot(...acc) || 1
    return acc.map((v) => v / l)
  }
  return null
}

/** Create one authored rotation animation on `doc`. Arm bones default to `armDown`; `spec` bends
 *  compose onto each bone's base pose (armDown for arms, bind rest otherwise). */
function authorClip(doc, N, buf, name, spec, times, armDown) {
  const anim = doc.createAnimation(name)
  const emit = (bone, frames) => {
    const node = N[bone]
    if (!node) return
    const out = []
    for (const q of frames) out.push(q[0], q[1], q[2], q[3])
    const t = frames.length === 2 ? [times[0], times[times.length - 1]] : times
    const input = doc.createAccessor(`${name}_${bone}_t`).setType('SCALAR').setArray(new Float32Array(t)).setBuffer(buf)
    const output = doc.createAccessor(`${name}_${bone}_r`).setType('VEC4').setArray(new Float32Array(out)).setBuffer(buf)
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR')
    const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler)
    anim.addSampler(sampler).addChannel(channel)
  }
  const base = (bone) => armDown[bone] || N[bone]?.getRotation()
  // 1) arms down (static) for any arm bone the spec doesn't already drive.
  for (const bone of ARM_BONES) {
    if (spec[bone] || !armDown[bone]) continue
    emit(bone, [armDown[bone], armDown[bone]])
  }
  // 2) spec bends, composed onto each bone's base pose.
  for (const [bone, [ax, ay, az, angle]] of Object.entries(spec)) {
    const b = base(bone)
    if (!b) continue
    const peak = qmul(b, axisAngle(ax, ay, az, angle))
    emit(bone, times.length === 3 ? [b, peak, b] : [peak, peak])
  }
  return anim
}

/** Copy every channel of a single-animation source doc into `dst`, rebinding nodes by NAME. */
function copyAnim(srcAnim, dst, N, buf, name) {
  const anim = dst.createAnimation(name)
  for (const ch of srcAnim.listChannels()) {
    const srcNode = ch.getTargetNode()
    const node = N[srcNode.getName()]
    if (!node) continue
    const s = ch.getSampler()
    const input = dst.createAccessor().setType('SCALAR').setArray(new Float32Array(s.getInput().getArray())).setBuffer(buf)
    const outSrc = s.getOutput()
    const output = dst.createAccessor().setType(outSrc.getType()).setArray(new Float32Array(outSrc.getArray())).setBuffer(buf)
    const sampler = dst.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation())
    const channel = dst.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sampler)
    anim.addSampler(sampler).addChannel(channel)
  }
  return anim
}

/** In-place locomotion: drop scale channels (identity, save size) and pin Hips X/Z to frame 0. */
function cleanLocomotion(anim) {
  for (const ch of anim.listChannels()) {
    if (ch.getTargetPath() === 'scale') {
      const s = ch.getSampler()
      anim.removeChannel(ch)
      if (s) anim.removeSampler(s)
      continue
    }
    if (ch.getTargetPath() === 'translation' && ch.getTargetNode()?.getName() === 'Hips') {
      const out = ch.getSampler().getOutput()
      const a = Array.from(out.getArray()) // [x,y,z, x,y,z, ...]
      const x0 = a[0], z0 = a[2]
      for (let i = 0; i < a.length; i += 3) { a[i] = x0; a[i + 2] = z0 }
      out.setArray(new Float32Array(a))
    }
  }
}

// ---- assemble ----
const main = await io.read(DIR + 'cand1_walk.glb')
const runDoc = await io.read(DIR + 'cand1_run.glb')
const N = nodesByName(main)
const buf = main.getRoot().listBuffers()[0]

// Meshy binds the base-colour map to emissive too → the body self-glows and ignores day/night
// lighting. Zero the emissive so it lights normally (baseColour + scene lights only).
for (const mat of main.getRoot().listMaterials()) {
  mat.setEmissiveFactor([0, 0, 0])
  if (mat.getEmissiveTexture()) mat.setEmissiveTexture(null)
}

// Walk = the body's own embedded Meshy walk (rename + make in-place).
const walk = main.getRoot().listAnimations()[0]
walk.setName('Walk')
// Neutral arms-down pose for the authored clips (mean of the walk cycle's arm rotations).
const armDown = {}
for (const b of ARM_BONES) { const q = averageRotation(walk, b); if (q) armDown[b] = q }
// armDown captured before cleanLocomotion (rotation channels are untouched by it)
cleanLocomotion(walk)

// Run = the free Meshy run, copied in + made in-place.
const run = copyAnim(runDoc.getRoot().listAnimations()[0], main, N, buf, 'Run')
cleanLocomotion(run)

// Authored deterministic clips on the shared skeleton (arms down via armDown; legs/spine at bind).
authorClip(main, N, buf, 'Idle',
  { Spine: [1, 0, 0, 0.06], Spine01: [1, 0, 0, 0.04], neck: [1, 0, 0, 0.05], LeftArm: [0, 0, 1, 0.06], RightArm: [0, 0, 1, -0.06] },
  [0, 1.2, 2.4], armDown)
authorClip(main, N, buf, 'Turn',
  { Hips: [0, 1, 0, 1.4], Spine: [0, 1, 0, 0.2] },
  [0, 0.6, 1.2], armDown)
authorClip(main, N, buf, 'Seated',
  { LeftUpLeg: [1, 0, 0, 1.45], RightUpLeg: [1, 0, 0, 1.45], LeftLeg: [1, 0, 0, -1.45], RightLeg: [1, 0, 0, -1.45], Spine: [1, 0, 0, 0.1], LeftArm: [0, 0, 1, 0.1], RightArm: [0, 0, 1, -0.1] },
  [0, 1.0], armDown)

// Order the clip list Idle, Walk, Run, Turn, Seated for readability (not semantically required).
const order = ['Idle', 'Walk', 'Run', 'Turn', 'Seated']
const byName = {}
for (const a of main.getRoot().listAnimations()) byName[a.getName()] = a

await io.write(DIR + 'cand1_calibration.glb', main)
const report = order.map((n) => {
  const a = byName[n]
  const ch = a.listChannels().length
  const dur = Math.max(...a.listSamplers().map((s) => { const t = s.getInput().getArray(); return t[t.length - 1] }))
  return `${n}: ${ch}ch ${dur.toFixed(2)}s`
})
console.log('assembled cand1_calibration.glb')
console.log('clips:', report.join(' | '))
