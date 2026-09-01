// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Issue #27 H0 — production-bundle boundary guard. Vite copies everything under public/ verbatim
 * into dist/, regardless of .gitignore. Diagnostic / raw-candidate / proof artifacts must therefore
 * live OUTSIDE public/ (in dev-review-assets/, served dev-only). This test fails if any diagnostic
 * leaks back under a production asset root — the regression that shipped 128 MB of _proof/ into dist.
 */
const ROOT = process.cwd()
const PUBLIC_ASSETS = join(ROOT, 'public', 'assets')

function walk(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(p + '/', ...walk(p))
    else out.push(p)
  }
  return out
}

describe('production bundle boundary (issue #27 H0)', () => {
  const entries = walk(PUBLIC_ASSETS)

  it('has no underscore-prefixed diagnostic directories under public/assets', () => {
    const diag = entries.filter((p) => p.endsWith('/') && /\/_[^/]+\/$/.test(p))
    expect(diag, `diagnostic dirs would ship into dist/:\n${diag.join('\n')}`).toEqual([])
  })

  it('has no diagnostic file formats (.fbx) or raw candidates under public/assets', () => {
    const bad = entries.filter((p) => /\.fbx$/i.test(p) || /\/(cand1_|_proof|_control|female_proof|male_proof)/i.test(p))
    expect(bad, `diagnostic files would ship into dist/:\n${bad.join('\n')}`).toEqual([])
  })

  it('keeps the not-yet-approved calibration human OUT of public/ (review-only, absent from dist)', () => {
    const leaked = entries.filter((p) => /human_gold_calibration_01\.glb$/i.test(p))
    expect(leaked, 'the review human must not live under public/').toEqual([])
    // …and it IS present as a committed review asset outside public/.
    expect(existsSync(join(ROOT, 'dev-review-assets', 'human_gold_calibration_01.glb'))).toBe(true)
  })

  it('ships exactly the five approved character rigs under public/', () => {
    const rigs = readdirSync(join(PUBLIC_ASSETS, 'models', 'characters'))
      .filter((f) => f.endsWith('.glb'))
      .sort()
    expect(rigs).toEqual([
      'blocklife_female_01.glb',
      'blocklife_kabir_01.glb', // issue #38 Wave 0 — owner-approved CANDIDATE (DEV review only)
      'blocklife_male_01.glb',
      'blocklife_person.glb',
      'blocklife_ravi_01.glb', // issue #38 Wave 0 — owner-approved CANDIDATE (DEV review only)
    ])
  })
})
