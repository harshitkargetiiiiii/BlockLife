/**
 * Builds BlockLife's original rigged character GLB.
 *
 * Run:  node scripts/buildCharacterGlb.mjs
 * Out:  public/assets/models/characters/blocklife_person.glb
 *
 * This is an ORIGINAL, in-repo authored asset (no third-party IP): a
 * stylized low-poly humanoid (lathed torso/limbs, shaped head and face), rigid-skinned
 * to a 7-bone skeleton (Hips, Spine, Head, ArmL/R, LegL/R) with three baked
 * animation clips — Idle, Walk, Run. Material slots are named for the
 * wardrobe contract: shirt / pants / hair / skin / shoes / accessory (+ eyes,
 * excluded from customization). Regenerating is deterministic: same script → same
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
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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
  // Weld coincident vertices (same position/normal/bone) into an indexed mesh: the shaped
  // parts are dense, and a non-indexed export would be ~4x the bytes for the same surface.
  return mergeVertices(merged)
}

// ---- Shape helpers --------------------------------------------------------
// The body is still rigid-skinned to the 7-bone rig, but each part is a SHAPED surface
// (lathed profiles, ellipsoids, capsules) instead of a bare cylinder/box/sphere, so it reads
// as a stylized person at the gameplay camera. Every helper returns geometry in ABSOLUTE
// world Y (feet at 0) unless noted; `part()` then adds only the given X/Z offset.

/** A lathed solid from [radius, y] pairs (bottom → top), optionally flattened front-to-back. */
function lathe(profile, { segments = 20, depth = 1 } = {}) {
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  )
  if (depth !== 1) g.scale(1, 1, depth)
  return g
}

/** An ellipsoid of base radius `r` scaled per axis, centred on the origin. */
function ellipsoid(r, [sx, sy, sz], w = 18, h = 12) {
  return new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz)
}

/** A cylinder spanning two points (for straps and glasses temples). */
function rod(radius, from, to, radial = 6) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a)
  const g = new THREE.CylinderGeometry(radius, radius, dir.length(), radial)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
  const mid = a.add(b).multiplyScalar(0.5)
  g.translate(mid.x, mid.y, mid.z)
  return g
}

// Head: an upright ellipsoid whose crown is the established 1.92 m visual height.
const HEAD_Y = 1.64
const HEAD_R = 0.26
const HEAD_SCALE = [1, (1.92 - HEAD_Y) / HEAD_R, 1] // crown exactly at the declared 1.92 m visual height

/** The torso: hips-to-shoulders profile with a waist and a rounded shoulder line. */
const torso = () =>
  lathe(
    [
      [0, 0.8],
      [0.245, 0.8],
      [0.255, 0.9],
      [0.24, 1.01],
      [0.262, 1.16],
      [0.29, 1.27],
      [0.305, 1.34],
      [0.27, 1.405],
      [0.2, 1.437],
      [0.1, 1.455],
      [0, 1.46],
    ],
    { segments: 24, depth: 0.68 },
  )
/** A sleeve: shoulder cap down to just above the elbow (T-shirt length). */
const sleeve = () =>
  lathe(
    [
      [0, 1.07],
      [0.083, 1.07],
      [0.086, 1.12],
      [0.08, 1.24],
      [0.088, 1.33],
      [0.06, 1.395],
      [0, 1.41],
    ],
    { segments: 14 },
  )
/** A bare forearm tapering to the wrist. */
const forearm = () =>
  lathe(
    [
      [0, 0.83],
      [0.044, 0.83],
      [0.05, 0.9],
      [0.062, 1.02],
      [0.064, 1.09],
      [0, 1.1],
    ],
    { segments: 12 },
  )
/** A mitten hand: flattened, slightly longer than wide, thumb side forward. */
const hand = (side) => {
  const palm = ellipsoid(0.058, [0.72, 1.3, 1], 12, 10).translate(0, 0.785, 0)
  const thumb = ellipsoid(0.024, [1, 1.6, 1], 8, 6)
    .rotateX(-0.4)
    .translate(side * -0.018, 0.8, 0.045)
  return [palm, thumb]
}
/** A trouser leg: thigh → knee → ankle, with a slight cuff. */
const leg = () =>
  lathe(
    [
      [0, 0.1],
      [0.068, 0.1],
      [0.07, 0.14],
      [0.072, 0.24],
      [0.085, 0.36],
      [0.098, 0.48],
      [0.112, 0.62],
      [0.11, 0.74],
      [0, 0.75],
    ],
    { segments: 16, depth: 0.95 },
  )
/** Pelvis/seat: bridges the torso and both legs. */
const pelvis = () =>
  lathe(
    [
      [0, 0.6],
      [0.2, 0.62],
      [0.25, 0.68],
      [0.262, 0.76],
      [0.252, 0.84],
      [0, 0.85],
    ],
    { segments: 22, depth: 0.74 },
  )
/** A rounded trainer: a toe-forward shell on a flat sole (sole underside at y = 0). */
const shoe = () => [
  ellipsoid(0.1, [0.9, 0.62, 1.5], 16, 10).translate(0, 0.072, 0.045),
  new THREE.CylinderGeometry(0.1, 0.1, 0.03, 18).scale(0.86, 1, 1.42).translate(0, 0.015, 0.045),
]

const SLOTS = {
  shirt: {
    color: '#f4a259',
    parts: [
      [torso(), [0, 0, 0], 'Spine'],
      // Crew collar.
      [new THREE.TorusGeometry(0.085, 0.022, 8, 20).rotateX(Math.PI / 2), [0, 1.44, 0], 'Spine'],
      // Short sleeves (swing rigidly from the shoulder).
      [sleeve(), [-0.38, 0, 0], 'ArmL'],
      [sleeve(), [0.38, 0, 0], 'ArmR'],
      // Deltoids: round the shoulder from the torso into the sleeve.
      [ellipsoid(0.1, [1.1, 0.9, 0.95], 14, 10), [-0.35, 1.335, 0], 'ArmL'],
      [ellipsoid(0.1, [1.1, 0.9, 0.95], 14, 10), [0.35, 1.335, 0], 'ArmR'],
    ],
  },
  pants: {
    color: '#3d405b',
    parts: [
      [leg(), [-0.135, 0, 0], 'LegL'],
      [leg(), [0.135, 0, 0], 'LegR'],
      [pelvis(), [0, 0, 0], 'Hips'],
    ],
  },
  shoes: {
    color: '#2b2620',
    parts: [
      ...shoe().map((g) => [g, [-0.135, 0, 0], 'LegL']),
      ...shoe().map((g) => [g, [0.135, 0, 0], 'LegR']),
    ],
  },
  skin: {
    color: '#ffd7b0',
    parts: [
      [ellipsoid(HEAD_R, HEAD_SCALE, 28, 20), [0, HEAD_Y, 0], 'Head'],
      // Neck (bound to the Spine so the head turns on it rather than with it).
      [new THREE.CylinderGeometry(0.068, 0.078, 0.14, 12), [0, 1.43, 0], 'Spine'],
      // Nose and ears.
      [ellipsoid(0.034, [0.8, 1, 0.9], 10, 8), [0, 1.615, 0.252], 'Head'],
      [ellipsoid(0.045, [0.45, 1, 0.75], 10, 8), [-0.257, 1.645, -0.005], 'Head'],
      [ellipsoid(0.045, [0.45, 1, 0.75], 10, 8), [0.257, 1.645, -0.005], 'Head'],
      // Forearms and hands below the sleeves.
      [forearm(), [-0.38, 0, 0], 'ArmL'],
      [forearm(), [0.38, 0, 0], 'ArmR'],
      ...hand(-1).map((g) => [g, [-0.38, 0, 0], 'ArmL']),
      ...hand(1).map((g) => [g, [0.38, 0, 0], 'ArmR']),
    ],
  },
  // hair + accessory are VARIANT GROUPS (multiple authored geometries — see
  // VARIANT_GROUPS below), not single meshes: issue #23 / PR #24 review asked for real
  // hairstyle + accessory-TYPE variation, not only colour. The runtime shows exactly one
  // variant per identity and hides the rest.
  eyes: {
    color: '#222222',
    parts: [
      // Oval eyes, brows and a small mouth: the face reads at the gameplay zoom.
      [ellipsoid(0.034, [0.85, 1.3, 0.6], 10, 8), [-0.09, 1.672, 0.236], 'Head'],
      [ellipsoid(0.034, [0.85, 1.3, 0.6], 10, 8), [0.09, 1.672, 0.236], 'Head'],
      [new THREE.BoxGeometry(0.085, 0.018, 0.02).rotateZ(-0.12), [-0.09, 1.737, 0.229], 'Head'],
      [new THREE.BoxGeometry(0.085, 0.018, 0.02).rotateZ(0.12), [0.09, 1.737, 0.229], 'Head'],
      [new THREE.BoxGeometry(0.07, 0.013, 0.02), [0, 1.55, 0.243], 'Head'],
    ],
  },
}

/**
 * Issue #23 / PR #24 review — real GEOMETRY variants. Each group authors several
 * distinct meshes bound to the SAME skeleton; the runtime shows exactly ONE per
 * identity (a deterministic pick) and hides the rest — one gameplay actor, one rig,
 * visibly distinct silhouettes. All variants in a group share the group's single
 * material (named for the slot), so the per-instance recolor still lands on whichever
 * is shown. Hair adds hairstyles (short / long / bun; "bald" = show none); accessory
 * adds TYPES (scarf / glasses / bag; "none" = show none) — none of which hide the
 * wardrobe-customizable hair.
 */
// A head-hugging hair shell tilted so the hairline sits high at the front (above the
// brows) and low at the nape.
const cap = () => [
  new THREE.SphereGeometry(HEAD_R + 0.018, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.56)
    .rotateX(-0.42)
    .scale(...HEAD_SCALE),
  [0, HEAD_Y, -0.006],
  'Head',
]
const VARIANT_GROUPS = {
  hair: {
    color: '#5c4033',
    variants: {
      short: [cap()],
      // Shoulder-length: a rounded fall down the back of the head.
      long: [
        cap(),
        [new THREE.CapsuleGeometry(0.19, 0.24, 6, 16).scale(1.3, 1, 0.5), [0, 1.52, -0.17], 'Head'],
      ],
      // Top-knot bun: its top is the rig's 2.15 m envelope.
      bun: [cap(), [ellipsoid(0.12, [1, 1, 1], 14, 10), [0, 2.03, -0.03], 'Head']],
    },
  },
  accessory: {
    color: '#2b2620',
    variants: {
      // Knitted neck scarf with a short hanging tail (bound to Spine — never touches the hair).
      scarf: [
        [new THREE.TorusGeometry(0.15, 0.055, 10, 24).rotateX(Math.PI / 2).scale(1, 1, 0.9), [0, 1.42, 0.01], 'Spine'],
        [new THREE.CapsuleGeometry(0.045, 0.16, 4, 10).scale(1.3, 1, 0.55).rotateZ(0.12), [0.07, 1.27, 0.19], 'Spine'],
      ],
      // Round glasses: two rims, a bridge and the temples back to the ears.
      glasses: [
        [new THREE.TorusGeometry(0.044, 0.009, 6, 18), [-0.09, 1.672, 0.262], 'Head'],
        [new THREE.TorusGeometry(0.044, 0.009, 6, 18), [0.09, 1.672, 0.262], 'Head'],
        [rod(0.007, [-0.046, 1.676, 0.264], [0.046, 1.676, 0.264]), [0, 0, 0], 'Head'],
        [rod(0.007, [-0.134, 1.676, 0.25], [-0.25, 1.67, 0.04]), [0, 0, 0], 'Head'],
        [rod(0.007, [0.134, 1.676, 0.25], [0.25, 1.67, 0.04]), [0, 0, 0], 'Head'],
      ],
      // Messenger satchel on the right hip with a strap across the chest (bound to Spine).
      bag: [
        [new THREE.BoxGeometry(0.11, 0.24, 0.22), [0.28, 0.99, 0.0], 'Spine'],
        [new THREE.BoxGeometry(0.12, 0.09, 0.23), [0.285, 1.07, 0.0], 'Spine'],
        ...chestStrap(0.02, [-0.19, 1.4], [0.235, 1.1]),
      ],
    },
  },
}

/** The torso's lathe radius at height `y` (linear between profile points). */
function torsoRadiusAt(y) {
  const pts = torso().parameters.points
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (y >= a.y && y <= b.y) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1)
  }
  return 0
}
/** A strap laid across the FRONT of the torso from (x0,y0) to (x1,y1), riding its surface. */
function chestStrap(radius, [x0, y0], [x1, y1], steps = 6) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const r = torsoRadiusAt(y)
    pts.push([x, y, Math.sqrt(Math.max(r * r - x * x, 0)) * 0.68 + radius * 0.8])
  }
  return pts.slice(1).map((p, i) => [rod(radius, pts[i], p), [0, 0, 0], 'Spine'])
}

/** Per-slot surface response: skin slightly satin, shoes and eyes glossier than cloth. */
const ROUGHNESS = { skin: 0.62, eyes: 0.35, shoes: 0.55, hair: 0.7 }

const root = new THREE.Group()
root.name = 'BlockLifePerson'
root.add(bones.Hips)
// Resolve every bone's REST world matrix before any `mesh.bind(skeleton)` (issue #56).
// `SkinnedMesh.bind()` updates only the mesh's own matrix, and `Skeleton.calculateInverses()`
// inverts each bone's `matrixWorld`. Without this, every inverse bind was identity, so the rest
// joint offsets were applied twice at runtime: a 0.72 m hover, detached limbs, and a 2.93 m
// envelope for a rig authored at 2.15 m.
root.updateMatrixWorld(true)

let triangles = 0
for (const [slot, def] of Object.entries(SLOTS)) {
  const merged = mergeParts(def.parts.map(([geo, pos, bone]) => part(geo, pos, bone)))
  triangles += merged.index.count / 3
  const material = new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: ROUGHNESS[slot] ?? 0.85,
    name: slot,
  })
  const mesh = new THREE.SkinnedMesh(merged, material)
  mesh.name = `person_${slot}`
  mesh.castShadow = true
  mesh.bind(skeleton)
  root.add(mesh)
}

// Variant-group meshes: ONE shared material per group (named for the slot so recolor
// still resolves it) across all of the group's variant meshes; the runtime toggles
// visibility so exactly one shows per identity.
let variantMeshes = 0
for (const [group, gdef] of Object.entries(VARIANT_GROUPS)) {
  const material = new THREE.MeshStandardMaterial({ color: gdef.color, roughness: ROUGHNESS[group] ?? 0.85, name: group })
  for (const [variant, parts] of Object.entries(gdef.variants)) {
    const merged = mergeParts(parts.map(([geo, pos, bone]) => part(geo, pos, bone)))
    triangles += merged.index.count / 3
    const mesh = new THREE.SkinnedMesh(merged, material)
    mesh.name = `person_${group}__${variant}`
    mesh.castShadow = true
    mesh.bind(skeleton)
    root.add(mesh)
    variantMeshes++
  }
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
      `size ${kb} KB · ~${Math.round(triangles)} triangles · ${boneNames.length} bones · 3 clips (Idle/Walk/Run) · 5 slots + ${variantMeshes} variant meshes (hair×3/accessory×3)`,
    )
  },
  (err) => {
    console.error('export failed', err)
    process.exit(1)
  },
  { binary: true, animations: [idle, walk, run] },
)
