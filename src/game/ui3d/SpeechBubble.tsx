import { WorldAnchoredHtml } from './WorldAnchoredHtml'

/**
 * A small comic-style speech bubble floating above an NPC's head. Routed through
 * the shared viewport-clamped world-UI layer so it stays on-screen near edges
 * (issue §9). Test-mode stub name is preserved for existing component tests.
 */
export function SpeechBubble({ text, offset = 2.6 }: { text: string; offset?: number }) {
  return (
    <WorldAnchoredHtml
      offset={offset}
      halfWidth={92}
      halfHeight={26}
      zIndexRange={[50, 0]}
      testGroupName={`speech-bubble:${text}`}
    >
      <div className="speech-bubble">{text}</div>
    </WorldAnchoredHtml>
  )
}
