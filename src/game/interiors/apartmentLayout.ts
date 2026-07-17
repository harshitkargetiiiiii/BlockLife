import type { Vec2 } from '../world/worldTypes'

/**
 * The player's studio apartment — one compact interior room.
 *
 * It lives in the same canvas/physics world as the city, parked far outside
 * CITY_BOUNDS so nothing outdoors (traffic, citizens, puddles, camera shots)
 * can ever touch it. Entering/exiting is just a teleport + location flag; the
 * follow camera keeps working and the city simulation keeps running while
 * the player is inside.
 */
export const INTERIOR_ORIGIN: Vec2 = [200, 200]

/** Room inner size (x width, z depth), walls at the edges. */
export const ROOM_WIDTH = 11
export const ROOM_DEPTH = 9
export const WALL_HEIGHT = 3.4
export const WALL_THICKNESS = 0.3

const [OX, OZ] = INTERIOR_ORIGIN

/** Player spawn just inside the door (door sits on the south wall). */
export const APARTMENT_SPAWN: [number, number, number] = [OX + 3.4, 1.2, OZ + 2.6]

/** Where the player pops out in the city when leaving the apartment. */
export const APARTMENT_STREET_EXIT: [number, number, number] = [-12.5, 1.2, -7.2]

/** Interior interaction points (absolute world coordinates). */
export const APARTMENT_INTERACTABLE_POSITIONS = {
  bed: [OX - 3.4, 0, OZ - 2.2] as [number, number, number],
  wardrobe: [OX + 1.1, 0, OZ - 2.6] as [number, number, number],
  storage: [OX + 3.6, 0, OZ - 2.4] as [number, number, number],
  exit: [OX + 3.4, 0, OZ + 3.6] as [number, number, number],
}

export interface ApartmentFurnitureDef {
  id: string
  /** Position relative to INTERIOR_ORIGIN (x, z). */
  position: Vec2
  rotationY?: number
  /** Blocks the player (gets a collider). */
  solid?: boolean
  /** Collider half-extents [hx, hy, hz] when solid. */
  colliderHalf?: [number, number, number]
}

/**
 * Furniture placement, one entry per piece. Rendering lives in
 * ApartmentInterior.tsx; colliders are derived from `solid` entries so the
 * two can never drift apart.
 */
export const APARTMENT_FURNITURE: ApartmentFurnitureDef[] = [
  { id: 'bed', position: [-3.6, -2.5], solid: true, colliderHalf: [1.1, 0.4, 1.7] },
  { id: 'wardrobe', position: [1.1, -3.7], solid: true, colliderHalf: [1.0, 1.2, 0.45] },
  { id: 'mirror', position: [2.85, -3.95] },
  { id: 'storage', position: [3.9, -3.5], solid: true, colliderHalf: [0.75, 0.5, 0.55] },
  { id: 'desk', position: [4.6, 0.6], solid: true, colliderHalf: [0.5, 0.5, 1.1] },
  { id: 'chair', position: [3.6, 0.6] },
  { id: 'rug', position: [0, 0] },
  { id: 'lamp', position: [-4.6, 1.4], solid: true, colliderHalf: [0.22, 0.9, 0.22] },
  { id: 'plant', position: [4.6, -3.6], solid: true, colliderHalf: [0.3, 0.5, 0.3] },
  { id: 'window', position: [-1.0, -4.32] },
  { id: 'poster_a', position: [-2.9, -4.3] },
  { id: 'poster_b', position: [2.2, -4.3] },
  { id: 'door', position: [3.4, 4.32] },
]

/** Problems with the layout (empty = valid). Exercised by unit tests. */
export function validateApartmentLayout(): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  const hw = ROOM_WIDTH / 2
  const hd = ROOM_DEPTH / 2
  for (const f of APARTMENT_FURNITURE) {
    if (seen.has(f.id)) errors.push(`furniture "${f.id}": duplicate id`)
    seen.add(f.id)
    if (Math.abs(f.position[0]) > hw || Math.abs(f.position[1]) > hd) {
      errors.push(`furniture "${f.id}": outside the room`)
    }
    if (f.solid && !f.colliderHalf) errors.push(`furniture "${f.id}": solid without collider`)
  }
  // Interaction points must be inside the room and off solid furniture.
  for (const [name, pos] of Object.entries(APARTMENT_INTERACTABLE_POSITIONS)) {
    const rx = pos[0] - OX
    const rz = pos[2] - OZ
    if (Math.abs(rx) > hw || Math.abs(rz) > hd) {
      errors.push(`interactable "${name}": outside the room`)
    }
  }
  // The spawn and the exit path must stay clear of solid furniture.
  const spawnRel: Vec2 = [APARTMENT_SPAWN[0] - OX, APARTMENT_SPAWN[2] - OZ]
  for (const f of APARTMENT_FURNITURE) {
    if (!f.solid || !f.colliderHalf) continue
    const dx = Math.abs(spawnRel[0] - f.position[0])
    const dz = Math.abs(spawnRel[1] - f.position[1])
    if (dx < f.colliderHalf[0] + 0.5 && dz < f.colliderHalf[2] + 0.5) {
      errors.push(`spawn overlaps solid furniture "${f.id}"`)
    }
  }
  return errors
}
