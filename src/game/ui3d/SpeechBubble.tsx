import { WorldAnchoredHtml } from './WorldAnchoredHtml'
import { NPC_LABEL_ANCHOR_Y, NPC_SPEECH_BUBBLE_OFFSET } from './npcLabelStack'

/**
 * A small comic-style speech bubble floating above an NPC's head. Routed through
 * the shared viewport-clamped world-UI layer so it stays on-screen near edges
 * (issue §9). Test-mode stub name is preserved for existing component tests.
 */
const HALF_HEIGHT = 26

export function SpeechBubble({
  text,
  offset = NPC_LABEL_ANCHOR_Y,
}: {
  text: string
  offset?: number
}) {
  return (
    <WorldAnchoredHtml
      offset={offset}
      // Same head anchor as the name plate and the quest marker; the gap that keeps it clear of
      // both is in pixels, and the clamp is told about it so an edge-of-screen bubble is kept
      // inside the viewport where it is actually drawn.
      screenOffsetY={NPC_SPEECH_BUBBLE_OFFSET + HALF_HEIGHT}
      halfWidth={92}
      halfHeight={HALF_HEIGHT}
      zIndexRange={[50, 0]}
      testGroupName={`speech-bubble:${text}`}
    >
      <div className="speech-bubble">{text}</div>
    </WorldAnchoredHtml>
  )
}
