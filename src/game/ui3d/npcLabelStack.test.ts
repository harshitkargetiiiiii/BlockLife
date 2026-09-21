import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NPC_BUBBLE_LINE_HEIGHT,
  NPC_BUBBLE_MAX_HEIGHT,
  NPC_BUBBLE_MAX_LINES,
  NPC_BUBBLE_PADDING_Y,
  NPC_BUBBLE_TAIL_HEIGHT,
  NPC_NAME_PLATE_HEIGHT,
  NPC_QUEST_MARKER_BOUNCE,
  NPC_QUEST_MARKER_HEIGHT,
  NPC_QUEST_MARKER_OFFSET,
  NPC_SPEECH_BUBBLE_OFFSET,
  NPC_STACK_GAP,
} from './npcLabelStack'
import { clampToViewport } from '../world/integrity/viewportClamp'

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

  it('gives every plate its own slot over the supported envelope', () => {
    expect(NPC_QUEST_MARKER_OFFSET).toBe(NPC_NAME_PLATE_HEIGHT + NPC_STACK_GAP)
    // The bubble must clear the marker at the TOP of its bounce, and its TAIL hangs below its box.
    const markerTopAtBounce = NPC_QUEST_MARKER_OFFSET + NPC_QUEST_MARKER_HEIGHT + NPC_QUEST_MARKER_BOUNCE
    expect(markerTopAtBounce).toBe(57)
    expect(NPC_SPEECH_BUBBLE_OFFSET - NPC_BUBBLE_TAIL_HEIGHT).toBe(markerTopAtBounce + NPC_STACK_GAP)
  })

  /**
   * The case the arithmetic-only version missed: on the ONE NPC that carries a quest marker AND
   * barks, a two-line bubble used to be centred on a guessed half-height, so its bottom — and the
   * tail below it — dropped into the marker's bounce. The bubble is pinned by its bottom edge now,
   * so this walks the whole supported envelope: every wrapped height against every bounce phase.
   */
  it('a wrapped bark on the quest NPC clears the bouncing marker at every phase', () => {
    for (let lines = 1; lines <= NPC_BUBBLE_MAX_LINES; lines++) {
      const boxHeight = NPC_BUBBLE_LINE_HEIGHT * lines + NPC_BUBBLE_PADDING_Y
      expect(boxHeight, `${lines} lines within the supported envelope`).toBeLessThanOrEqual(
        NPC_BUBBLE_MAX_HEIGHT,
      )
      // Pinned by the bottom: the box occupies [offset, offset + height], the tail hangs below it.
      const tailTip = NPC_SPEECH_BUBBLE_OFFSET - NPC_BUBBLE_TAIL_HEIGHT
      for (let bounce = 0; bounce <= NPC_QUEST_MARKER_BOUNCE; bounce++) {
        const markerTop = NPC_QUEST_MARKER_OFFSET + NPC_QUEST_MARKER_HEIGHT + bounce
        expect(
          tailTip,
          `${lines}-line bark, marker at +${bounce}px of its bounce`,
        ).toBeGreaterThanOrEqual(markerTop + NPC_STACK_GAP)
      }
      // …and the box itself never reaches down to the name plate either.
      expect(NPC_SPEECH_BUBBLE_OFFSET).toBeGreaterThan(NPC_NAME_PLATE_HEIGHT)
    }
  })

  it('keeps a full-height bubble on screen when the speaker is at the top edge', () => {
    // Bottom-pinned: the clamp is fed the centre implied by the supported height, so the check is
    // that the whole box — not a 26px guess — stays inside the margin at the worst anchor.
    const margin = 14
    const half = NPC_BUBBLE_MAX_HEIGHT / 2
    for (const anchorY of [-40, 0, 12, 30]) {
      const r = clampToViewport({
        anchorX: 640,
        anchorY: anchorY - half,
        viewportWidth: 1280,
        viewportHeight: 720,
        halfWidth: 92,
        halfHeight: half,
        margin,
        onScreen: true,
      })
      if (r.hidden) continue
      const bottom = r.y + half
      const top = bottom - NPC_BUBBLE_MAX_HEIGHT
      expect(top, `top edge at anchorY=${anchorY}`).toBeGreaterThanOrEqual(margin)
      expect(bottom, `bottom edge at anchorY=${anchorY}`).toBeLessThanOrEqual(720 - margin)
    }
  })

  it('the CSS bounce and tail match the reservations the stack makes for them', () => {
    const frames = css.slice(css.indexOf('@keyframes quest-bounce'))
    const bounce = /var\(--quest-marker-stack-y, 0px\) - (\d+)px/.exec(frames)?.[1]
    expect(Number(bounce), 'the reserved bounce equals the animated one').toBe(NPC_QUEST_MARKER_BOUNCE)
    const tail = /\.speech-bubble::after \{[^}]*bottom:\s*-(\d+)px/s.exec(css)?.[1]
    expect(Number(tail), 'the reserved tail equals the rendered one').toBe(NPC_BUBBLE_TAIL_HEIGHT)
    expect(block('.speech-bubble-anchor'), 'the bubble is pinned by its bottom edge').toMatch(
      /transform:\s*translateY\(-50%\)/,
    )
  })

  it('the CSS marker offset matches the module the bubble positions itself from', () => {
    // The marker's offset has to live in CSS (an animation drives its transform) and the bubble's
    // in TS (it is positioned through the viewport clamp). They describe ONE stack, so a drift
    // between them would silently reintroduce an overlap.
    const marker = block('.world-label.quest-marker')
    const px = /--quest-marker-stack-y:\s*calc\(-100% - (\d+)px\)/.exec(marker)?.[1]
    expect(px, 'the marker offset is declared in game.css').toBeDefined()
    expect(Number(px)).toBe(NPC_QUEST_MARKER_OFFSET)
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
