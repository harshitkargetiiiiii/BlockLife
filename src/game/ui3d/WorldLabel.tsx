import { Html } from '@react-three/drei'

// drei's <Html> portals into the real DOM, which the R3F test renderer can't
// host. Under Vitest we render a named group instead so tests can still
// assert that a label exists.
const IS_VITEST = Boolean(
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VITEST,
)

export interface WorldLabelProps {
  text: string
  className?: string
  /** Vertical offset in world units. */
  offset?: number
  icon?: string
}

/**
 * A screen-space text chip anchored to a world position. Building/district
 * labels are authored at fixed, comfortably on-screen positions, so they render
 * with plain projection (the issue requires comfortably on-screen labels stay
 * visually unchanged). The dynamic, edge-prone case — NPC speech bubbles above
 * moving actors — is what routes through the viewport-clamped WorldAnchoredHtml
 * (see SpeechBubble). World-label clamping remains available via that component
 * for any future world-space UI that needs it.
 */
export function WorldLabel({ text, className, offset = 0, icon }: WorldLabelProps) {
  if (IS_VITEST) {
    return <group name={`world-label:${text}`} />
  }
  return (
    <Html position={[0, offset, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`world-label ${className ?? ''}`}>
        {icon ? <span className="world-label-icon">{icon}</span> : null}
        {text}
      </div>
    </Html>
  )
}
