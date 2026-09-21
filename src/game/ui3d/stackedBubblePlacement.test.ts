import { describe, expect, it } from 'vitest'
import { placeStackedBubble, type StackedBubbleInput } from './stackedBubblePlacement'
import {
  NPC_BUBBLE_LINE_HEIGHT,
  NPC_BUBBLE_MAX_HEIGHT,
  NPC_BUBBLE_MAX_LINES,
  NPC_BUBBLE_PADDING_Y,
  NPC_BUBBLE_TAIL_HEIGHT,
  NPC_NAME_PLATE_HEIGHT,
  NPC_PLATE_MAX_HALF_WIDTH,
  NPC_QUEST_MARKER_BOUNCE,
  NPC_QUEST_MARKER_HEIGHT,
  NPC_QUEST_MARKER_OFFSET,
  NPC_SPEECH_BUBBLE_OFFSET,
  NPC_STACK_GAP,
} from './npcLabelStack'

/**
 * The composed behaviour: viewport clamp AND plate stack together, through the same function
 * `SpeechBubble` calls. The slot arithmetic alone could not catch this — the clamp is what breaks
 * it. Reported case, and the one pinned first below: the speaker's head projects at y = 130 px, so
 * the bubble wants its bottom at 64, its box would start above the screen, and the clamp pushes it
 * down onto the marker, which at the top of its bounce owns 73 → 100.
 *
 * Everything here is the ONE quest NPC's geometry — a speaker carrying a name plate AND a bouncing
 * marker — at every wrapped bubble height and every bounce phase.
 */

const VIEWPORT = { viewportWidth: 1280, viewportHeight: 720 }
const MARGIN = 14
const HALF_WIDTH = 92
/** Top of the band the plates own, at the WORST moment of the marker's bounce. */
const BAND_TOP = NPC_QUEST_MARKER_OFFSET + NPC_QUEST_MARKER_HEIGHT + NPC_QUEST_MARKER_BOUNCE // 57

function place(anchorY: number, height: number, anchorX = 640): ReturnType<typeof placeStackedBubble> {
  const input: StackedBubbleInput = {
    anchorX,
    anchorY,
    ...VIEWPORT,
    margin: MARGIN,
    halfWidth: HALF_WIDTH,
    height,
    slotBottom: NPC_SPEECH_BUBBLE_OFFSET,
    tail: NPC_BUBBLE_TAIL_HEIGHT,
    plateBandTop: BAND_TOP,
    plateBandBottom: 0,
    plateHalfWidth: NPC_PLATE_MAX_HALF_WIDTH,
    gap: NPC_STACK_GAP,
    onScreen: true,
  }
  return placeStackedBubble(input)
}

/** Do the bubble (box + tail) and a plate band centred on the anchor actually intersect? */
function intersectsPlates(
  p: ReturnType<typeof placeStackedBubble>,
  anchorX: number,
  anchorY: number,
  height: number,
  bandTopOffset: number,
  bandBottomOffset: number,
): boolean {
  const boxTop = p.bottomY - height
  const tailTip = p.bottomY + NPC_BUBBLE_TAIL_HEIGHT
  const bandTop = anchorY - bandTopOffset
  const bandBottom = anchorY - bandBottomOffset
  const vertical = tailTip > bandTop && boxTop < bandBottom
  const horizontal = Math.abs(p.x - anchorX) < HALF_WIDTH + NPC_PLATE_MAX_HALF_WIDTH
  return vertical && horizontal
}

describe('speech bubble placement, clamp and stack composed', () => {
  it('reproduces the reported top-edge case and resolves it', () => {
    const anchorY = 130
    // The defect, shown on the geometry that produced it: the clamp pushes the drawn element down
    // so its tail tip lands inside the marker's bounce band (73 → 100).
    const bottomWithoutStepAside = MARGIN + NPC_BUBBLE_MAX_HEIGHT // 83 — the clamp's answer
    expect(bottomWithoutStepAside + NPC_BUBBLE_TAIL_HEIGHT).toBe(89)
    expect(anchorY - BAND_TOP).toBe(73)
    expect(89).toBeGreaterThan(73) // …i.e. through the marker, which is the bug.

    const p = place(anchorY, NPC_BUBBLE_MAX_HEIGHT)
    expect(p.hidden).toBe(false)
    expect(p.movedAside, 'the bubble steps aside rather than through the marker').toBe(true)
    expect(intersectsPlates(p, 640, anchorY, NPC_BUBBLE_MAX_HEIGHT, BAND_TOP, 0)).toBe(false)
    // Still fully on screen and still readable — not clipped, not hidden.
    expect(p.x - HALF_WIDTH).toBeGreaterThanOrEqual(MARGIN)
    expect(p.x + HALF_WIDTH).toBeLessThanOrEqual(VIEWPORT.viewportWidth - MARGIN)
    expect(p.bottomY - NPC_BUBBLE_MAX_HEIGHT).toBeGreaterThanOrEqual(MARGIN)
  })

  it('never crosses the plates, at every wrapped height and every bounce phase', () => {
    let stepped = 0
    let normal = 0
    for (let lines = 1; lines <= NPC_BUBBLE_MAX_LINES; lines++) {
      const height = Math.ceil(NPC_BUBBLE_LINE_HEIGHT * lines + NPC_BUBBLE_PADDING_Y)
      // Every speaker height on screen, including well above the top edge and near the bottom.
      for (let anchorY = -60; anchorY <= 760; anchorY += 5) {
        for (let bounce = 0; bounce <= NPC_QUEST_MARKER_BOUNCE; bounce++) {
          const bandTop = NPC_QUEST_MARKER_OFFSET + NPC_QUEST_MARKER_HEIGHT + bounce
          const p = place(anchorY, height)
          if (p.hidden) continue
          p.movedAside ? stepped++ : normal++
          expect(
            intersectsPlates(p, 640, anchorY, height, bandTop, 0),
            `${lines}-line bark, head at y=${anchorY}, marker +${bounce}px`,
          ).toBe(false)
        }
      }
    }
    // Non-vacuous: the sweep must exercise BOTH the ordinary path and the step-aside fallback.
    expect(normal, 'ordinary placements').toBeGreaterThan(0)
    expect(stepped, 'placements that had to step aside').toBeGreaterThan(0)
  })

  it('steps to the side that has room when the speaker is against a screen edge', () => {
    // Far right: stepping right would leave the viewport, so it must go left and stay inside.
    const p = place(130, NPC_BUBBLE_MAX_HEIGHT, VIEWPORT.viewportWidth - 40)
    expect(p.movedAside).toBe(true)
    expect(p.x + HALF_WIDTH).toBeLessThanOrEqual(VIEWPORT.viewportWidth - MARGIN)
    expect(p.x - HALF_WIDTH).toBeGreaterThanOrEqual(MARGIN)
  })

  it('leaves the ordinary case alone: in open ground the bubble keeps its slot', () => {
    const anchorY = 400
    const p = place(anchorY, NPC_BUBBLE_MAX_HEIGHT)
    expect(p.movedAside).toBe(false)
    expect(p.x).toBe(640)
    // Bottom exactly at the slot, tail three pixels clear of the marker at full bounce.
    expect(p.bottomY).toBe(anchorY - NPC_SPEECH_BUBBLE_OFFSET)
    expect(p.bottomY + NPC_BUBBLE_TAIL_HEIGHT).toBe(anchorY - BAND_TOP - NPC_STACK_GAP)
    expect(NPC_SPEECH_BUBBLE_OFFSET).toBeGreaterThan(NPC_NAME_PLATE_HEIGHT)
  })
})
