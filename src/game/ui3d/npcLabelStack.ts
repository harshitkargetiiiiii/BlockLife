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
 *   quest marker  22 → 49 px
 *   speech bubble 52 px and up
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

/** Bottom edge of the speech bubble, in pixels above the anchor — clear of the marker slot. */
export const NPC_SPEECH_BUBBLE_OFFSET =
  NPC_QUEST_MARKER_OFFSET + NPC_QUEST_MARKER_HEIGHT + NPC_STACK_GAP // 52
