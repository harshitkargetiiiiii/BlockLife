/**
 * Builds BlockLife's original rigged character GLB.
 *
 * Run:  node scripts/buildCharacterGlb.mjs
 * Out:  public/assets/models/characters/blocklife_person.glb
 *
 * This is an ORIGINAL, in-repo authored asset (no third-party IP): a
 * low-poly humanoid matching the game's primitive art style, rigid-skinned
 * to a 7-bone skeleton (Hips, Spine, Head, ArmL/R, LegL/R) with three baked
 * animation clips — Idle, Walk, Run. Material slots are named for the
 * wardrobe contract: shirt / pants / hair / skin / shoes (+ eyes, excluded
 * from customization). Regenerating is deterministic: same script → same
 * asset. License: same as the project (original work).
 */
// Minimal FileReader polyfill: GLTFExporter uses it to concatenate binary
// chunks even when no textures exist. Node's Blob.arrayBuffer covers it.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    })
  }
}

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../public/assets/models/characters/blocklife_person.glb',
)

// ---- Skeleton ---------------------------------------------------------

const BONES = {
  Hips: { pos: [0, 0.72, 0], parent: null },
  Spine: { pos: [0, 0.34, 0], parent: 'Hips' }, // world y 1.06
  Head: { pos: [0, 0.44, 0], parent: 'Spine' }, // world y 1.50
  ArmL: { pos: [-0.38, 0.26, 0], parent: 'Spine' }, // world (−0.38, 1.32)
  ArmR: { pos: [0.38, 0.26, 0], parent: 'Spine' },
  LegL: { pos: [-0.14, 0, 0], parent: 'Hips' }, // world (−0.14, 0.72)
  LegR: { pos: [0.14, 0, 0], parent: 'Hips' },
}
const boneNames = Object.keys(BONES)
const bones = {}
for (const name of boneNames) {
  const b = new THREE.Bone()
  b.name = name
  b.position.set(...BONES[name].pos)
  bones[name] = b
}
for (const name of boneNames) {
  const parent = BONES[name].parent
  if (parent) bones[parent].add(bones[name])
}
const skeleton = new THREE.Skeleton(boneNames.map((n) => bones[n]))
const boneIndex = Object.fromEntries(boneNames.map((n, i) => [n, i]))

// ---- Geometry (bind pose, feet at y=0, facing +z) ----------------------

/** Bakes a primitive at a world position, rigid-bound to one bone. */
function part(geometry, worldPos, bone) {
  const g = geometry.toNonIndexed()
  g.translate(...worldPos)
  const count = g.attributes.position.count
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = boneIndex[bone]
    skinWeight[i * 4] = 1
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  return g
}

function mergeParts(parts) {
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0)
  const merged = new THREE.BufferGeometry()
  for (const key of ['position', 'normal', 'skinIndex', 'skinWeight']) {
    const itemSize = parts[0].attributes[key].itemSize
    const Ctor = parts[0].attributes[key].array.constructor
    const array = new Ctor(total * itemSize)
    let offset = 0
    for (const g of parts) {
      array.set(g.attributes[key].array, offset)
      offset += g.attributes[key].array.length
    }
    merged.setAttribute(key, new THREE.BufferAttribute(array, itemSize))
  }
  return merged
}

const SLOTS = {
  shirt: {
    color: '#f4a259',
    parts: [
      // Torso
      [new THREE.CylinderGeometry(0.26, 0.3, 0.62, 10), [0, 1.09, 0], 'Spine'],
      [new THREE.SphereGeometry(0.26, 10, 8), [0, 1.4, 0], 'Spine'],
      // Sleeved arms (swing rigidly from the shoulder)
      [new THREE.CylinderGeometry(0.075, 0.07, 0.5, 8), [-0.38, 1.07, 0], 'ArmL'],
      [new THREE.CylinderGeometry(0.075, 0.07, 0.5, 8), [0.38, 1.07, 0], 'ArmR'],
      [new THREE.SphereGeometry(0.085, 8, 8), [-0.38, 1.32, 0], 'ArmL'],
      [new THREE.SphereGeometry(0.085, 8, 8), [0.38, 1.32, 0], 'ArmR'],
    ],
  },
  pants: {
    color: '#3d405b',
    parts: [
      [new THREE.CylinderGeometry(0.1, 0.095, 0.6, 8), [-0.14, 0.4, 0], 'LegL'],
      [new THREE.CylinderGeometry(0.1, 0.095, 0.6, 8), [0.14, 0.4, 0], 'LegR'],
      [new THREE.CylinderGeometry(0.27, 0.24, 0.2, 10), [0, 0.72, 0], 'Hips'],
    ],
  },
  shoes: {
    color: '#2b2620',
    parts: [
      [new THREE.BoxGeometry(0.19, 0.12, 0.3), [-0.14, 0.06, 0.04], 'LegL'],
      [new THREE.BoxGeometry(0.19, 0.12, 0.3), [0.14, 0.06, 0.04], 'LegR'],
    ],
  },
  skin: {
    color: '#ffd7b0',
    parts: [
      [new THREE.SphereGeometry(0.3, 14, 12), [0, 1.62, 0], 'Head'],
      [new THREE.SphereGeometry(0.075, 8, 8), [-0.38, 0.8, 0], 'ArmL'],
      [new THREE.SphereGeometry(0.075, 8, 8), [0.38, 0.8, 0], 'ArmR'],
    ],
  },
  hair: {
    color: '#5c4033',
    parts: [
      [
        new THREE.SphereGeometry(0.285, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
        [0, 1.77, -0.04],
        'Head',
      ],
    ],
  },
  eyes: {
    color: '#222222',
    parts: [
      [new THREE.SphereGeometry(0.04, 6, 6), [-0.11, 1.64, 0.265], 'Head'],
      [new THREE.SphereGeometry(0.04, 6, 6), [0.11, 1.64, 0.265], 'Head'],
    ],
  },
}

const root = new THREE.Group()
root.name = 'BlockLifePerson'
root.add(bones.Hips)

let triangles = 0
for (const [slot, def] of Object.entries(SLOTS)) {
  const merged = mergeParts(def.parts.map(([geo, pos, bone]) => part(geo, pos, bone)))
  triangles += merged.attributes.position.count / 3
  const material = new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: 0.85,
    name: slot,
  })
  const mesh = new THREE.SkinnedMesh(merged, material)
  mesh.name = `person_${slot}`
  mesh.castShadow = true
  mesh.bind(skeleton)
  root.add(mesh)
}

// ---- Animations (baked keyframes) --------------------------------------

const SAMPLES = 24

function bakeClip(name, duration, pose) {
  const tracks = []
  const times = Array.from({ length: SAMPLES + 1 }, (_, i) => (i / SAMPLES) * duration)
  const euler = new THREE.Euler()
  const q = new THREE.Quaternion()
  for (const bone of boneNames) {
    const rotValues = []
    const posValues = []
    let hasPos = false
    for (const t of times) {
      const phase = (t / duration) * Math.PI * 2
      const p = pose(bone, phase)
      euler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)
      q.setFromEuler(euler)
      rotValues.push(q.x, q.y, q.z, q.w)
      const base = BONES[bone].pos
      posValues.push(base[0] + (p.px ?? 0), base[1] + (p.py ?? 0), base[2] + (p.pz ?? 0))
      if (p.px || p.py || p.pz) hasPos = true
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, rotValues))
    if (hasPos) tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, times, posValues))
  }
  return new THREE.AnimationClip(name, duration, tracks)
}

const idle = bakeClip('Idle', 2.4, (bone, ph) => {
  switch (bone) {
    case 'Hips':
      return { py: Math.sin(ph) * 0.008 }
    case 'Spine':
      return { rx: Math.sin(ph) * 0.02 }
    case 'Head':
      return { ry: Math.sin(ph * 0.5) * 0.06 }
    case 'ArmL':
      return { rz: 0.06 + Math.sin(ph) * 0.02 }
    case 'ArmR':
      return { rz: -0.06 - Math.sin(ph) * 0.02 }
    default:
      return {}
  }
})

const walk = bakeClip('Walk', 0.9, (bone, ph) => {
  const swing = Math.sin(ph)
  switch (bone) {
    case 'Hips':
      // Two footfalls per cycle → bob at double frequency.
      return { py: Math.abs(Math.sin(ph)) * 0.024 }
    case 'Spine':
      return { ry: swing * 0.06, rx: 0.04 }
    case 'LegL':
      return { rx: swing * 0.55 }
    case 'LegR':
      return { rx: -swing * 0.55 }
    case 'ArmL':
      return { rx: -swing * 0.42, rz: 0.06 }
    case 'ArmR':
      return { rx: swing * 0.42, rz: -0.06 }
    default:
      return {}
  }
})

const run = bakeClip('Run', 0.62, (bone, ph) => {
  const swing = Math.sin(ph)
  switch (bone) {
    case 'Hips':
      return { py: Math.abs(Math.sin(ph)) * 0.05 }
    case 'Spine':
      return { rx: 0.2, ry: swing * 0.08 }
    case 'Head':
      return { rx: -0.08 }
    case 'LegL':
      return { rx: swing * 0.95 }
    case 'LegR':
      return { rx: -swing * 0.95 }
    case 'ArmL':
      return { rx: -swing * 0.85, rz: 0.1 }
    case 'ArmR':
      return { rx: swing * 0.85, rz: -0.1 }
    default:
      return {}
  }
})

// ---- Export -------------------------------------------------------------

const exporter = new GLTFExporter()
exporter.parse(
  root,
  (result) => {
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, Buffer.from(result))
    const kb = (Buffer.from(result).length / 1024).toFixed(1)
    console.log(`wrote ${OUT}`)
    console.log(
      `size ${kb} KB · ~${Math.round(triangles)} triangles · ${boneNames.length} bones · 3 clips (Idle/Walk/Run) · 6 material slots`,
    )
  },
  (err) => {
    console.error('export failed', err)
    process.exit(1)
  },
  { binary: true, animations: [idle, walk, run] },
)
