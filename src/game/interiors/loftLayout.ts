import type { Vec2 } from '../world/worldTypes'

/**
 * City Loft — the mid-tier home (issue #17 §1/§4). A larger single interior room
 * parked far outside CITY_BOUNDS on its own axis, distinct from the studio
 * ([200,200]) and the stores. Entered/left by a teleport + the `location` flag,
 * exactly like the studio; the city keeps simulating while you're inside. Holds
 * more authored furniture slots and a proper hosting/dining zone.
 */
// Parked far off-grid, well clear of every other interior diorama (studio [200,200],
// Main St store [260,205], Waterfront kiosk [205,265], Premium [262,262]) — the always-
// mounted shells must never overlap or one interior bleeds into another's camera view
// (a real regression caught by the kiosk visual + the interiorFootprints overlap test).
export const LOFT_ORIGIN: Vec2 = [200, 302]

export const LOFT_ROOM_WIDTH = 14
export const LOFT_ROOM_DEPTH = 11
export const LOFT_WALL_HEIGHT = 3.6
export const LOFT_WALL_THICKNESS = 0.3

const [OX, OZ] = LOFT_ORIGIN

/** Player spawn just inside the door (door on the south wall). */
export const LOFT_SPAWN: [number, number, number] = [OX + 4.6, 1.2, OZ + 3.6]
/** A safe interior spot a hosted guest appears at (never in furniture/doorway). */
export const LOFT_GUEST_SPAWN: [number, number, number] = [OX - 2.2, 1.2, OZ + 2.4]
/** Where the player pops out in the city (downtown gateway sidewalk). */
export const LOFT_STREET_EXIT: [number, number, number] = [45.5, 1.2, -80.5]

/** Fixed interaction anchors (absolute world coords). Furniture slots are separate. */
export const LOFT_INTERACTABLE_POSITIONS = {
  bed: [OX - 4.4, 0, OZ - 3.4] as [number, number, number],
  wardrobe: [OX - 1.2, 0, OZ - 3.6] as [number, number, number],
  storage: [OX + 4.4, 0, OZ - 3.2] as [number, number, number],
  furnish: [OX + 0.2, 0, OZ + 3.4] as [number, number, number],
  host: [OX + 2.4, 0, OZ - 0.4] as [number, number, number],
  exit: [OX + 4.6, 0, OZ + 4.6] as [number, number, number],
}
