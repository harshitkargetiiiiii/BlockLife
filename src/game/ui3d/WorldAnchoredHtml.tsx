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

export interface AnchorPlacementInput {
  /** Projected anchor in screen pixels, before any offset. */
  anchorX: number
  anchorY: number
  viewportWidth: number
  viewportHeight: number
  onScreen: boolean
}

function makeClampedPosition(
  halfWidth: number,
  halfHeight: number,
  margin: number,
  place: ((a: AnchorPlacementInput) => { x: number; y: number; hidden: boolean }) | null,
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
    const anchorY = -(_world.y * heightHalf) + heightHalf
    // A caller with its own constraints (the NPC plate stack) resolves the point itself; it gets
    // the raw projected anchor, because it needs to reason about where the other plates are.
    if (place) {
      const p = place({
        anchorX,
        anchorY,
        viewportWidth: size.width,
        viewportHeight: size.height,
        onScreen,
      })
      return p.hidden ? OFFSCREEN : [p.x, p.y]
    }
    const r = clampToViewport({
      anchorX,
      anchorY,
      viewportWidth: size.width,
      viewportHeight: size.height,
      halfWidth,
      halfHeight,
      margin,
      onScreen,
    })
    return r.hidden ? OFFSCREEN : [r.x, r.y]
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
  /**
   * Resolve the screen point from the raw projected anchor. Use when containment is not the only
   * constraint — the speech bubble also has to stay clear of the NPC's other plates, which the
   * generic clamp knows nothing about.
   */
  place?: (a: AnchorPlacementInput) => { x: number; y: number; hidden: boolean }
  zIndexRange?: [number, number]
  testGroupName?: string
}

export function WorldAnchoredHtml({
  children,
  offset = 0,
  halfWidth = 80,
  halfHeight = 26,
  margin = 14,
  place,
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
      calculatePosition={makeClampedPosition(halfWidth, halfHeight, margin, place ?? null)}
    >
      {children}
    </Html>
  )
}
