/**
 * Issue #27 (named slice) — the reviewed Idle-only derivation for Wave 4 named residents, in-tree.
 *
 * This is the externally authored and reviewed core (BlockLife-intake/named-idle-2026-09-15/scripts/idle-core.mjs,
 * sha256 95e64d3a…) with its absolute paths replaced by repository imports. Its evidence-only nearest-vertex
 * clearance code and CLI are not carried; every numeric step that produces the Idle keys is unchanged, so the
 * build reproduces the reviewed candidate bytes exactly (asserted by buildWave4.mjs against wave4.config.mjs).
 *
 * It adapts PR #52's `raviIdle.mjs` world-space solver and 4 s breathing loop, but:
 *  1. joints are addressed by LIVE SKIN INDEX and animation target identity, never a document-wide name map;
 *  2. every input precondition is asserted fail-fast (pinned base sha256/bytes, canonical 24-joint skin, one
 *     mesh/primitive, clips exactly Idle/Walk/Run, the static one-key Idle schema, KHR_materials_ior);
 *  3. each original Idle T/R/S key is applied first; T/S, and the rotation of every joint the recipe does not
 *     author, are then held BIT-EXACT; only authored rotations are normalized;
 *  4. arm abduction is a pinned per-body calibration (wave4.config.mjs), and wrist roll is solved against a
 *     PCA hand plane from the hand's own skinned vertices. That plane is UNSIGNED: it does not decide palm
 *     versus back of hand facing the thigh; that stays a visual review judgement.
 * Only Idle sampler accessor references change. Geometry, skin, rest nodes, materials, images and Walk/Run
 * are untouched; `src/game/assets/namedIdleContract.test.ts` pins that against the pre-change bytes.
 * PR #52's Ravi module is intentionally NOT changed here; it can later delegate to this helper.
 */
globalThis.self ??= globalThis
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { io } from './lib.mjs'

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
export { THREE, io }
export const sha256 = (b) => createHash('sha256').update(b).digest('hex')
export const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)

export const IDLE_DURATION = 4.0
export const FPS_KEYS = 8
export const KEYS = IDLE_DURATION * FPS_KEYS + 1
export const ORIGINAL_IDLE_TIME = Math.fround(0.3)
export const JOINTS = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  'Spine02', 'Spine01', 'Spine', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm',
  'RightHand', 'neck', 'Head', 'head_end', 'headfront']
export const LOWER_BODY = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']
/** Vertices dominated by these joints are the "body" the forearms and hands must clear. */
export const BODY_JOINTS = ['Hips', 'Spine02', 'Spine01', 'Spine', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']

/** PR #52's breathing loop, unchanged (degrees about world axes). */
export const BREATH = {
  Spine02: { axis: [1, 0, 0], amp: -0.9 },
  Spine01: { axis: [1, 0, 0], amp: -1.7 },
  Spine: { axis: [1, 0, 0], amp: -1.0 },
  neck: { axis: [1, 0, 0], amp: 1.6 },
  Head: { axis: [1, 0, 0], amp: 1.3 },
  LeftShoulder: { axis: [0, 0, 1], amp: -0.9 },
  RightShoulder: { axis: [0, 0, 1], amp: 0.9 },
  LeftArm: { axis: [0, 0, 1], amp: -1.8, phase: -0.18, amp2: -0.35 },
  RightArm: { axis: [0, 0, 1], amp: 1.8, phase: -0.18, amp2: 0.35 },
  LeftForeArm: { axis: [0, 0, 1], amp: -1.2, phase: -0.3, amp2: -0.25 },
  RightForeArm: { axis: [0, 0, 1], amp: 1.2, phase: -0.3, amp2: 0.25 },
}
/** PR #52's forward/back components expressed as angles (upper [±0.17,-1,-0.03], fore [±0.06,-1,0.14]). */
export const RAVI_FORWARD = { upperForwardDeg: -1.7184, foreForwardDeg: 7.9696, lateralGapDeg: 6.2209 }

const V3 = THREE.Vector3
const deg2rad = (d) => (d * Math.PI) / 180
const rad2deg = (r) => (r * 180) / Math.PI
export const round = (v, n = 4) => +(+v).toFixed(n)

// ---- input preconditions (fail fast, per body) ------------------------------------------------------------
export function assertInput(doc, bytes, body) {
  const fail = (m) => { throw new Error(`${body.id}: ${m}`) }
  if (sha256(bytes) !== body.sha256) fail(`input sha256 ${sha256(bytes)} != pinned ${body.sha256}`)
  if (bytes.length !== body.bytes) fail(`input bytes ${bytes.length} != pinned ${body.bytes}`)
  const root = doc.getRoot()
  const skins = root.listSkins()
  if (skins.length !== 1) fail(`expected 1 skin, got ${skins.length}`)
  const joints = skins[0].listJoints()
  if (joints.map((j) => j.getName()).join('|') !== JOINTS.join('|')) fail('skin joints differ from the canonical 24 (names/order)')
  if (new Set(joints).size !== JOINTS.length) fail('duplicate joint nodes in the skin')
  const meshes = root.listMeshes()
  if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) fail('expected exactly one mesh with one primitive')
  if (root.listAnimations().map((a) => a.getName()).sort().join(',') !== 'Idle,Run,Walk') fail('clips are not exactly Idle/Walk/Run')
  if (!root.listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_ior')) fail('KHR_materials_ior is not declared')
  const idle = root.listAnimations().find((a) => a.getName() === 'Idle')
  const channels = idle.listChannels()
  if (channels.length !== 72 || idle.listSamplers().length !== 72 || new Set(channels.map((c) => c.getSampler())).size !== 72) fail('Idle is not 72 channels on 72 distinct samplers')
  const other = new Set(root.listAnimations().filter((a) => a !== idle).flatMap((a) => a.listSamplers()).flatMap((s) => [s.getInput(), s.getOutput()]))
  const seen = new Set()
  const keys = new Map()
  for (const c of channels) {
    const ji = joints.indexOf(c.getTargetNode())
    if (ji < 0) fail(`Idle channel targets a non-skin node ${c.getTargetNode()?.getName()}`)
    const path = c.getTargetPath()
    if (!['translation', 'rotation', 'scale'].includes(path)) fail(`unexpected Idle path ${path}`)
    const k = `${ji}.${path}`
    if (seen.has(k)) fail(`duplicate Idle channel ${JOINTS[ji]}.${path}`)
    seen.add(k)
    const s = c.getSampler()
    if (s.getInterpolation() !== 'LINEAR') fail(`${JOINTS[ji]}.${path} interpolation ${s.getInterpolation()}`)
    const input = s.getInput().getArray()
    if (input.length !== 1 || input[0] !== ORIGINAL_IDLE_TIME) fail(`${JOINTS[ji]}.${path} input ${Array.from(input)}`)
    const output = s.getOutput()
    if (output.getCount() !== 1 || output.getElementSize() !== (path === 'rotation' ? 4 : 3)) fail(`${JOINTS[ji]}.${path} output shape`)
    if (other.has(s.getInput()) || other.has(output)) fail(`${JOINTS[ji]}.${path} shares an accessor with Walk/Run`)
    if (!keys.has(ji)) keys.set(ji, {})
    keys.get(ji)[path] = Array.from(output.getArray())
  }
  if (seen.size !== 72) fail('not every joint has exactly one T, R and S Idle channel')
  return { skin: skins[0], joints, idle, keys }
}

// ---- the live rig ----------------------------------------------------------------------------------------
export async function loadRig(bytes, id) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej))
  const skinned = []
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o) })
  if (skinned.length !== 1) throw new Error(`${id}: expected 1 skinned mesh, got ${skinned.length}`)
  const mesh = skinned[0]
  const bones = mesh.skeleton.bones
  if (bones.map((b) => b.name).join('|') !== JOINTS.join('|') || new Set(bones).size !== JOINTS.length) throw new Error(`${id}: live skeleton differs from the canonical 24`)
  const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]))
  return { gltf, mesh, bones, root: gltf.scene, J }
}

/** Pose every skin joint from per-joint {translation, rotation, scale} arrays (by skin index). */
export function applyKeys(rig, keyOf) {
  rig.bones.forEach((b, i) => {
    const k = keyOf(i)
    b.position.fromArray(k.translation)
    b.quaternion.fromArray(k.rotation)
    b.scale.fromArray(k.scale)
  })
  rig.root.updateMatrixWorld(true)
}

export const worldPos = (rig, name) => rig.bones[rig.J[name]].getWorldPosition(new V3())

export function frameCheck(rig) {
  const wp = (n) => worldPos(rig, n)
  return {
    leftIsPlusX: wp('LeftArm').x > wp('RightArm').x,
    toesForwardPlusZ: wp('LeftToeBase').z > wp('LeftFoot').z && wp('RightToeBase').z > wp('RightFoot').z,
    headAboveHips: wp('Head').y > wp('Hips').y,
  }
}

// ---- geometry-derived hand plane ------------------------------------------------------------------------
const comp = (a, i, k) => (k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i))

/** Symmetric 3x3 eigen decomposition (cyclic Jacobi), eigenpairs sorted by descending value. Deterministic. */
export function eigenSym3(m) {
  const A = m.map((r) => r.slice())
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 64; sweep++) {
    if (A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2 < 1e-30) break
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-300) continue
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq }
      for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq }
    }
  }
  const vals = [A[0][0], A[1][1], A[2][2]]
  return [0, 1, 2].sort((i, j) => vals[j] - vals[i]).map((i) => ({ value: vals[i], vector: [V[0][i], V[1][i], V[2][i]] }))
}

/**
 * The hand's plane from its own skinned vertices, in the hand bone's local bind frame: PCA of every vertex with
 * at least `minWeight` on that joint. The least-variance axis is the plane normal (sign arbitrary). A hand whose
 * two smaller variances are too similar has no identifiable plane, and no wrist roll is then authored.
 */
export function handPlane(rig, jointName, minWeight = 0.6, maxFlatness = 0.35) {
  const { mesh } = rig
  const j = rig.J[jointName]
  const g = mesh.geometry
  const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight
  const toBone = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[j], mesh.bindMatrix)
  const pts = []
  const v = new V3()
  for (let i = 0; i < pos.count; i++) {
    let w = 0
    for (let k = 0; k < 4; k++) if (comp(si, i, k) === j) w += comp(sw, i, k)
    if (w < minWeight) continue
    v.fromBufferAttribute(pos, i).applyMatrix4(toBone)
    pts.push(v.x, v.y, v.z)
  }
  const n = pts.length / 3
  const mean = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) mean[k] += pts[i * 3 + k] / n
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += ((pts[i * 3 + a] - mean[a]) * (pts[i * 3 + b] - mean[b])) / Math.max(1, n)
  const eig = eigenSym3(cov)
  const flatness = eig[1].value > 0 ? eig[2].value / eig[1].value : 1
  return { joint: jointName, vertices: n, minWeight, eigenvalues: eig.map((e) => e.value), normalLocal: eig[2].vector, lengthAxisLocal: eig[0].vector,
    flatness, maxFlatness, identified: n >= 50 && flatness <= maxFlatness }
}

/**
 * Angle (deg) between the hand plane's normal LINE and world X: 0 means the hand plane is edge-on to the front view.
 * UNSIGNED — this cannot tell palm from back of hand facing the thigh (see HAND_PLANE_SEMANTICS).
 */
export function handPlaneErrorDeg(rig, side, plane) {
  const hand = rig.bones[rig.J[`${side}Hand`]]
  const n = new V3(...plane.normalLocal).transformDirection(hand.matrixWorld)
  return rad2deg(Math.acos(Math.min(1, Math.abs(n.x))))
}
/** The same measure on the hand bone's local -Z (PR #52's assumption), for comparison only. */
export function handMinusZErrorDeg(rig, side) {
  const hand = rig.bones[rig.J[`${side}Hand`]]
  const n = new V3(0, 0, -1).transformDirection(hand.matrixWorld)
  return rad2deg(Math.acos(Math.min(1, Math.abs(n.x))))
}

// ---- PR #52's world-space solver, by skin index ------------------------------------------------------------
export function applyWorldRotation(bone, worldQuat) {
  const parentWorld = new THREE.Quaternion()
  if (bone.parent) bone.parent.getWorldQuaternion(parentWorld)
  const delta = parentWorld.clone().invert().multiply(worldQuat).multiply(parentWorld)
  bone.quaternion.premultiply(delta)
}
const rotationBetween = (from, to) => new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize())
const axisRot = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), deg2rad(deg))
/** A segment direction from angles: `sideSign` +1 is the body's left (+X), forward is +Z, down is -Y. */
export const segmentDirection = (sideSign, lateralDeg, forwardDeg) => new V3(sideSign * Math.tan(deg2rad(lateralDeg)), -1, Math.tan(deg2rad(forwardDeg))).normalize()

export function armParams(upperLateralDeg) {
  return { upperLateralDeg, upperForwardDeg: RAVI_FORWARD.upperForwardDeg,
    foreLateralDeg: Math.max(1, upperLateralDeg - RAVI_FORWARD.lateralGapDeg), foreForwardDeg: RAVI_FORWARD.foreForwardDeg }
}

/** Re-aim both arms (never stretch), then solve wrist roll about the forearm against the geometry hand plane. */
export function solveArms(rig, params, planes) {
  const { bones, J, root } = rig
  const wp = (n) => worldPos(rig, n)
  const report = {}
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const arm = bones[J[`${side}Arm`]], fore = bones[J[`${side}ForeArm`]], hand = bones[J[`${side}Hand`]]
    const S = wp(`${side}Arm`), E0 = wp(`${side}ForeArm`), W0 = wp(`${side}Hand`)
    const upperLen = E0.distanceTo(S), foreLen = W0.distanceTo(E0)
    const before = { upperDir: E0.clone().sub(S).normalize(), foreDir: W0.clone().sub(E0).normalize(), wristY: W0.y,
      planeErrDeg: handPlaneErrorDeg(rig, side, planes[side]), minusZErrDeg: handMinusZErrorDeg(rig, side) }

    applyWorldRotation(arm, rotationBetween(E0.clone().sub(S).normalize(), segmentDirection(sign, params.upperLateralDeg, params.upperForwardDeg)))
    root.updateMatrixWorld(true)
    const E1 = wp(`${side}ForeArm`)
    applyWorldRotation(fore, rotationBetween(wp(`${side}Hand`).sub(E1).normalize(), segmentDirection(sign, params.foreLateralDeg, params.foreForwardDeg)))
    root.updateMatrixWorld(true)

    let roll = { deg: 0, solved: false, reason: 'hand plane not identified — no wrist roll authored' }
    if (planes[side].identified) {
      const foreAxis = wp(`${side}Hand`).sub(wp(`${side}ForeArm`)).normalize()
      const q0 = hand.quaternion.clone()
      let best = { deg: 0, err: Infinity }
      for (let m = 0; m <= 180; m++) {
        for (const d of m === 0 ? [0] : [m, -m]) {
          if (d === -180) continue
          hand.quaternion.copy(q0)
          applyWorldRotation(hand, axisRot(foreAxis, d))
          root.updateMatrixWorld(true)
          const e = handPlaneErrorDeg(rig, side, planes[side])
          if (e < best.err - 1e-9) best = { deg: d, err: e }
        }
      }
      hand.quaternion.copy(q0)
      applyWorldRotation(hand, axisRot(foreAxis, best.deg))
      root.updateMatrixWorld(true)
      roll = { deg: best.deg, solved: true }
    }
    const S2 = wp(`${side}Arm`), E2 = wp(`${side}ForeArm`), W2 = wp(`${side}Hand`)
    report[side] = {
      params, wristRollDeg: roll.deg, wristRollSolved: roll.solved, ...(roll.solved ? {} : { wristRollNote: roll.reason }),
      upperDirBefore: before.upperDir.toArray().map((x) => round(x)), foreDirBefore: before.foreDir.toArray().map((x) => round(x)),
      upperDirAfter: E2.clone().sub(S2).normalize().toArray().map((x) => round(x)), foreDirAfter: W2.clone().sub(E2).normalize().toArray().map((x) => round(x)),
      elbowBendBeforeDeg: round(rad2deg(before.upperDir.angleTo(before.foreDir)), 2),
      elbowBendAfterDeg: round(rad2deg(E2.clone().sub(S2).normalize().angleTo(W2.clone().sub(E2).normalize())), 2),
      wristYBefore: round(before.wristY), wristYAfter: round(W2.y),
      handPlaneUnsignedErrDegBefore: round(before.planeErrDeg, 2), handPlaneUnsignedErrDegAfter: round(handPlaneErrorDeg(rig, side, planes[side]), 2), handPlaneSemantics: HAND_PLANE_SEMANTICS,
      handMinusZErrDegBefore: round(before.minusZErrDeg, 2), handMinusZErrDegAfter: round(handMinusZErrorDeg(rig, side), 2),
      segmentLenDriftUpper: +(E2.distanceTo(S2) - upperLen).toFixed(7), segmentLenDriftFore: +(W2.distanceTo(E2) - foreLen).toFixed(7),
    }
  }
  return report
}

export const HAND_PLANE_SEMANTICS = 'unsigned hand-plane orientation only: the PCA normal has no sign, so palm-versus-back facing the thigh is NOT determined; it must be judged from the finite visual evidence'

/** Joints whose rotation this recipe authors. Every other joint keeps its ORIGINAL Idle rotation key bit-exact. */
export const AUTHORED_JOINTS = [...Object.keys(BREATH), 'LeftHand', 'RightHand']

export const snapshot = (rig) => rig.bones.map((b) => b.quaternion.clone())

/** The resting (corrected) pose plus PR #52's breathing at time t. Positions/scales are untouched. */
export function poseBreathing(rig, resting, t) {
  rig.bones.forEach((b, i) => b.quaternion.copy(resting[i]))
  rig.root.updateMatrixWorld(true)
  for (const [name, spec] of Object.entries(BREATH)) {
    const b = rig.bones[rig.J[name]]
    const phase = (spec.phase ?? 0) * Math.PI * 2
    const s = Math.sin((t / IDLE_DURATION) * Math.PI * 2 + phase)
    const s2 = Math.sin((t / IDLE_DURATION) * Math.PI * 4 + phase)
    applyWorldRotation(b, axisRot(new V3(...spec.axis), spec.amp * s + (spec.amp2 ?? 0) * s2))
    rig.root.updateMatrixWorld(true)
  }
}

export const keyTimes = () => Array.from({ length: KEYS }, (_, i) => +(i / FPS_KEYS).toFixed(6))

/**
 * Rotation keys per skin joint over the whole loop. Authored joints are normalized; every other joint must still hold
 * its original key (asserted to 1e-9 in the live rig) and is written with the ORIGINAL Float32 values, bit-exact,
 * with no normalization. Asserts the loop closes.
 */
export function breathingKeys(rig, resting, input) {
  const authored = new Set(AUTHORED_JOINTS.map((n) => rig.J[n]))
  const keys = rig.bones.map(() => [])
  let maxNormDeviation = 0
  for (const t of keyTimes()) {
    poseBreathing(rig, resting, t)
    rig.bones.forEach((b, i) => {
      if (!authored.has(i)) {
        const orig = input.keys.get(i).rotation
        const d = Math.max(...b.quaternion.toArray().map((v, k) => Math.abs(v - orig[k])))
        if (d > 1e-9) throw new Error(`untouched joint ${JOINTS[i]} moved by ${d}`)
        keys[i].push(...orig)
        return
      }
      maxNormDeviation = Math.max(maxNormDeviation, Math.abs(b.quaternion.length() - 1))
      const q = b.quaternion.clone().normalize()
      keys[i].push(q.x, q.y, q.z, q.w)
    })
  }
  let maxLoopDelta = 0
  keys.forEach((vals, i) => {
    const d = Math.max(...vals.slice(0, 4).map((v, k) => Math.abs(v - vals[vals.length - 4 + k])))
    if (d > 1e-6) throw new Error(`loop discontinuity on ${JOINTS[i]}: ${d}`)
    maxLoopDelta = Math.max(maxLoopDelta, d)
  })
  return { keys, maxLoopDelta, maxNormDeviationBeforeNormalize: maxNormDeviation, untouchedJointsBitExact: JOINTS.filter((_, i) => !authored.has(i)) }
}

// ---- bake: replace ONLY the Idle samplers' accessor references --------------------------------------------------
export function bakeIdle(doc, input, rotationKeys) {
  const root = doc.getRoot()
  const buffers = root.listBuffers()
  if (buffers.length !== 1) throw new Error(`expected 1 buffer, got ${buffers.length}`)
  const buffer = buffers[0]
  const timeAcc = doc.createAccessor('idle_time').setType('SCALAR').setArray(new Float32Array(keyTimes())).setBuffer(buffer)
  const holdAcc = doc.createAccessor('idle_time_hold').setType('SCALAR').setArray(new Float32Array([0, IDLE_DURATION])).setBuffer(buffer)
  const old = new Set()
  for (const ch of input.idle.listChannels()) {
    const ji = input.joints.indexOf(ch.getTargetNode())
    const path = ch.getTargetPath()
    const s = ch.getSampler()
    old.add(s.getInput()); old.add(s.getOutput())
    if (path === 'rotation') {
      s.setInput(timeAcc)
      s.setOutput(doc.createAccessor(`idle_rotation_${ji}_${JOINTS[ji]}`).setType('VEC4').setArray(new Float32Array(rotationKeys[ji])).setBuffer(buffer))
    } else {
      const k = input.keys.get(ji)[path]
      s.setInput(holdAcc)
      s.setOutput(doc.createAccessor(`idle_${path}_${ji}_${JOINTS[ji]}`).setType('VEC3').setArray(new Float32Array([...k, ...k])).setBuffer(buffer))
    }
    s.setInterpolation('LINEAR')
  }
  let disposed = 0
  for (const a of old) {
    if (a.listParents().every((p) => p.propertyType === 'Root')) { a.dispose(); disposed++ }
  }
  return { disposedIdleAccessors: disposed, keyCount: KEYS, durationSeconds: IDLE_DURATION }
}

// ---- in-tree entry points ----------------------------------------------------------------------------------

/** Provenance wording for the derivation step. */
export const NAMED_IDLE_OPERATIONS = [
  'assert the assembled base sha256 + bytes, the canonical 24-joint skin, one mesh/primitive, clips Idle/Walk/Run and the static one-key Idle schema',
  'apply each original Idle T/R/S key; re-aim both arms to the pinned per-body abduction (world-space, never stretched)',
  'solve wrist roll against the unsigned PCA hand plane (palm-vs-back is not decided here)',
  'author a 4 s / 33-key LINEAR breathing loop on the 11 breathing joints; hands hold their solved roll',
  'hold T/S and every non-authored joint rotation bit-exact; rewrite ONLY Idle sampler accessor references',
  'assert the derived output sha256 equals the reviewed candidate pinned in wave4.config.mjs',
]

/**
 * Derive the reviewed Idle for one assembled named body. `spec` = { id, baseSha256, baseBytes, upperLateralDeg }.
 * Reads `inPath`, writes `outPath` (may be the same path) and returns the measured report.
 */
export async function deriveNamedIdle(inPath, outPath, spec) {
  const bytes = readFileSync(inPath)
  const doc = await io.readBinary(u8(bytes))
  const input = assertInput(doc, bytes, { id: spec.id, sha256: spec.baseSha256, bytes: spec.baseBytes })
  const rig = await loadRig(bytes, spec.id)
  applyKeys(rig, (i) => input.keys.get(i))
  const frame = frameCheck(rig)
  if (!Object.values(frame).every(Boolean)) throw new Error(`${spec.id}: body frame check failed ${JSON.stringify(frame)}`)
  const planes = { Left: handPlane(rig, 'LeftHand'), Right: handPlane(rig, 'RightHand') }
  const params = armParams(spec.upperLateralDeg)
  const arms = solveArms(rig, params, planes)
  const resting = snapshot(rig)
  const loop = breathingKeys(rig, resting, input)
  const bake = bakeIdle(doc, input, loop.keys)
  await io.write(outPath, doc)
  const summarizePlane = (p) => ({ vertices: p.vertices, flatness: round(p.flatness, 6), identified: p.identified })
  return {
    params,
    handPlanes: { Left: summarizePlane(planes.Left), Right: summarizePlane(planes.Right), semantics: HAND_PLANE_SEMANTICS },
    arms,
    loop: { maxLoopEndpointDelta: loop.maxLoopDelta, maxNormDeviationBeforeNormalize: loop.maxNormDeviationBeforeNormalize, untouchedJointsBitExact: loop.untouchedJointsBitExact },
    bake,
  }
}

/**
 * Invariance digests of a named-body document, used to pin the PRE-CHANGE bytes in the contract. Nodes, skin
 * joints and channel targets are recorded by index, so a renamed or re-pointed target is a digest change.
 * `idleHeld` covers every Idle T/S channel and the rotation of every joint this recipe does not author, using
 * each channel's FIRST key — identical before and after the derivation when nothing held has changed.
 */
export function idleInvarianceDigests(doc) {
  const root = doc.getRoot()
  const buf = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)
  const nodes = root.listNodes()
  const hash = () => createHash('sha256')
  const geometry = hash()
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    for (const n of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
      const a = p.getAttribute(n)
      if (a) { geometry.update(`${n}:${a.getComponentType()}:${a.getNormalized()}`); geometry.update(buf(a.getArray())) }
    }
    const i = p.getIndices()
    if (i) { geometry.update('IDX'); geometry.update(buf(i.getArray())) }
  }
  const nodeHash = hash()
  for (const n of nodes) nodeHash.update(JSON.stringify([n.getName(), n.getTranslation(), n.getRotation(), n.getScale(),
    n.listChildren().map((c) => nodes.indexOf(c)), root.listMeshes().indexOf(n.getMesh()), root.listSkins().indexOf(n.getSkin())]))
  const skin = hash()
  for (const sk of root.listSkins()) {
    skin.update(JSON.stringify(sk.listJoints().map((j) => [nodes.indexOf(j), j.getName()])))
    skin.update(`skeleton:${nodes.indexOf(sk.getSkeleton())}`)
    const ibm = sk.getInverseBindMatrices()
    if (ibm) skin.update(buf(ibm.getArray()))
  }
  const textures = root.listTextures()
  const materials = hash()
  for (const m of root.listMaterials()) {
    materials.update(JSON.stringify({
      name: m.getName(), base: m.getBaseColorFactor(), metallic: m.getMetallicFactor(), rough: m.getRoughnessFactor(),
      emissive: m.getEmissiveFactor(), alpha: m.getAlphaMode(), cutoff: m.getAlphaCutoff(), doubleSided: m.getDoubleSided(),
      baseColorTexture: textures.indexOf(m.getBaseColorTexture()), normalTexture: textures.indexOf(m.getNormalTexture()),
      metallicRoughnessTexture: textures.indexOf(m.getMetallicRoughnessTexture()), emissiveTexture: textures.indexOf(m.getEmissiveTexture()),
      occlusionTexture: textures.indexOf(m.getOcclusionTexture()),
      exts: m.listExtensions().map((e) => [e.extensionName, JSON.stringify(e)]).sort(),
    }))
  }
  // Decoded material state the `materials` digest above does not see: extension VALUES (not their JSON shape) and
  // every texture slot's TextureInfo/sampler (texCoord, wrap, filters). An unknown material or TextureInfo
  // extension fails loudly rather than silently falling outside the digest.
  const materialSampling = hash()
  const DECODED_MATERIAL_EXTENSIONS = { KHR_materials_ior: (e) => ({ ior: e.getIOR() }) }
  const textureInfo = (tex, info) => (tex === null ? null : {
    texture: textures.indexOf(tex), texCoord: info.getTexCoord(), wrapS: info.getWrapS(), wrapT: info.getWrapT(),
    minFilter: info.getMinFilter(), magFilter: info.getMagFilter(),
    extensions: info.listExtensions().map((e) => { throw new Error(`undecoded TextureInfo extension ${e.extensionName}`) }),
  })
  for (const m of root.listMaterials()) {
    materialSampling.update(JSON.stringify({
      name: m.getName(),
      extensions: m.listExtensions().map((e) => {
        const decode = DECODED_MATERIAL_EXTENSIONS[e.extensionName]
        if (!decode) throw new Error(`undecoded material extension ${e.extensionName}`)
        return [e.extensionName, decode(e)]
      }).sort((a, b) => a[0].localeCompare(b[0])),
      baseColor: textureInfo(m.getBaseColorTexture(), m.getBaseColorTextureInfo()),
      metallicRoughness: textureInfo(m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()),
      normal: textureInfo(m.getNormalTexture(), m.getNormalTextureInfo()), normalScale: m.getNormalScale(),
      occlusion: textureInfo(m.getOcclusionTexture(), m.getOcclusionTextureInfo()), occlusionStrength: m.getOcclusionStrength(),
      emissive: textureInfo(m.getEmissiveTexture(), m.getEmissiveTextureInfo()),
    }))
  }
  const images = hash()
  for (const t of textures) { images.update(`${t.getName()}:${t.getMimeType()}`); images.update(buf(t.getImage())) }
  const clip = (name) => {
    const a = root.listAnimations().find((x) => x.getName() === name)
    const h = hash()
    for (const c of a.listChannels()) {
      const sm = c.getSampler()
      h.update(`${nodes.indexOf(c.getTargetNode())}.${c.getTargetPath()}:${sm.getInterpolation()}`)
      h.update(buf(sm.getInput().getArray()))
      h.update(buf(sm.getOutput().getArray()))
    }
    return h.digest('hex')
  }
  const joints = root.listSkins()[0].listJoints()
  const idle = root.listAnimations().find((x) => x.getName() === 'Idle')
  const held = idle.listChannels()
    .map((c) => ({ ji: joints.indexOf(c.getTargetNode()), path: c.getTargetPath(), c }))
    .filter(({ ji, path }) => path !== 'rotation' || !AUTHORED_JOINTS.includes(JOINTS[ji]))
    .sort((a, b) => a.ji - b.ji || a.path.localeCompare(b.path))
  const idleHeld = hash()
  for (const { ji, path, c } of held) {
    const out = c.getSampler().getOutput()
    idleHeld.update(`${ji}.${path}`)
    idleHeld.update(buf(out.getArray().slice(0, out.getElementSize())))
  }
  return {
    geometry: geometry.digest('hex'), nodes: nodeHash.digest('hex'), skin: skin.digest('hex'), materials: materials.digest('hex'),
    materialSampling: materialSampling.digest('hex'), images: images.digest('hex'), walk: clip('Walk'), run: clip('Run'), idle: clip('Idle'), idleHeld: idleHeld.digest('hex'),
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName).sort(), nodeCount: nodes.length,
    heldIdleChannels: held.length,
  }
}
