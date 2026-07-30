import type { Vec2 } from '../world/worldTypes'

/**
 * Premium Apartment — the high-tier home (issue #17 §1/§4). The largest single
 * interior, parked far outside CITY_BOUNDS on its own axis. Its city entrance
 * sits in the far-east residential sector, so leasing/touring/moving here
 * exercises cross-district streaming (issue §22). Same enter/exit contract as the
 * other homes.
 */
export const PREMIUM_ORIGIN: Vec2 = [262, 262]

export const PREMIUM_ROOM_WIDTH = 17
export const PREMIUM_ROOM_DEPTH = 13
export const PREMIUM_WALL_HEIGHT = 3.8
export const PREMIUM_WALL_THICKNESS = 0.3

const [OX, OZ] = PREMIUM_ORIGIN

/** Player spawn just inside the door (door on the south wall). */
export const PREMIUM_SPAWN: [number, number, number] = [OX + 5.6, 1.2, OZ + 4.4]
/** A safe interior spot a hosted guest appears at (never in furniture/doorway). */
export const PREMIUM_GUEST_SPAWN: [number, number, number] = [OX - 3.0, 1.2, OZ + 3.0]
/** Where the player pops out in the city (far-east residential sidewalk). */
export const PREMIUM_STREET_EXIT: [number, number, number] = [235.5, 1.2, -86.5]

/** Fixed interaction anchors (absolute world coords). Furniture slots are separate. */
export const PREMIUM_INTERACTABLE_POSITIONS = {
  bed: [OX - 5.4, 0, OZ - 4.2] as [number, number, number],
  wardrobe: [OX - 1.8, 0, OZ - 4.4] as [number, number, number],
  storage: [OX + 5.4, 0, OZ - 4.0] as [number, number, number],
  furnish: [OX + 0.4, 0, OZ + 4.2] as [number, number, number],
  host: [OX + 3.0, 0, OZ - 0.6] as [number, number, number],
  exit: [OX + 5.6, 0, OZ + 5.6] as [number, number, number],
}
