// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { inspect } from '../../../scripts/human-proof/inspectRig.mjs'

/**
 * Issue #27 H0 — deterministic contract for the committed REVIEW calibration GLB
 * (dev-review-assets/, outside public/, absent from dist/). Proves the asset the review harness
 * loads is a well-formed 24-bone canonical human with the intended 5 embedded clips, smooth finite
 * skinning, and correct grounding — the offline half of the B4 review gate (the runtime half lives
 * in tests/human-proof/h0Review.spec.ts). Skips only if the committed GLB is somehow absent.
 */
const GLB = 'dev-review-assets/human_gold_calibration_01.glb'

describe('H0 calibration review GLB contract (issue #27)', () => {
  it.skipIf(!existsSync(GLB))('is a 24-bone canonical rig with the 5 embedded clips and clean skinning', async () => {
    const d = await inspect(GLB)
    // Canonical skeleton (matches the H0-proof signature).
    expect(d.bones).toBe(24)
    expect(d.hierarchySignature).toBe('c432d433d51d')
    expect(d.bindMatrices).toBe(24)
    // Smooth, finite skinning — no NaN, no zero-weight vertices, ≤4 influences.
    expect(d.skinInfluences.maxPerVertex).toBeLessThanOrEqual(4)
    expect(d.skinInfluences.zeroWeightVerts).toBe(0)
    expect(d.skinInfluences.nanVerts).toBe(0)
    // Grounded, human-scaled (feet at y=0, ~1.75 m tall).
    expect(d.groundedBounds.baseAtGround).toBe(true)
    expect(d.groundedBounds.size[1]).toBeGreaterThan(1.6)
    expect(d.groundedBounds.size[1]).toBeLessThan(1.9)
    // Exactly the five intended embedded clips.
    expect(d.clips.map((c) => c.name).sort()).toEqual(['Idle', 'Run', 'Seated', 'Turn', 'Walk'])
    for (const c of d.clips) expect(c.duration).toBeGreaterThan(0)
  })
})
