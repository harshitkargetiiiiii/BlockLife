/**
 * Issue #27 — Ravi's natural Idle, as a REPRODUCIBLE intake step.
 *
 * Ravi's Wave-0 Idle is a single static key with the elbows bent 114°, which is what holds his
 * arms out in front of him. This module rewrites ONLY that clip's samplers into a 4 s breathing
 * loop — arms down, soft elbows, palms turned to the thighs, head level, feet planted.
 *
 * It is a DERIVATION, not a replacement asset. `buildWave0.mjs` first rebuilds Ravi from the three
 * pristine sprint clips exactly as before, asserts that intermediate's original sha256, and only
 * then applies this step — so the sprint sources stay the provenance root and the Wave-0 merge
 * contract keeps proving itself. Copying an externally-authored GLB into `public/` would have
 * silently broken that.
 *
 * What is NOT touched, and is gated by `raviIdleContract.test.ts` against the committed bytes:
 * POSITION / NORMAL / TEXCOORD_0 / JOINTS_0 / WEIGHTS_0, indices, node rest transforms, skin joint
 * order and inverse bind matrices, materials (including `KHR_materials_ior`), embedded images, and
 * the Walk / Run clips. Only the 72 channels behind "Idle" get new samplers.
 *
 * Deterministic by construction: no randomness, no clock, fixed key count, fixed trig. Three
 * independent builds produce the same sha256, which `--check` re-proves on every run.
 *
 * Authored and reviewed outside the repo first (evidence:
 * BlockLife-intake/ravi-idle-pilot-2026-09-09.wpiibR, in-game validation:
 * BlockLife-intake/ravi-ingame-validation-2026-09-09.o371fa); this file is that recipe, in-tree.
 */
globalThis.self ??= globalThis
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { io } from './lib.mjs'

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')

/** One slow breath, 15/min. */
export const IDLE_DURATION = 4.0
/** 8 keys/second -> 33 keys inclusive of the loop point. */
const FPS_KEYS = 8
const KEYS = IDLE_DURATION * FPS_KEYS + 1

/** Target world directions for each arm segment. +X is Ravi's left, +Z is his front. */
const ARM_TARGETS = {
  left: { upper: [0.17, -1.0, -0.03], fore: [0.06, -1.0, 0.14] },
  right: { upper: [-0.17, -1.0, -0.03], fore: [-0.06, -1.0, 0.14] },
}

/**
 * Where each palm should face. The rig has NO finger bones — the 24 bones stop at Left/RightHand —
 * so the mesh-authored finger splay cannot be animated away. Turning the palm to the thigh puts it
 * edge-on, which is how a relaxed hand actually reads. The palm normal is the hand bone's local -Z;
 * the roll that achieves it is SOLVED numerically below rather than assumed, because these joints
 * have arbitrary rest orientations.
 */
const HAND_TARGETS = { left: [-1, 0, 0.15], right: [1, 0, 0.15] }

/**
 * Breathing and settle, in DEGREES about world axes. Amplitudes are deliberately tiny (4.6 mm of
 * hand travel over the cycle): larger reads as a sway, not a breath. `amp2` is a second harmonic at
 * half the period — it still closes the loop exactly, and stops the cycle feeling mechanical.
 */
const BREATH = {
  period: IDLE_DURATION,
  // chest opens on inhale; neck + head counter-rotate so the head stays level
  Spine02: { axis: [1, 0, 0], amp: -0.9 },
  Spine01: { axis: [1, 0, 0], amp: -1.7 },
  Spine: { axis: [1, 0, 0], amp: -1.0 },
  neck: { axis: [1, 0, 0], amp: 1.6 },
  Head: { axis: [1, 0, 0], amp: 1.3 },
  // shoulders rise a hair with the chest; arms lag slightly so it is not mechanical
  LeftShoulder: { axis: [0, 0, 1], amp: -0.9 },
  RightShoulder: { axis: [0, 0, 1], amp: 0.9 },
  LeftArm: { axis: [0, 0, 1], amp: -1.8, phase: -0.18, amp2: -0.35 },
  RightArm: { axis: [0, 0, 1], amp: 1.8, phase: -0.18, amp2: 0.35 },
  LeftForeArm: { axis: [0, 0, 1], amp: -1.2, phase: -0.3, amp2: -0.25 },
  RightForeArm: { axis: [0, 0, 1], amp: 1.2, phase: -0.3, amp2: 0.25 },
}

/**
 * Apply a WORLD-space rotation to a bone, about the bone's own origin.
 *
 * This is why nothing here guesses an Euler axis. Ravi's joints have arbitrary rest orientations
 * (LeftArm rest q = [0.464, 0.440, 0.288, 0.713]), so "rotate X by n degrees" means something
 * different on every bone. Intent is expressed in world space and converted:
 *
 *     Q_parentWorld * q_local_new = Rw * Q_parentWorld * q_local_old
 *     => q_local_new = (Q_parentWorld^-1 * Rw * Q_parentWorld) * q_local_old
 *
 * The caller must have up-to-date world matrices.
 */
function applyWorldRotation(bone, worldQuat) {
  const parentWorld = new THREE.Quaternion()
  if (bone.parent) bone.parent.getWorldQuaternion(parentWorld)
  const delta = parentWorld.clone().invert().multiply(worldQuat).multiply(parentWorld)
  bone.quaternion.premultiply(delta)
}

/** World rotation taking unit vector `from` onto unit vector `to`. */
const rotationBetween = (from, to) =>
  new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize())

/** World-space rotation about `axis` by `deg`. */
const axisRot = (axis, deg) =>
  new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), (deg * Math.PI) / 180)

function parseGlb(bytes) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej))
}

/**
 * Author the replacement Idle and bake it into a derived document.
 *
 * @param {string} inPath  the freshly-derived, unmodified Wave-0 Ravi
 * @param {string} outPath where the derived GLB is written (may be the same path)
 * @returns {Promise<object>} measured report — arm angles before/after, key/channel counts
 */
export async function bakeRaviIdle(inPath, outPath) {
  const inBytes = readFileSync(inPath)
  const gltf = await parseGlb(inBytes)
  let mesh = null
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o })
  if (!mesh) throw new Error(`${inPath}: no skinned mesh`)
  const skeleton = mesh.skeleton
  const boneByName = new Map(skeleton.bones.map((b) => [b.name, b]))
  const root = gltf.scene

  // --- the pose the game actually shows today: the Idle clip's single key per bone -------------
  const idleClip = gltf.animations.find((a) => a.name === 'Idle')
  if (!idleClip) throw new Error(`${inPath}: no Idle clip`)
  const basePose = new Map()
  for (const t of idleClip.tracks) {
    const cut = t.name.lastIndexOf('.')
    const [name, path] = [t.name.slice(0, cut), t.name.slice(cut + 1)]
    if (!basePose.has(name)) basePose.set(name, {})
    basePose.get(name)[path] = Array.from(t.values.slice(0, path === 'quaternion' ? 4 : 3))
  }
  for (const [name, trs] of basePose) {
    const b = boneByName.get(name)
    if (!b) continue
    if (trs.position) b.position.fromArray(trs.position)
    if (trs.quaternion) b.quaternion.fromArray(trs.quaternion)
    if (trs.scale) b.scale.fromArray(trs.scale)
  }
  root.updateMatrixWorld(true)

  // --- straighten each arm onto its target directions ------------------------------------------
  const armReport = {}
  for (const side of ['left', 'right']) {
    const P = side === 'left' ? 'Left' : 'Right'
    const arm = boneByName.get(`${P}Arm`)
    const fore = boneByName.get(`${P}ForeArm`)
    const hand = boneByName.get(`${P}Hand`)
    const wp = (b) => b.getWorldPosition(new THREE.Vector3())

    const S = wp(arm)
    const E0 = wp(fore)
    const W0 = wp(hand)
    const upperLen = E0.distanceTo(S)
    const foreLen = W0.distanceTo(E0)
    const bendBefore = THREE.MathUtils.radToDeg(
      E0.clone().sub(S).normalize().angleTo(W0.clone().sub(E0).normalize()))

    // 1. upper arm: current direction -> target direction, rotated about the shoulder
    applyWorldRotation(arm, rotationBetween(
      E0.clone().sub(S).normalize(), new THREE.Vector3(...ARM_TARGETS[side].upper)))
    root.updateMatrixWorld(true)

    // 2. forearm: the same, about the elbow, after the upper arm has moved
    const E1 = wp(fore)
    applyWorldRotation(fore, rotationBetween(
      wp(hand).clone().sub(E1).normalize(), new THREE.Vector3(...ARM_TARGETS[side].fore)))
    root.updateMatrixWorld(true)

    // 3. wrist: solve the roll about the forearm axis that points the palm at the thigh.
    //    Swept numerically in 1° steps rather than assuming a sign or an Euler axis.
    const foreAxis = wp(hand).clone().sub(wp(fore)).normalize()
    const wantPalm = new THREE.Vector3(...HAND_TARGETS[side]).normalize()
    const palmNormalWorld = () =>
      new THREE.Vector3(0, 0, -1).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()))
    const q0 = hand.quaternion.clone()
    let best = { deg: 0, err: Infinity }
    for (let d = -180; d <= 180; d += 1) {
      hand.quaternion.copy(q0)
      applyWorldRotation(hand, axisRot(foreAxis, d))
      root.updateMatrixWorld(true)
      const err = palmNormalWorld().angleTo(wantPalm)
      if (err < best.err) best = { deg: d, err }
    }
    hand.quaternion.copy(q0)
    applyWorldRotation(hand, axisRot(foreAxis, best.deg))
    root.updateMatrixWorld(true)

    const E2 = wp(fore)
    const W2 = wp(hand)
    armReport[side] = {
      wristRollDeg: best.deg,
      palmErrorDegAfter: +THREE.MathUtils.radToDeg(best.err).toFixed(1),
      palmNormalAfter: palmNormalWorld().toArray().map((v) => +v.toFixed(3)),
      elbowBendBeforeDeg: +bendBefore.toFixed(1),
      elbowBendAfterDeg: +THREE.MathUtils.radToDeg(
        E2.clone().sub(wp(arm)).normalize().angleTo(W2.clone().sub(E2).normalize())).toFixed(1),
      wristWorldYBefore: +W0.y.toFixed(4),
      wristWorldYAfter: +W2.y.toFixed(4),
      // the arms are re-aimed, never stretched: both drifts must read 0.000000
      segmentLenDriftUpper: +(wp(fore).distanceTo(wp(arm)) - upperLen).toFixed(6),
      segmentLenDriftFore: +(wp(hand).distanceTo(wp(fore)) - foreLen).toFixed(6),
    }
  }

  // --- sample the animated pose ----------------------------------------------------------------
  const restingPose = new Map(skeleton.bones.map((b) => [b.name, b.quaternion.clone()]))
  const times = Array.from({ length: KEYS }, (_, i) => +(i / FPS_KEYS).toFixed(6))
  const rotationKeys = new Map(skeleton.bones.map((b) => [b.name, []]))
  for (const t of times) {
    // Start every frame from the corrected static pose so nothing accumulates.
    for (const b of skeleton.bones) b.quaternion.copy(restingPose.get(b.name))
    root.updateMatrixWorld(true)
    for (const [name, spec] of Object.entries(BREATH)) {
      const b = boneByName.get(name)
      if (!b) continue
      const phase = (spec.phase ?? 0) * Math.PI * 2
      const s = Math.sin((t / BREATH.period) * Math.PI * 2 + phase)
      const s2 = Math.sin((t / BREATH.period) * Math.PI * 4 + phase)
      applyWorldRotation(b, axisRot(new THREE.Vector3(...spec.axis), spec.amp * s + (spec.amp2 ?? 0) * s2))
      root.updateMatrixWorld(true)
    }
    for (const b of skeleton.bones) rotationKeys.get(b.name).push(...b.quaternion.toArray())
  }

  // Loop closure: t=0 and t=DURATION must be the same sample. sin() guarantees it analytically;
  // assert it numerically so a future edit cannot break the loop silently.
  let maxLoopDelta = 0
  for (const [name, vals] of rotationKeys) {
    const first = vals.slice(0, 4)
    const last = vals.slice(-4)
    const d = Math.max(...first.map((v, i) => Math.abs(v - last[i])))
    if (d > 1e-6) throw new Error(`loop discontinuity on ${name}: ${d}`)
    maxLoopDelta = Math.max(maxLoopDelta, d)
  }

  // --- bake: rewrite ONLY the Idle samplers ----------------------------------------------------
  const doc = await io.readBinary(new Uint8Array(inBytes))
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === 'Idle')
  if (!anim) throw new Error(`${inPath}: no Idle animation in the document`)
  const buffer = doc.getRoot().listBuffers()[0]

  const timeAcc = doc.createAccessor('idle_time').setType('SCALAR')
    .setArray(new Float32Array(times)).setBuffer(buffer)
  const shortTime = doc.createAccessor('idle_time_const').setType('SCALAR')
    .setArray(new Float32Array([0, IDLE_DURATION])).setBuffer(buffer)

  let rewritten = 0
  for (const ch of anim.listChannels()) {
    const name = ch.getTargetNode().getName()
    const path = ch.getTargetPath()
    const sampler = ch.getSampler()
    if (path === 'rotation') {
      const vals = rotationKeys.get(name)
      if (!vals) throw new Error(`no rotation keys for ${name}`)
      sampler.setInput(timeAcc)
      sampler.setOutput(doc.createAccessor(`idle_rot_${name}`).setType('VEC4')
        .setArray(new Float32Array(vals)).setBuffer(buffer))
    } else {
      // translation / scale: hold the ORIGINAL Idle key exactly, so nothing but rotation changes.
      // This is also why the feet stay planted — every lower-body track is a constant.
      const out = sampler.getOutput()
      const a = out.getArray()
      const n = out.getElementSize()
      const held = new Float32Array([...a.slice(0, n), ...a.slice(0, n)])
      sampler.setInput(shortTime)
      sampler.setOutput(doc.createAccessor(`idle_${path}_${name}`).setType(out.getType())
        .setArray(held).setBuffer(buffer))
    }
    sampler.setInterpolation('LINEAR')
    rewritten++
  }

  await io.write(outPath, doc)
  return {
    clip: { name: 'Idle', durationSeconds: IDLE_DURATION, keys: KEYS, channelsRewritten: rewritten },
    maxLoopEndpointDelta: maxLoopDelta,
    arms: armReport,
  }
}
