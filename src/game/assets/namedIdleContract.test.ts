// @vitest-environment node
// (GLTFLoader.parse and the gltf-transform NodeIO read GLB binary chunks; jsdom mis-handles that.)
// GLTFLoader reaches for `self`; the same one-line polyfill the intake scripts use.
;(globalThis as { self?: unknown }).self ??= globalThis
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AUTHORED_JOINTS, BREATH, IDLE_DURATION, JOINTS, KEYS, LOWER_BODY, applyKeys, armParams, breathingKeys, handPlane,
  idleInvarianceDigests, io, loadRig, snapshot, solveArms, worldPos,
} from '../../../scripts/asset-intake/namedIdle.mjs'
import type { NamedIdleKey } from '../../../scripts/asset-intake/namedIdle.mjs'
import { CHARACTERS, RIG_FIT } from '../../../scripts/asset-intake/wave4.config.mjs'
import provenance from '../../../docs/asset-provenance/wave4-provenance.json'

/**
 * Issue #27 (named slice) — Maya's and Bruno's derived Idle, asserted against the REAL committed bytes.
 *
 * `scripts/asset-intake/namedIdle.mjs` rewrites ONE clip of the assembled Wave-4 body. The PRE digests below were
 * computed from the bytes that shipped BEFORE this change (`git show feb7b540:public/assets/models/characters/…`),
 * so they are not self-referential: matching them proves geometry, rest nodes, skin, materials, images, Walk,
 * Run and every held Idle channel survived. The reviewed external candidates are pinned by sha256, and the
 * rotation keys are re-authored here from the committed rig to prove the recipe is deterministic.
 * Nothing here claims visual acceptance: the hand-plane solve is unsigned (palm vs back not decided).
 */

const REVIEWED = {
  blocklife_maya_01: 'e8e2ef708005226c3b6c077b28e0b929a30fbf00aeb083306261472e44bd189b',
  blocklife_bruno_01: '5b5bc61d27833196d6a33dc05b3ce4b9a2832949be152639845eac02e0c00d4c',
} as const
type BodyId = keyof typeof REVIEWED

const PRE: Record<BodyId, {
  baseSha256: string
  upperLateralDeg: number
  digests: Record<'geometry' | 'nodes' | 'skin' | 'materials' | 'materialSampling' | 'images' | 'walk' | 'run' | 'idle' | 'idleHeld', string>
  derivedIdleDigest: string
  /** The original (pre-change) Idle rotation key of every joint the recipe authors — exact Float32 values. */
  authoredOriginal: Record<string, number[]>
}> = {
  blocklife_maya_01: {
    baseSha256: '2b2de77624956433a3f7c65782bf3a315bf5f1ef8169a2b202017c415f8cdd73',
    upperLateralDeg: 23,
    digests: {
      geometry: 'dd0e842e015165a65998bae2636e0d57ab4a28faaec180295277aecce9cd2e8a',
      nodes: '1040478a7c72e0d0c2b42b1a8fa6ebf6e9ef27bfc22a123ca1fe624a45ffe981',
      skin: '65e1ee7ae229061e8dc227cd511363218f264d611ef6e4f8834d724b7d86b442',
      materials: '8f5c3fa43546f1c053e52126fe7b698b7a3dbb9443f2a12f9397f17e40110b98',
      // Decoded IOR + TextureInfo/sampler state, computed from the feb7b540 base bytes (added with the digest fix).
      materialSampling: 'ac6d2cef6f1e10f8064afa6d6223d7a8ae02d5481f63161ba394e423f731ba8a',
      images: '3f9275259dfde2e0f3073eb88ab8ddad8cd8124fc3d381b3b2048d4edf1e5df5',
      walk: '0cf1d6a041ec97c417c42a6d9146ec10cbe8f265df131e5357bafef52c9e4334',
      run: 'a152b7a477fba81266ea704552b200b8e065cea801d3fd049d3e56898ec03029',
      idle: '5c657148f8692cbde8bbb5487c3346ea58b7d9184d1f5098d7fb7c360caabbcd',
      idleHeld: 'f3c46cff361859d2d53132605db2933dc6d35d0554c5f84311d640663f025587',
    },
    derivedIdleDigest: '8e07ad2f26e96d703e9240a131d55bc4dacb96d4ceccdf9b31737ba8190e583d',
    authoredOriginal: {
      Spine02: [-0.09948930889368057, 0.005762698128819466, 0.0002773161686491221, 0.9950219392776489],
      Spine01: [-1.700845864149869e-8, 2.8057909329248787e-9, 2.5920599000528455e-9, 1],
      Spine: [0.05929919704794884, -0.00017482166003901511, 0.0005003535188734531, 0.9982401132583618],
      LeftShoulder: [0.48580411076545715, 0.4572566747665405, -0.5080559849739075, 0.5447841882705688],
      LeftArm: [0.39611342549324036, 0.3728364408016205, 0.25614845752716064, 0.7990463972091675],
      LeftForeArm: [-0.7688000202178955, -0.37723034620285034, -0.014848411083221436, 0.516162097454071],
      LeftHand: [0.2445521354675293, 0.20389272272586823, -0.14932987093925476, 0.9361210465431213],
      RightShoulder: [0.4866541922092438, -0.45635172724723816, 0.5120500922203064, 0.5410318970680237],
      RightArm: [0.3970528244972229, -0.372329443693161, -0.2533020079135895, 0.7997236847877502],
      RightForeArm: [-0.7643836736679077, 0.366784930229187, 0.0011211199453100562, 0.5302689671516418],
      RightHand: [0.19967833161354065, -0.17657585442066193, 0.15581738948822021, 0.9511417150497437],
      neck: [-0.059263113886117935, 0.0036585358902812004, -0.0043899607844650745, 0.9982261061668396],
      Head: [0.38437023758888245, 0.00007185971480794251, 0.004875150974839926, 0.9231661558151245],
    },
  },
  blocklife_bruno_01: {
    baseSha256: '7abc583cf88e3def698b378477aba5dbd89603533756af694e10929b38adcdad',
    upperLateralDeg: 17,
    digests: {
      geometry: '9a9db1709e6bbab4e857780453fd0f5a27239a59cb082a9680399bcccee39bb0',
      nodes: '8c178fa104b981c013bf76e97320a5e41bc24887c1d92e7c9801dec376d87d8d',
      skin: 'b1640df9665399479d0f7d08b16e24c58c66044ab6daf253666826d2ab89ab8c',
      materials: '8f5c3fa43546f1c053e52126fe7b698b7a3dbb9443f2a12f9397f17e40110b98',
      // Decoded IOR + TextureInfo/sampler state, computed from the feb7b540 base bytes (added with the digest fix).
      materialSampling: 'ac6d2cef6f1e10f8064afa6d6223d7a8ae02d5481f63161ba394e423f731ba8a',
      images: '95aa31750abb7235077967a3c2c957c53f210bc8130949361355cdf800264505',
      walk: '94edb5cbebe86e2e0f54be514dc0998b9a8e30f885c47fb3f39bbeb091fd1537',
      run: '0ba08ca8158ba179e5afd621fed75bc39a3f06d961ec023f014dd619f36e6441',
      idle: '55cef3652775eae07285d06b9b17220e61fd9d23a28abc521417346a11df2182',
      idleHeld: 'a04b687977dc4b6f5361e323e6c628054487830b2badb8c492ea674499a777b9',
    },
    derivedIdleDigest: 'fb817b9152d4eb7f2db685b354b2c1ca18a9af4775d146a7664fb27870479502',
    authoredOriginal: {
      Spine02: [0.6310576796531677, 0.6259273886680603, 0.4250970780849457, 0.1710958480834961],
      Spine01: [-2.589149517007172e-8, -2.9482180252671242e-8, -8.498318493366241e-9, 1],
      Spine: [-0.04327785223722458, 0.000020321311239968054, 0.0006414647796191275, 0.9990628957748413],
      LeftShoulder: [0.4963531494140625, 0.5128958225250244, -0.5108389258384705, 0.47918176651000977],
      LeftArm: [0.48894262313842773, 0.5052387118339539, 0.23385357856750488, 0.6715515851974487],
      LeftForeArm: [-0.615572988986969, -0.1513511836528778, 0.14342011511325836, 0.759995698928833],
      LeftHand: [-0.04275396093726158, -0.00711162481456995, 0.04434698075056076, 0.998075544834137],
      RightShoulder: [0.49681538343429565, -0.5124481320381165, 0.49521979689598083, 0.49530673027038574],
      RightArm: [0.5012623071670532, -0.5170347690582275, -0.2694113552570343, 0.6393972039222717],
      RightForeArm: [-0.6552055478096008, 0.18458910286426544, -0.0833953246474266, 0.7277897000312805],
      RightHand: [-0.04056631028652191, 0.0122704291716218, 0.009352545253932476, 0.9990577697753906],
      neck: [0.04165048152208328, -0.00904341321438551, 0.008236847817897797, 0.999057412147522],
      Head: [0.15391482412815094, 0.0004395678988657892, -0.005673245992511511, 0.9880677461624146],
    },
  },
}
const BODIES = Object.keys(REVIEWED) as BodyId[]
const fileOf = (id: string) => `public/assets/models/characters/${id}.glb`
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const f32Bytes = (a: ArrayLike<number>) => Buffer.from(new Float32Array(a).buffer)

interface IdleChannel { ji: number; joint: string; path: string; interpolation: string; input: Float32Array; output: Float32Array; n: number }

async function committedIdle(id: BodyId) {
  const bytes = readFileSync(fileOf(id))
  const doc = await io.readBinary(new Uint8Array(bytes))
  const root = doc.getRoot()
  const joints = root.listSkins()[0].listJoints()
  const idle = root.listAnimations().find((a) => a.getName() === 'Idle')!
  const channels: IdleChannel[] = idle.listChannels().map((c) => {
    const s = c.getSampler()!
    const ji = joints.indexOf(c.getTargetNode()!)
    return { ji, joint: JOINTS[ji], path: c.getTargetPath() as string, interpolation: s.getInterpolation(),
      input: s.getInput()!.getArray() as Float32Array, output: s.getOutput()!.getArray() as Float32Array, n: s.getOutput()!.getElementSize() }
  })
  const channel = (ji: number, path: string) => channels.find((c) => c.ji === ji && c.path === path)!
  return { bytes, doc, root, channels, channel }
}

describe('issue #27 named slice — Maya and Bruno ship the reviewed Idle-only derivatives (real committed bytes)', () => {
  it('exactly Maya and Bruno are derived, and every pin agrees: config, RIG_FIT, provenance and the committed bytes', () => {
    const derived = CHARACTERS.filter((c) => c.idleDerivation).map((c) => c.id).sort()
    expect(derived, 'derived bodies').toEqual([...BODIES].sort())
    for (const id of BODIES) {
      const def = CHARACTERS.find((c) => c.id === id)!
      const d = def.idleDerivation!
      const committed = sha256(readFileSync(fileOf(id)))
      expect(committed, `${id} committed bytes are the reviewed candidate`).toBe(REVIEWED[id])
      expect(d.outputSha256, `${id} config output pin`).toBe(REVIEWED[id])
      expect(d.baseSha256, `${id} config base pin`).toBe(PRE[id].baseSha256)
      expect(d.upperLateralDeg, `${id} calibrated abduction`).toBe(PRE[id].upperLateralDeg)
      expect(RIG_FIT[id].sha256, `${id} RIG_FIT pin`).toBe(REVIEWED[id])
      const record = (provenance.assets as Array<Record<string, unknown>>).find((a) => a.id === id) as {
        outputSha256: string; derived?: { outputSha256: string; baseSha256: string; module: string; export: string; measured: { loop: { untouchedJointsBitExact: string[] } } }
      }
      expect(record.outputSha256, `${id} provenance output`).toBe(REVIEWED[id])
      expect(record.derived?.outputSha256, `${id} provenance derived output`).toBe(REVIEWED[id])
      expect(record.derived?.baseSha256, `${id} provenance derived base`).toBe(PRE[id].baseSha256)
      expect([record.derived?.module, record.derived?.export]).toEqual(['./namedIdle.mjs', 'deriveNamedIdle'])
      expect(record.derived?.measured.loop.untouchedJointsBitExact.length, `${id} untouched joints`).toBe(JOINTS.length - AUTHORED_JOINTS.length)
    }
    for (const other of CHARACTERS.filter((c) => !c.idleDerivation)) {
      const record = (provenance.assets as Array<Record<string, unknown>>).find((a) => a.id === other.id)!
      expect(record.derived, `${other.id} carries no derivation`).toBeUndefined()
    }
  })

  it('geometry, rest nodes, skin, materials (with decoded IOR and sampling), images, Walk, Run and every held Idle channel are the pre-change bytes', async () => {
    for (const id of BODIES) {
      const { doc } = await committedIdle(id)
      const d = idleInvarianceDigests(doc)
      for (const k of ['geometry', 'nodes', 'skin', 'materials', 'materialSampling', 'images', 'walk', 'run', 'idleHeld'] as const) {
        expect(d[k], `${id} ${k}`).toBe(PRE[id].digests[k])
      }
      expect(d.idle, `${id} Idle must have changed`).not.toBe(PRE[id].digests.idle)
      expect(d.idle, `${id} Idle is the reviewed derivation`).toBe(PRE[id].derivedIdleDigest)
      expect(d.extensionsUsed, `${id} declared extensions`).toEqual(['KHR_materials_ior'])
      expect(d.nodeCount, `${id} nodes`).toBe(74)
      expect(d.heldIdleChannels, `${id} held Idle channels (24 T + 24 S + 11 untouched R)`).toBe(59)
    }
  })

  it('Idle is a 4 s / 33-key LINEAR loop on the SAME 72 targets; held channels never move and only the 11 breathing joints animate', async () => {
    for (const id of BODIES) {
      const { root, channels } = await committedIdle(id)
      expect(root.listAnimations().map((a) => a.getName()).sort(), `${id} clip set`).toEqual(['Idle', 'Run', 'Walk'])
      expect(channels.length, `${id} Idle channels`).toBe(72)
      expect(new Set(channels.map((c) => `${c.ji}.${c.path}`)).size, `${id} unique targets`).toBe(72)
      const moving: string[] = []
      for (const c of channels) {
        expect(c.interpolation, `${id} ${c.joint}.${c.path}`).toBe('LINEAR')
        const keyCount = c.output.length / c.n
        const constant = Array.from(c.output).every((v, i) => Object.is(v, c.output[i % c.n]))
        if (c.path === 'rotation') {
          expect(keyCount, `${id} ${c.joint} rotation keys`).toBe(KEYS)
          expect(c.input[c.input.length - 1], `${id} ${c.joint} duration`).toBeCloseTo(IDLE_DURATION, 6)
          for (let i = 0; i < c.output.length; i += 4) {
            const norm = Math.hypot(c.output[i], c.output[i + 1], c.output[i + 2], c.output[i + 3])
            expect(Math.abs(norm - 1), `${id} ${c.joint} key ${i / 4} unit quaternion`).toBeLessThan(1e-6)
          }
          if (!constant) moving.push(c.joint)
        } else {
          expect([keyCount, Array.from(c.input)], `${id} ${c.joint}.${c.path} held over the loop`).toEqual([2, [0, IDLE_DURATION]])
          expect(constant, `${id} ${c.joint}.${c.path} holds one value`).toBe(true)
        }
        if (c.path === 'rotation' && !AUTHORED_JOINTS.includes(c.joint)) expect(constant, `${id} ${c.joint} untouched rotation`).toBe(true)
      }
      expect(moving.sort(), `${id} moving rotations`).toEqual(Object.keys(BREATH).sort())
      let loop = 0
      for (const c of channels.filter((x) => x.path === 'rotation')) {
        for (let i = 0; i < 4; i++) loop = Math.max(loop, Math.abs(c.output[i] - c.output[c.output.length - 4 + i]))
      }
      expect(loop, `${id} loop closes`).toBeLessThan(1e-6)
    }
  })

  it('the recipe is deterministic: re-authoring from the committed rig reproduces every committed Idle rotation bit for bit', async () => {
    for (const id of BODIES) {
      const { bytes, channel } = await committedIdle(id)
      // The pre-change Idle pose: committed held keys (proven equal to the originals above) + the pinned originals.
      const keys = new Map<number, NamedIdleKey>()
      JOINTS.forEach((name, i) => keys.set(i, {
        translation: Array.from(channel(i, 'translation').output.slice(0, 3)),
        scale: Array.from(channel(i, 'scale').output.slice(0, 3)),
        rotation: AUTHORED_JOINTS.includes(name) ? PRE[id].authoredOriginal[name] : Array.from(channel(i, 'rotation').output.slice(0, 4)),
      }))
      const author = async () => {
        const rig = await loadRig(bytes, id)
        applyKeys(rig, (i) => keys.get(i)!)
        solveArms(rig, armParams(PRE[id].upperLateralDeg), { Left: handPlane(rig, 'LeftHand'), Right: handPlane(rig, 'RightHand') })
        return breathingKeys(rig, snapshot(rig), { keys }).keys
      }
      const first = await author()
      const second = await author()
      JOINTS.forEach((name, i) => {
        const committed = channel(i, 'rotation').output
        expect(f32Bytes(first[i]).equals(f32Bytes(second[i])), `${id} ${name} identical across two authorings`).toBe(true)
        expect(f32Bytes(first[i]).equals(Buffer.from(committed.buffer, committed.byteOffset, committed.byteLength)), `${id} ${name} equals the committed keys`).toBe(true)
      })
    }
  })

  it('at Idle t=0 the arms hang with a soft elbow below the shoulder line, and the lower body is exactly where it was', async () => {
    for (const id of BODIES) {
      const { bytes, channel } = await committedIdle(id)
      const keyAt = (rotationOf: (i: number, name: string) => number[]) => (i: number) => ({
        translation: Array.from(channel(i, 'translation').output.slice(0, 3)),
        scale: Array.from(channel(i, 'scale').output.slice(0, 3)),
        rotation: rotationOf(i, JOINTS[i]),
      })
      const after = await loadRig(bytes, id)
      applyKeys(after, keyAt((i) => Array.from(channel(i, 'rotation').output.slice(0, 4))))
      const before = await loadRig(bytes, id)
      applyKeys(before, keyAt((i, name) => (AUTHORED_JOINTS.includes(name) ? PRE[id].authoredOriginal[name] : Array.from(channel(i, 'rotation').output.slice(0, 4)))))
      for (const side of ['Left', 'Right']) {
        const S = worldPos(after, `${side}Arm`), E = worldPos(after, `${side}ForeArm`), W = worldPos(after, `${side}Hand`)
        const bend = (E.clone().sub(S).angleTo(W.clone().sub(E)) * 180) / Math.PI
        const bendBefore = (() => {
          const s = worldPos(before, `${side}Arm`), e = worldPos(before, `${side}ForeArm`), w = worldPos(before, `${side}Hand`)
          return (e.clone().sub(s).angleTo(w.clone().sub(e)) * 180) / Math.PI
        })()
        expect(bendBefore, `${id} ${side} original raised elbow`).toBeGreaterThan(70)
        expect(bend, `${id} ${side} elbow is soft`).toBeLessThan(30)
        expect(W.y, `${id} ${side} wrist below the elbow`).toBeLessThan(E.y)
        expect(E.y, `${id} ${side} elbow below the shoulder`).toBeLessThan(S.y)
      }
      for (const joint of LOWER_BODY) {
        expect(worldPos(after, joint).distanceTo(worldPos(before, joint)), `${id} ${joint} unmoved`).toBeLessThan(1e-9)
      }
    }
  })

  it('the invariance digests really see material IOR and texture sampling: in-memory edits are detected and restores match', async () => {
    // Guards the digest itself. An earlier version hashed extensions with JSON.stringify (no IOR value) and never
    // hashed TextureInfo/sampler state, so these edits left EVERY digest unchanged.
    const { doc } = await committedIdle('blocklife_maya_01')
    const material = doc.getRoot().listMaterials()[0]
    const ior = material.getExtension('KHR_materials_ior') as unknown as { getIOR(): number; setIOR(v: number): unknown } | null
    const info = material.getBaseColorTextureInfo()
    expect(ior, 'Maya declares KHR_materials_ior on her material').toBeTruthy()
    expect(info, 'Maya has a base-colour texture info').toBeTruthy()
    const all = () => JSON.stringify(idleInvarianceDigests(doc))
    const sampling = () => idleInvarianceDigests(doc).materialSampling
    const before = all()
    const samplingBefore = sampling()
    const cases: Array<[string, () => unknown, (saved: unknown) => unknown]> = [
      ['IOR 1.45 -> 1.1', () => { const v = ior!.getIOR(); ior!.setIOR(1.1); return v }, (v) => ior!.setIOR(v as number)],
      ['wrapS -> CLAMP_TO_EDGE', () => { const v = info!.getWrapS(); info!.setWrapS(33071); return v }, (v) => info!.setWrapS(v as 33071)],
      ['wrapT -> MIRRORED_REPEAT', () => { const v = info!.getWrapT(); info!.setWrapT(33648); return v }, (v) => info!.setWrapT(v as 33648)],
      ['minFilter -> NEAREST', () => { const v = info!.getMinFilter(); info!.setMinFilter(9728); return v }, (v) => info!.setMinFilter(v as 9728)],
      ['magFilter -> NEAREST', () => { const v = info!.getMagFilter(); info!.setMagFilter(9728); return v }, (v) => info!.setMagFilter(v as 9728)],
      ['texCoord -> 1', () => { const v = info!.getTexCoord(); info!.setTexCoord(1); return v }, (v) => info!.setTexCoord(v as number)],
    ]
    for (const [name, mutate, restore] of cases) {
      const saved = mutate()
      expect.soft(all(), `${name} changes the decoded digests`).not.toBe(before)
      expect.soft(sampling(), `${name} changes the materialSampling digest specifically`).not.toBe(samplingBefore)
      restore(saved)
      expect.soft(all(), `${name} restored`).toBe(before)
    }
  })
})
