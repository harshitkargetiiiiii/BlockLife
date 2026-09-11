// @vitest-environment node
// (GLTFLoader.parse and the gltf-transform NodeIO read GLB binary chunks; jsdom mis-handles that.)
// GLTFLoader reaches for `self`; the same one-line polyfill the intake scripts use.
;(globalThis as { self?: unknown }).self ??= globalThis
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { RIG_FIT } from '../../../scripts/asset-intake/wave4.config.mjs'
import { IDLE_DURATION } from '../../../scripts/asset-intake/raviIdle.mjs'
import provenance from '../../../docs/asset-provenance/wave0-provenance.json'

/**
 * Registered exactly like the intake's own `io` (scripts/asset-intake/lib.mjs). A bare `NodeIO()`
 * silently drops declared extensions, which would make the material check below pass vacuously —
 * that exact loss (KHR_materials_ior) was a real defect in the first candidate.
 */
const glbIo = new NodeIO().registerExtensions(ALL_EXTENSIONS)

/**
 * Issue #27 — Ravi's derived Idle, asserted against the REAL committed bytes.
 *
 * `scripts/asset-intake/raviIdle.mjs` rewrites ONE clip inside an otherwise untouched Wave-0
 * output. This file is the standing proof that it stayed inside that boundary, and it is the
 * regression gate if the recipe is ever edited.
 *
 * The PRESERVED_* digests below were computed from the bytes that shipped BEFORE this change
 * (`git show d81d73d:public/assets/models/characters/blocklife_ravi_01.glb`). They are therefore
 * not self-referential: the derived file matching them is evidence that geometry, rest transforms,
 * skinning, materials, textures and the Walk/Run clips survived the derivation unchanged. Only the
 * Idle digest is expected to differ, and that difference is characterised below rather than
 * rubber-stamped.
 */

const GLB = 'public/assets/models/characters/blocklife_ravi_01.glb'

/** Digests of the pre-change bytes — every one of these must still hold. */
const PRESERVED = {
  geometry: '8ab7e83e8d7da8b2e00be1ec5d847734646a40b7496e622584e698c337b5575a',
  nodes: 'f1f87f1815bd2fd5d9bdf21abdca5b1f1f503556f0974e2f59902218bd6f8ce5',
  skin: '4bf6f6057725ccc7cb7a2dc81712f152cf0bc25129c155571ed49e8b78b3e57b',
  materials: '5acc2436f427cc5f38c99582857e18c7df9f90796447bfa3256a7407bae03301',
  images: '4b8578d2653e5b6c9176ff8128bdaa59d6e14409d4ea5dd36828dbc014f6f63b',
  walk: '367a1eeffa2ed428a38fc7ddc091f5752e68728582a4038d0874b30c6656e2f2',
  run: 'b77e997677a8a36652a46f1f2aea7afcfab4c8ee1bce9a8027da5fca06cb3675',
}
/** The Idle digest BEFORE the derivation — the one thing that must have changed. */
const OLD_IDLE_DIGEST = '49f4da6282da4b0c286fd8bc41b3f83c6b82e17afe633539ba249fc948687fb8'

/** The independently reviewed candidate this pipeline must reproduce exactly. */
const REVIEWED_SHA = '7deab5d70a127e42a2433648906e9cdd6cfdf7415723e5f6d1e13a87e06c56a7'

/** Bones the breathing loop is allowed to move. Everything else must be a constant track. */
const BREATHING_BONES = [
  'Spine02', 'Spine01', 'Spine', 'neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'RightShoulder', 'RightArm', 'RightForeArm',
]
/** Nothing below the hips may move, which is what actually keeps the feet planted. */
const LOWER_BODY = [
  'Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
]

const buf = (a: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength)

async function digests() {
  const doc = await glbIo.read(GLB)
  const root = doc.getRoot()

  const geometry = createHash('sha256')
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      for (const n of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
        const a = p.getAttribute(n)
        if (a) { geometry.update(n); geometry.update(buf(a.getArray()!)) }
      }
      const i = p.getIndices()
      if (i) { geometry.update('IDX'); geometry.update(buf(i.getArray()!)) }
    }
  }

  const nodes = createHash('sha256')
  for (const nd of root.listNodes()) {
    nodes.update(JSON.stringify([nd.getName(), nd.getTranslation(), nd.getRotation(), nd.getScale()]))
  }

  const skin = createHash('sha256')
  for (const sk of root.listSkins()) {
    skin.update(sk.listJoints().map((j) => j.getName()).join('|'))
    const ibm = sk.getInverseBindMatrices()
    if (ibm) skin.update(buf(ibm.getArray()!))
  }

  const materials = createHash('sha256')
  for (const m of root.listMaterials()) {
    materials.update(JSON.stringify({
      name: m.getName(), base: m.getBaseColorFactor(), metallic: m.getMetallicFactor(),
      rough: m.getRoughnessFactor(), emissive: m.getEmissiveFactor(), alpha: m.getAlphaMode(),
      exts: m.listExtensions().map((e) => [e.extensionName, JSON.stringify(e)]).sort(),
    }))
  }

  const images = createHash('sha256')
  for (const t of root.listTextures()) images.update(buf(t.getImage()!))

  const clips: Record<string, {
    channels: number; maxKeys: number; duration: number; digest: string
    interpolations: Set<string>; moving: string[]; constant: string[]
  }> = {}
  for (const a of root.listAnimations()) {
    const h = createHash('sha256')
    const interpolations = new Set<string>()
    const moving: string[] = []
    const constant: string[] = []
    let maxKeys = 0
    for (const c of a.listChannels()) {
      const sm = c.getSampler()!
      const key = `${c.getTargetNode()!.getName()}.${c.getTargetPath()}`
      h.update(`${key}:${sm.getInterpolation()}`)
      h.update(buf(sm.getInput()!.getArray()!))
      h.update(buf(sm.getOutput()!.getArray()!))
      interpolations.add(sm.getInterpolation())
      maxKeys = Math.max(maxKeys, sm.getInput()!.getCount())
      const out = sm.getOutput()!.getArray()!
      const n = sm.getOutput()!.getElementSize()
      let varies = false
      for (let i = n; i < out.length && !varies; i++) if (Math.abs(out[i] - out[i % n]) > 1e-7) varies = true
      ;(varies ? moving : constant).push(key)
    }
    const duration = Math.max(...a.listSamplers().map((sm) => sm.getInput()!.getMax([])[0]))
    clips[a.getName()] = {
      channels: a.listChannels().length, maxKeys, duration: +duration.toFixed(6),
      digest: h.digest('hex'), interpolations, moving, constant,
    }
  }

  return {
    geometry: geometry.digest('hex'), nodes: nodes.digest('hex'), skin: skin.digest('hex'),
    materials: materials.digest('hex'), images: images.digest('hex'), clips,
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName).sort(),
    nodeCount: root.listNodes().length, meshCount: root.listMeshes().length,
  }
}

/** Pose the loaded rig at Idle t=0 and return world positions by bone name. */
async function idleT0World() {
  const b = readFileSync(GLB)
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] } = await new Promise((res, rej) =>
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res as never, rej))
  let mesh: THREE.SkinnedMesh | null = null
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh })
  const bones = new Map((mesh as unknown as THREE.SkinnedMesh).skeleton.bones.map((x) => [x.name, x]))
  const clip = gltf.animations.find((a) => a.name === 'Idle')!
  for (const t of clip.tracks) {
    const cut = t.name.lastIndexOf('.')
    const bone = bones.get(t.name.slice(0, cut))
    if (!bone) continue
    const path = t.name.slice(cut + 1)
    if (path === 'quaternion') bone.quaternion.fromArray(Array.from(t.values.slice(0, 4)))
    else if (path === 'position') bone.position.fromArray(Array.from(t.values.slice(0, 3)))
    else if (path === 'scale') bone.scale.fromArray(Array.from(t.values.slice(0, 3)))
  }
  gltf.scene.updateMatrixWorld(true)
  const world = new Map<string, THREE.Vector3>()
  for (const [name, bone] of bones) world.set(name, bone.getWorldPosition(new THREE.Vector3()))
  return world
}

describe('issue #27 — Ravi derived Idle contract (real committed bytes)', () => {
  it('the committed file IS the independently reviewed candidate, pinned in three places', () => {
    const sha = createHash('sha256').update(readFileSync(GLB)).digest('hex')
    expect(sha, 'committed bytes').toBe(REVIEWED_SHA)
    expect(RIG_FIT.blocklife_ravi_01.sha256, 'wave4 RIG_FIT pin').toBe(REVIEWED_SHA)
    const record = provenance.assets.find((a) => a.id === 'blocklife_ravi_01')!
    expect(record.outputSha256, 'wave0 provenance output').toBe(REVIEWED_SHA)
    // The recipe is a DERIVATION of the pristine merge, so the base it ran on is pinned too.
    expect(record.derived, 'provenance records the derivation').toBeTruthy()
    expect(record.derived!.outputSha256).toBe(REVIEWED_SHA)
    expect(record.derived!.baseSha256, 'the unmodified Wave-0 merge output').toBe(
      'f9ac3d5b8606c34007de89bfed05a764cfd2a4b843bb000e44fd0713488d6fe4')
    // ...and the sprint sources are still the provenance root, not a re-labelled external GLB.
    expect(record.sources.map((s) => s.role).sort()).toEqual(['Idle', 'Run', 'Walk'])
  })

  it('geometry, rest transforms, skinning, materials and textures are the pre-change bytes', async () => {
    const d = await digests()
    expect(d.geometry, 'POSITION/NORMAL/TEXCOORD_0/JOINTS_0/WEIGHTS_0 + indices').toBe(PRESERVED.geometry)
    expect(d.nodes, 'all 74 node rest transforms').toBe(PRESERVED.nodes)
    expect(d.skin, 'joint order + inverse bind matrices').toBe(PRESERVED.skin)
    expect(d.materials, 'material factors and extension values').toBe(PRESERVED.materials)
    expect(d.images, 'embedded texture bytes').toBe(PRESERVED.images)
    expect(d.nodeCount).toBe(74)
    expect(d.meshCount).toBe(1)
    // A bare NodeIO silently drops extensions the source declares; the intake `io` registers them.
    // Losing KHR_materials_ior was a real first-candidate defect, so it is gated explicitly.
    expect(d.extensionsUsed, 'declared extensions').toEqual(['KHR_materials_ior'])
  })

  it('Walk and Run are untouched, sampler for sampler', async () => {
    const d = await digests()
    expect(d.clips.Walk.digest, 'Walk samplers').toBe(PRESERVED.walk)
    expect(d.clips.Run.digest, 'Run samplers').toBe(PRESERVED.run)
    expect(d.clips.Walk.duration).toBeCloseTo(1.066667, 6)
    expect(d.clips.Run.duration).toBeCloseTo(0.666667, 6)
    expect(d.clips.Walk.channels).toBe(72)
    expect(d.clips.Run.channels).toBe(72)
  })

  it('Idle is the new 4 s loop on the SAME 72 channels — replaced, not added to', async () => {
    const d = await digests()
    const idle = d.clips.Idle
    expect(Object.keys(d.clips).sort(), 'clip set unchanged').toEqual(['Idle', 'Run', 'Walk'])
    expect(idle.digest, 'Idle must actually have changed').not.toBe(OLD_IDLE_DIGEST)
    expect(idle.channels, 'same channel count — no new targets').toBe(72)
    expect(idle.duration).toBeCloseTo(IDLE_DURATION, 6)
    expect(idle.maxKeys, '8 keys/s over 4 s, inclusive of the loop point').toBe(33)
    expect([...idle.interpolations], 'interpolation').toEqual(['LINEAR'])
  })

  it('only the breathing bones move, and nothing below the hips does', async () => {
    const d = await digests()
    const idle = d.clips.Idle
    expect(idle.moving.sort(), 'moving channels').toEqual(BREATHING_BONES.map((b) => `${b}.rotation`).sort())
    for (const bone of LOWER_BODY) {
      for (const path of ['rotation', 'translation', 'scale']) {
        expect(idle.constant, `${bone}.${path} must be a constant track`).toContain(`${bone}.${path}`)
      }
    }
    // Every translation/scale track in the clip holds its original key: rotation is the only thing
    // this recipe is allowed to author, so no joint can drift off its authored position.
    for (const key of idle.moving) expect(key.endsWith('.rotation'), `${key} moves`).toBe(true)
  })

  it('the loop closes: t=0 and t=4 s are the same sample on every rotation channel', async () => {
    const doc = await glbIo.read(GLB)
    const idle = doc.getRoot().listAnimations().find((a) => a.getName() === 'Idle')!
    let worst = 0
    for (const c of idle.listChannels()) {
      if (c.getTargetPath() !== 'rotation') continue
      const out = c.getSampler()!.getOutput()!.getArray()!
      for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(out[i] - out[out.length - 4 + i]))
    }
    expect(worst, 'max |q(0) - q(4s)| across all rotation channels').toBeLessThan(1e-6)
  })

  it('the shipped Idle pose is arms-down, not the 114-degree raised pose it replaced', async () => {
    const world = await idleT0World()
    for (const side of ['Left', 'Right']) {
      const shoulder = world.get(`${side}Arm`)!
      const elbow = world.get(`${side}ForeArm`)!
      const wrist = world.get(`${side}Hand`)!
      const bend = THREE.MathUtils.radToDeg(
        elbow.clone().sub(shoulder).normalize().angleTo(wrist.clone().sub(elbow).normalize()))
      // The clip this replaced measured 114.3° / 114.8° with the wrist ABOVE the elbow.
      expect(bend, `${side} elbow bend is soft`).toBeLessThan(30)
      expect(wrist.y, `${side} wrist hangs below the elbow`).toBeLessThan(elbow.y)
      expect(wrist.y, `${side} wrist is down by the thigh`).toBeLessThan(1.0)
    }
  })
})
