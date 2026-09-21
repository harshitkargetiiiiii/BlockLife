import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The NPC name plate and the quest marker share ONE world anchor (the head top, `NPC_LABEL_ANCHOR_Y`
 * in `npc/NPC.tsx`) and are stacked in screen space by these rules. World-space offsets cannot do
 * that job: the camera zoom is not fixed — the wheel adjusts it and the driving/interior mode zoom
 * widens it — so a world gap between two fixed-pixel plates buys a different number of pixels at
 * every zoom. The shipped offsets (name 2.15, marker 2.9) bought 14 px at the default zoom for
 * plates 19 px and 27 px tall: measured on 2026-09-21, the marker covered the name and the name sat
 * on the head.
 *
 * The sharper half of that defect was the bounce: a CSS animation outranks a normal declaration, so
 * `quest-bounce`'s `transform` REPLACED the shared `.world-label` centering and dropped the marker
 * onto the head. Any future animation on a stacked label must compose with the offset rather than
 * overwrite it, which is what the custom property is for.
 */
const css = readFileSync(join(process.cwd(), 'src/styles/game.css'), 'utf8')

function block(selector: string): string {
  const at = css.indexOf(selector + ' {')
  expect(at, `${selector} is missing from game.css`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('NPC world-label stack', () => {
  it('centres an ordinary world label on its anchor', () => {
    // Building signs and interactable markers still rely on this.
    expect(block('.world-label')).toMatch(/transform:\s*translateY\(-50%\)/)
  })

  it('lifts the name plate fully above the anchor, so it never covers the head', () => {
    expect(block('.world-label.npc-name')).toMatch(/transform:\s*translateY\(-100%\)/)
  })

  it('stacks the quest marker above the name plate through a shared custom property', () => {
    const marker = block('.world-label.quest-marker')
    expect(marker).toMatch(/--quest-marker-stack-y:\s*calc\(-100% - \d+px\)/)
    expect(marker).toMatch(/transform:\s*translateY\(var\(--quest-marker-stack-y\)\)/)
  })

  it('keeps the bounce composed with the stack offset instead of replacing it', () => {
    const at = css.indexOf('@keyframes quest-bounce')
    expect(at, 'quest-bounce keyframes are missing').toBeGreaterThan(-1)
    const frames = css.slice(at, css.indexOf('\n}', at))
    const transforms = [...frames.matchAll(/transform:\s*([^;]+);/g)].map((m) => m[1])
    expect(transforms.length, 'both keyframe stops should move the marker').toBe(2)
    for (const t of transforms) {
      expect(t, `"${t}" drops the stack offset, which puts the marker back on the head`).toContain(
        'var(--quest-marker-stack-y',
      )
    }
  })
})
