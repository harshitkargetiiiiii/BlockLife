import type { ReactNode } from 'react'
import { Html } from '@react-three/drei'
import type { Camera, Object3D } from 'three'
import { Vector3 } from 'three'
import { clampToViewport } from '../world/integrity/viewportClamp'

/**
 * Shared world-space HTML layer with viewport clamping (issue §9). Every
 * bubble/label routes through here so a projected anchor near a screen edge is
 * kept fully inside a safe margin instead of leaving the viewport (screenshot
 * bug #4). The clamp math is the pure, unit-tested `clampToViewport`; this
 * component only feeds it drei's projected anchor via `calculatePosition`.
 *
 * Under Vitest drei's <Html> can't portal into the R3F test renderer, so we
 * render a named <group> stub (same convention as the old SpeechBubble/WorldLabel)
 * so component tests can still assert a label exists.
 */

const IS_VITEST = Boolean(
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VITEST,
)

const _world = new Vector3()
const _dir = new Vector3()
const _to = new Vector3()

/** Far off-screen sentinel used to hide an anchor that is behind the camera. */
const OFFSCREEN: [number, number] = [-99999, -99999]

function makeClampedPosition(
  halfWidth: number,
  halfHeight: number,
  margin: number,
  screenOffsetY: number,
  pinBottomHeight: number | null,
) {
  return (el: Object3D, camera: Camera, size: { width: number; height: number }): number[] => {
    _world.setFromMatrixPosition(el.matrixWorld)
    // In front of the camera? (works for ortho + perspective)
    camera.getWorldDirection(_dir)
    _to.copy(_world).sub(camera.position)
    const onScreen = _to.dot(_dir) > 0
    // Project to screen pixels (drei's default projection).
    _world.project(camera)
    const widthHalf = size.width / 2
    const heightHalf = size.height / 2
    const anchorX = _world.x * widthHalf + widthHalf
    // Screen-space stack offset, applied BEFORE the clamp so the clamp keeps the element where it
    // is actually drawn. A world offset cannot hold a pixel gap here: the camera zoom changes with
    // the wheel and with the driving/interior mode, so the same world gap buys a different number
    // of pixels at every zoom (see `npc/NPC.tsx`).
    const anchorY = -(_world.y * heightHalf) + heightHalf - screenOffsetY
    // Bottom-pinned elements (the speech bubble) grow UPWARD from the returned point, so the
    // clamp is fed the centre implied by their supported height and the point is converted back.
    // Centring on a guessed half-height instead would move the bottom edge whenever the text
    // wrapped to another line — which is exactly how a two-line bark reached the quest marker.
    const half = pinBottomHeight == null ? halfHeight : pinBottomHeight / 2
    const r = clampToViewport({
      anchorX,
      anchorY: pinBottomHeight == null ? anchorY : anchorY - half,
      viewportWidth: size.width,
      viewportHeight: size.height,
      halfWidth,
      halfHeight: half,
      margin,
      onScreen,
    })
    if (r.hidden) return OFFSCREEN
    return pinBottomHeight == null ? [r.x, r.y] : [r.x, r.y + half]
  }
}

export interface WorldAnchoredHtmlProps {
  children: ReactNode
  /** Vertical world offset above the anchor. */
  offset?: number
  /** Half the rendered element size (kept fully on-screen). */
  halfWidth?: number
  halfHeight?: number
  /** Safe margin from every viewport edge, in pixels. */
  margin?: number
  /** Pixels to lift the element above its projected anchor, included in the clamp. */
  screenOffsetY?: number
  /**
   * Pin the element by its BOTTOM edge instead of its centre, reserving this much height above it
   * for the clamp. Use when the rendered height varies (wrapped text) but the bottom edge must stay
   * in its slot.
   */
  pinBottomHeight?: number
  zIndexRange?: [number, number]
  testGroupName?: string
}

export function WorldAnchoredHtml({
  children,
  offset = 0,
  halfWidth = 80,
  halfHeight = 26,
  margin = 14,
  screenOffsetY = 0,
  pinBottomHeight,
  zIndexRange = [40, 0],
  testGroupName,
}: WorldAnchoredHtmlProps) {
  if (IS_VITEST) {
    return <group name={testGroupName ?? 'world-anchored-html'} />
  }
  return (
    <Html
      position={[0, offset, 0]}
      center
      zIndexRange={zIndexRange}
      style={{ pointerEvents: 'none' }}
      calculatePosition={makeClampedPosition(
        halfWidth,
        halfHeight,
        margin,
        screenOffsetY,
        pinBottomHeight ?? null,
      )}
    >
      {children}
    </Html>
  )
}
