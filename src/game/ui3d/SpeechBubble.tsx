import { WorldAnchoredHtml } from './WorldAnchoredHtml'
import {
  NPC_BUBBLE_MAX_HEIGHT,
  NPC_LABEL_ANCHOR_Y,
  NPC_SPEECH_BUBBLE_OFFSET,
} from './npcLabelStack'

/**
 * A small comic-style speech bubble floating above an NPC's head. Routed through
 * the shared viewport-clamped world-UI layer so it stays on-screen near edges
 * (issue §9). Test-mode stub name is preserved for existing component tests.
 */
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
      // Same head anchor as the name plate and the quest marker. The offset is the BOX's bottom
      // edge, pinned — wrapped text grows upward, so a two-line bark cannot push the tail back
      // down into the quest marker's bounce. The clamp is told both the offset and the supported
      // height, so an edge-of-screen bubble is kept inside the viewport where it is really drawn.
      screenOffsetY={NPC_SPEECH_BUBBLE_OFFSET}
      pinBottomHeight={NPC_BUBBLE_MAX_HEIGHT}
      halfWidth={92}
      zIndexRange={[50, 0]}
      testGroupName={`speech-bubble:${text}`}
    >
      <div className="speech-bubble-anchor">
        <div className="speech-bubble">{text}</div>
      </div>
    </WorldAnchoredHtml>
  )
}
