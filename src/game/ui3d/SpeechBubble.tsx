import { WorldAnchoredHtml } from './WorldAnchoredHtml'
import {
  NPC_BUBBLE_MAX_HEIGHT,
  NPC_BUBBLE_TAIL_HEIGHT,
  NPC_LABEL_ANCHOR_Y,
  NPC_PLATE_MAX_HALF_WIDTH,
  NPC_QUEST_MARKER_BOUNCE,
  NPC_QUEST_MARKER_HEIGHT,
  NPC_QUEST_MARKER_OFFSET,
  NPC_SPEECH_BUBBLE_OFFSET,
  NPC_STACK_GAP,
} from './npcLabelStack'
import { placeStackedBubble } from './stackedBubblePlacement'

const HALF_WIDTH = 92
const MARGIN = 14
/** The band the name plate and the (bouncing) quest marker own, in px above the anchor. */
const PLATE_BAND_TOP = NPC_QUEST_MARKER_OFFSET + NPC_QUEST_MARKER_HEIGHT + NPC_QUEST_MARKER_BOUNCE
const PLATE_BAND_BOTTOM = 0

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
      // Placement is resolved against the whole stack, not just the viewport: the bubble is pinned
      // by its BOTTOM edge so wrapped text grows upward, and if the screen edge forces it back down
      // into the plates' band it steps aside instead of through them.
      place={(a) => {
        const p = placeStackedBubble({
          ...a,
          margin: MARGIN,
          halfWidth: HALF_WIDTH,
          height: NPC_BUBBLE_MAX_HEIGHT,
          slotBottom: NPC_SPEECH_BUBBLE_OFFSET,
          tail: NPC_BUBBLE_TAIL_HEIGHT,
          plateBandTop: PLATE_BAND_TOP,
          plateBandBottom: PLATE_BAND_BOTTOM,
          plateHalfWidth: NPC_PLATE_MAX_HALF_WIDTH,
          gap: NPC_STACK_GAP,
        })
        return { x: p.x, y: p.bottomY, hidden: p.hidden }
      }}
      halfWidth={HALF_WIDTH}
      zIndexRange={[50, 0]}
      testGroupName={`speech-bubble:${text}`}
    >
      <div className="speech-bubble-anchor">
        <div className="speech-bubble">{text}</div>
      </div>
    </WorldAnchoredHtml>
  )
}
