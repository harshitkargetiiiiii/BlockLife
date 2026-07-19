/**
 * Shared world-space UI projection clamp (issue §9). World-space bubbles/labels
 * currently render at their raw projected position and can leave the viewport
 * (screenshot bug #4). This pure helper keeps the element fully inside a safe
 * margin and reports a tail direction back to the true anchor, so a clamped
 * bubble still points at its speaker.
 *
 * Pure + fully unit-testable: the React components (SpeechBubble/WorldLabel)
 * feed it the projected anchor pixel + viewport size and apply the result. No
 * per-frame layout thrash — callers only re-apply when the transform changes.
 */

export interface ClampInput {
  /** Projected anchor position in screen pixels (top-left origin). */
  anchorX: number
  anchorY: number
  viewportWidth: number
  viewportHeight: number
  /** Half the rendered element size (so it stays fully on-screen). */
  halfWidth: number
  halfHeight: number
  /** Safe margin from every edge, in pixels. */
  margin: number
  /** False when the anchor is behind the camera / not projectable. */
  onScreen: boolean
}

export interface ClampResult {
  /** Clamped element centre in pixels. */
  x: number
  y: number
  clampedX: boolean
  clampedY: boolean
  /** Unit direction from the clamped element back toward the true anchor. */
  tailX: number
  tailY: number
  /** True when the anchor is off-screen and the element should hide. */
  hidden: boolean
}

export function clampToViewport(input: ClampInput): ClampResult {
  const { anchorX, anchorY, viewportWidth, viewportHeight, halfWidth, halfHeight, margin } = input

  if (!input.onScreen) {
    return { x: anchorX, y: anchorY, clampedX: false, clampedY: false, tailX: 0, tailY: 0, hidden: true }
  }

  const minX = margin + halfWidth
  const maxX = viewportWidth - margin - halfWidth
  const minY = margin + halfHeight
  const maxY = viewportHeight - margin - halfHeight

  // Degenerate viewport (smaller than the element+margins): centre the element.
  const x = minX > maxX ? viewportWidth / 2 : Math.min(Math.max(anchorX, minX), maxX)
  const y = minY > maxY ? viewportHeight / 2 : Math.min(Math.max(anchorY, minY), maxY)

  const clampedX = x !== anchorX
  const clampedY = y !== anchorY

  // Tail points from the clamped centre toward the real anchor.
  const dx = anchorX - x
  const dy = anchorY - y
  const mag = Math.hypot(dx, dy)
  const tailX = mag > 1e-6 ? dx / mag : 0
  const tailY = mag > 1e-6 ? dy / mag : 0

  return { x, y, clampedX, clampedY, tailX, tailY, hidden: false }
}

/**
 * Horizontal alignment a label should flip to when clamped against an edge, so
 * text grows back toward centre-screen instead of off it.
 */
export function preferredAlignment(result: ClampResult, viewportWidth: number): 'left' | 'center' | 'right' {
  if (!result.clampedX) return 'center'
  return result.x < viewportWidth / 2 ? 'left' : 'right'
}
