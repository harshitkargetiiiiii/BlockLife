// @vitest-environment node
// (GLTFLoader.parse reads the GLB binary chunks; jsdom mis-handles that, node matches the CLI.)
import { describe, expect, it } from 'vitest'
import { inspect } from '../../../scripts/human-proof/inspectRig.mjs'

/**
 * Human Visual Gold Standard v1 — H0 technical proof contract (issue #27).
 *
 * Locks the skeleton findings the animation architecture depends on, against the two committed
 * 24-bone bodies. These are the CORRECTED validation rules: the hierarchy signature must match
 * EXACTLY (bones/parents/topology), while body rest-pose data MAY differ per body (proportions
 * are retarget input, never a rejection reason). Also asserts the skinning is production-grade
 * (smooth, no invalid weights) — unlike the 7-bone fallback rig's rigid weight-1.0 binding.
 */
const MALE = 'public/assets/models/characters/blocklife_male_01.glb'
const FEMALE = 'public/assets/models/characters/blocklife_female_01.glb'

describe('issue #27 H0 — 24-bone canonical rig contract', () => {
  it('both bodies share the EXACT hierarchy signature (retarget-compatible topology)', async () => {
    const [m, f] = await Promise.all([inspect(MALE), inspect(FEMALE)])
    expect(m.bones).toBe(24)
    expect(f.bones).toBe(24)
    expect(m.hierarchySignature).toBe(f.hierarchySignature)
  })

  it('body rest-pose data DIFFERS by proportion (input to retargeting, not a rejection)', async () => {
    const [m, f] = await Promise.all([inspect(MALE), inspect(FEMALE)])
    let maxDelta = 0
    for (let i = 0; i < m.restTransforms.length; i++)
      for (let k = 0; k < 3; k++) maxDelta = Math.max(maxDelta, Math.abs(m.restTransforms[i].t[k] - f.restTransforms[i].t[k]))
    expect(maxDelta).toBeGreaterThan(1) // tall/broad vs slim bodies naturally differ
  })

  it('has production-grade smooth skinning (up to 4 influences, no invalid weights)', async () => {
    for (const path of [MALE, FEMALE]) {
      const r = await inspect(path)
      expect(r.skinInfluences.nanVerts).toBe(0)
      expect(r.skinInfluences.zeroWeightVerts).toBe(0)
      expect(r.skinInfluences.maxPerVertex).toBeGreaterThan(1) // NOT the 7-bone rigid weight-1.0
      expect(r.skinInfluences.maxPerVertex).toBeLessThanOrEqual(4)
      expect(r.groundedBounds.baseAtGround).toBe(true)
    }
  })

  it('required semantic joints exist by name (knees, elbows, neck, feet, hands)', async () => {
    const m = await inspect(MALE)
    const names = new Set(m.restTransforms.map((b) => b.name))
    for (const required of ['Hips', 'Spine', 'neck', 'Head', 'LeftLeg', 'RightLeg', 'LeftForeArm', 'RightForeArm', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand'])
      expect(names.has(required), `missing canonical joint ${required}`).toBe(true)
  })
})
