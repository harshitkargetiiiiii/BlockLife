import { clampToViewport } from '../world/integrity/viewportClamp'

/**
 * Where a speech bubble goes once the viewport clamp and the NPC plate stack BOTH get a say.
 *
 * Pinning the bubble's bottom edge keeps a wrapped bark out of the quest marker in open ground, but
 * it says nothing about the screen edge. Concretely, with the head projecting at y = 130 px: the
 * bubble wants its bottom at 130 − 66 = 64, its 69 px box would start at −5, so the clamp pushes it
 * down to a bottom of 83 with its tail tip at 89 — while the marker, at the top of its bounce,
 * occupies 73 → 100. The clamp had done its job (the bubble is on screen) and still put the bubble
 * through the marker, because containment and separation are different constraints.
 *
 * So when the clamp forces the bubble into the plates' band, it steps ASIDE rather than down:
 * horizontally clear of the plates, on whichever side has room. Both stay fully readable, which
 * clipping the text or hiding the marker would not.
 *
 * Screen coordinates, y growing downward. Everything here is pure so the composed behaviour —
 * clamp AND stack, not one or the other — can be tested at the exact geometry above.
 */
export interface StackedBubblePlacement {
  /** Centre of the bubble box horizontally. */
  x: number
  /** Bottom edge of the bubble box (its tail hangs `tail` px below this). */
  bottomY: number
  hidden: boolean
  /** True when the bubble had to step aside to stay clear of the plates. */
  movedAside: boolean
}

export interface StackedBubbleInput {
  /** Projected anchor: the top of the speaker's head. */
  anchorX: number
  anchorY: number
  viewportWidth: number
  viewportHeight: number
  margin: number
  /** Half the bubble box's width, and the height it is allowed to occupy. */
  halfWidth: number
  height: number
  /** Bubble box's bottom edge, in px above the anchor, and the tail hanging below it. */
  slotBottom: number
  tail: number
  /** The plate band to keep clear, in px above the anchor (marker top at bounce → name bottom). */
  plateBandTop: number
  plateBandBottom: number
  /** Bounded half-width of the widest plate in that band. */
  plateHalfWidth: number
  gap: number
  onScreen: boolean
}

export function placeStackedBubble(i: StackedBubbleInput): StackedBubblePlacement {
  const half = i.height / 2
  // The shipped clamp works in centres; feed it the centre this bottom edge implies, including the
  // tail, so the whole drawn element is what gets kept on screen.
  const drawnHalf = (i.height + i.tail) / 2
  const desiredBottom = i.anchorY - i.slotBottom
  // The drawn element spans [bottom - height, bottom + tail], so its centre is half a box above
  // the bottom and half a tail below it.
  const drawnCentre = desiredBottom - half + i.tail / 2
  const r = clampToViewport({
    anchorX: i.anchorX,
    anchorY: drawnCentre,
    viewportWidth: i.viewportWidth,
    viewportHeight: i.viewportHeight,
    halfWidth: i.halfWidth,
    halfHeight: drawnHalf,
    margin: i.margin,
    onScreen: i.onScreen,
  })
  if (r.hidden) return { x: r.x, bottomY: r.y, hidden: true, movedAside: false }

  const bottomY = r.y + half - i.tail / 2
  const boxTop = bottomY - i.height
  const tailTip = bottomY + i.tail

  // Does the drawn element now cross the band the plates own, directly over the speaker?
  const bandTop = i.anchorY - i.plateBandTop
  const bandBottom = i.anchorY - i.plateBandBottom
  const verticalOverlap = tailTip > bandTop && boxTop < bandBottom
  const horizontalOverlap =
    Math.abs(r.x - i.anchorX) < i.halfWidth + i.plateHalfWidth
  if (!verticalOverlap || !horizontalOverlap) {
    return { x: r.x, bottomY, hidden: false, movedAside: false }
  }

  // Step aside, preferring the side with room, and stay inside the margin either way.
  const shift = i.halfWidth + i.plateHalfWidth + i.gap
  const right = i.anchorX + shift
  const left = i.anchorX - shift
  const fitsRight = right + i.halfWidth <= i.viewportWidth - i.margin
  const x = fitsRight ? right : left
  const clampedX = Math.min(
    Math.max(x, i.margin + i.halfWidth),
    i.viewportWidth - i.margin - i.halfWidth,
  )
  return { x: clampedX, bottomY, hidden: false, movedAside: true }
}
