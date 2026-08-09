import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stableUnit, hashString } from '../traffic/routing/routeRng'

/**
 * Issue #23 (PR #24 review, blocking-4): the ambient citizen + named NPC speech
 * "barks" were the last `Math.random` visual-nondeterminism source — they made the
 * visual suite flaky (a bark could be mid-display at screenshot time). This pins the
 * fix so it can't regress:
 *  - bark selection + timing is seeded (`stableUnit`, keyed by id:purpose:ordinal),
 *    never `Math.random`, so it is deterministic and clock-independent;
 *  - barks never RENDER while the world is paused (the screenshot state), so a
 *    captured frame is reproducible regardless of pause→clear timing.
 */
// Repo-relative (vitest runs from the repo root) — avoids file-URL scheme issues.
const citizenSrc = readFileSync('src/game/citizens/AmbientCitizens.tsx', 'utf8')
const npcSrc = readFileSync('src/game/npc/NPC.tsx', 'utf8')

describe('bark determinism (issue #23 / PR #24 blocking-4)', () => {
  it('stableUnit is deterministic, clock-independent, and in [0, 1)', () => {
    for (const key of ['cit_a:bark:3', 'npc_ravi_01:wave:7', 'x']) {
      const v = stableUnit(key)
      expect(v).toBe(stableUnit(key)) // same key → same value, always
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    // Different keys spread out (not a constant).
    const spread = new Set(Array.from({ length: 50 }, (_, i) => stableUnit('k:' + i)))
    expect(spread.size).toBeGreaterThan(40)
  })

  it('a seeded bark line pick is stable per (id, ordinal)', () => {
    const lines = ['a', 'b', 'c', 'd']
    const pick = (id: string, n: number) => lines[hashString(id + ':barkline:' + n) % lines.length]
    expect(pick('cit_x', 5)).toBe(pick('cit_x', 5))
    // Across a population + ordinals, more than one line is actually used.
    const used = new Set<string>()
    for (let n = 1; n < 12; n++) for (const id of ['a', 'b', 'c']) used.add(pick(id, n))
    expect(used.size).toBeGreaterThan(1)
  })

  it('the ambient-citizen sim carries NO Math.random', () => {
    expect(citizenSrc.includes('Math.random')).toBe(false)
  })

  it('the named-NPC sim carries NO Math.random', () => {
    expect(npcSrc.includes('Math.random')).toBe(false)
  })

  it('barks are gated behind !worldPaused at the render site (deterministic capture)', () => {
    // The SpeechBubble render must be guarded so a paused (screenshot) frame never
    // shows a bark, regardless of when the pause-snap clears the state.
    expect(/bubble && !worldPaused && <SpeechBubble/.test(citizenSrc)).toBe(true)
    expect(/bubble && !worldPaused && <SpeechBubble/.test(npcSrc)).toBe(true)
  })
})
