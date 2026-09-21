/**
 * The NPC world-UI stack, in ONE place.
 *
 * Every plate above an NPC hangs off the same world anchor — the top of the head — and the gaps
 * between them are expressed in SCREEN pixels. A world gap cannot hold a pixel gap: the camera zoom
 * is not fixed (the wheel adjusts it, and the driving/interior mode zoom widens it), so the same
 * world distance buys a different number of pixels at every zoom. The shipped offsets (name 2.15,
 * bubble 2.6, marker 2.9) bought 8 px and 14 px at the default zoom for plates 19 px, 52 px and
 * 27 px tall: measured on 2026-09-21, the marker covered the name, the name sat on the head, and a
 * bubble would have covered both.
 *
 * Slots, measured upward from the head anchor, each clearing the one below:
 *
 *   name plate    0 → 19 px
 *   quest marker  22 → 49 px at rest, 30 → 57 px at the top of its bounce
 *   speech bubble tail tip at 60 px, box bottom at 66 px, growing upward
 *
 * The name plate and the quest marker take their offsets from `game.css` (a CSS animation on the
 * marker means the value has to live in a custom property there); this module is the authority the
 * CSS is checked against, and the one the speech bubble — which is positioned in JS, through the
 * viewport clamp — reads directly.
 */

/** World height of the anchor: the top of the head, shared by every approved body (CONVENTIONS #42). */
export const NPC_LABEL_ANCHOR_Y = 2.15

/** Rendered height of the name plate, in CSS pixels. */
export const NPC_NAME_PLATE_HEIGHT = 19
/** Rendered height of the quest marker, in CSS pixels. */
export const NPC_QUEST_MARKER_HEIGHT = 27
/** Gap between two stacked plates, in CSS pixels. */
export const NPC_STACK_GAP = 3

/** Bottom edge of the quest marker, in pixels above the anchor. Mirrored by `game.css`. */
export const NPC_QUEST_MARKER_OFFSET = NPC_NAME_PLATE_HEIGHT + NPC_STACK_GAP // 22

/**
 * How far `quest-bounce` lifts the marker at the top of its travel. The slot has to reserve the
 * WHOLE excursion: the marker's resting top is 49 px above the anchor, but at the upper extreme it
 * reaches 57 px, and a plate parked at 52 px would be overlapped once per bounce cycle.
 */
export const NPC_QUEST_MARKER_BOUNCE = 8

/** The bubble's tail (`.speech-bubble::after`) hangs this far BELOW the bubble's own box. */
export const NPC_BUBBLE_TAIL_HEIGHT = 6

/**
 * The supported bubble envelope. `.speech-bubble` is 13 px at line-height 1.35 with 8 px of padding
 * top and bottom and wraps at 210 px, so a three-line bark is ~69 px tall. The bubble is pinned by
 * its BOTTOM edge, so its height does not move the tail — this bound exists for the viewport clamp,
 * which needs to know how much room to keep above the anchor, and it is what "supported" means: a
 * longer bark than this would still render, but its top could be clipped at the screen edge.
 */
export const NPC_BUBBLE_MAX_LINES = 3
export const NPC_BUBBLE_LINE_HEIGHT = 13 * 1.35
export const NPC_BUBBLE_PADDING_Y = 16
export const NPC_BUBBLE_MAX_HEIGHT = Math.ceil(
  NPC_BUBBLE_LINE_HEIGHT * NPC_BUBBLE_MAX_LINES + NPC_BUBBLE_PADDING_Y,
) // 69

/**
 * Bottom edge of the speech bubble's BOX, in pixels above the anchor. Its tail hangs
 * `NPC_BUBBLE_TAIL_HEIGHT` below that, so the tail TIP lands at 60 px — three pixels clear of the
 * marker at the top of its bounce (57 px). The bubble is pinned by this edge, so wrapped text grows
 * upward and can never push the tail back down into the marker.
 */
export const NPC_SPEECH_BUBBLE_OFFSET =
  NPC_QUEST_MARKER_OFFSET +
  NPC_QUEST_MARKER_HEIGHT +
  NPC_QUEST_MARKER_BOUNCE +
  NPC_STACK_GAP +
  NPC_BUBBLE_TAIL_HEIGHT // 66
