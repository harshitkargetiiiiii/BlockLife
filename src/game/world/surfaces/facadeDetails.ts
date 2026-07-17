import type { BuildingDef } from '../worldTypes'

/**
 * Facade-detail policies: deterministic box-geometry accents derived from
 * a building's existing definition (size, door, label, windows flag).
 * Rendered INSIDE BuildingMesh, so every detail lives in the building's
 * Occludable group — details fade with their parent and can never float.
 * No colliders: every box stays within ~0.8 u of the wall plane, inside
 * the lot setback that placement validation already guarantees.
 */

export type FacadeStyle = 'shop' | 'tower' | 'house' | 'industrial' | 'block'

export interface FacadeBox {
  /** Offset from building center (y from ground). */
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  /** Palette role — resolved to a color by the renderer. */
  role: 'trim' | 'frame' | 'accent' | 'dark' | 'vent'
}

export function resolveFacadeStyle(def: BuildingDef): FacadeStyle {
  if (def.windows === false && def.size[1] >= 4.5) return 'industrial'
  if (def.size[1] >= 9) return 'tower'
  if (def.label && def.size[1] <= 6.5) return 'shop'
  if (def.size[1] <= 4.5) return 'house'
  return 'block'
}

const DOOR_DIR: Record<NonNullable<BuildingDef['door']>, [number, number]> = {
  south: [0, 1],
  north: [0, -1],
  east: [1, 0],
  west: [-1, 0],
}

/** Detail boxes for one building — pure, deterministic, ≤6 per building. */
export function computeFacadeDetails(def: BuildingDef): FacadeBox[] {
  const [w, h, d] = def.size
  const style = resolveFacadeStyle(def)
  const out: FacadeBox[] = []
  const dir = def.door ? DOOR_DIR[def.door] : null
  const doorDist = def.door === 'east' || def.door === 'west' ? w / 2 : d / 2
  const doorX = dir ? dir[0] * doorDist : 0
  const doorZ = dir ? dir[1] * doorDist : 0
  const alongX = def.door === 'north' || def.door === 'south'

  // Cornice under the roof slab: every style except houses.
  if (style !== 'house') {
    out.push({ x: 0, y: h - 0.28, z: 0, w: w + 0.34, h: 0.28, d: d + 0.34, role: 'trim' })
  }

  if (dir) {
    // Door frame: all styles.
    out.push({
      x: doorX * 1.004,
      y: 0,
      z: doorZ * 1.004,
      w: alongX ? 1.9 : 0.16,
      h: 2.5,
      d: alongX ? 0.16 : 1.9,
      role: 'frame',
    })
  }

  switch (style) {
    case 'shop':
      if (dir) {
        // Fascia sign band above the awning.
        out.push({
          x: doorX * 1.01,
          y: Math.min(2.75, h - 0.85),
          z: doorZ * 1.01,
          w: alongX ? w * 0.72 : 0.2,
          h: 0.55,
          d: alongX ? 0.2 : d * 0.72,
          role: 'accent',
        })
        // Display window beside the door.
        out.push({
          x: doorX * 1.008 + (alongX ? w * 0.26 : 0),
          y: 0.7,
          z: doorZ * 1.008 + (alongX ? 0 : d * 0.26),
          w: alongX ? w * 0.34 : 0.1,
          h: 1.5,
          d: alongX ? 0.1 : d * 0.34,
          role: 'dark',
        })
      }
      break
    case 'tower': {
      // Floor bands every other floor + entrance canopy.
      for (let y = 3.3; y < h - 1.2 && out.length < 5; y += 3.4) {
        out.push({ x: 0, y, z: 0, w: w + 0.14, h: 0.18, d: d + 0.14, role: 'trim' })
      }
      if (dir) {
        out.push({
          x: doorX + dir[0] * 0.55,
          y: 2.75,
          z: doorZ + dir[1] * 0.55,
          w: alongX ? 2.6 : 1.1,
          h: 0.14,
          d: alongX ? 1.1 : 2.6,
          role: 'accent',
        })
      }
      break
    }
    case 'house':
      if (dir) {
        // Porch step at the door.
        out.push({
          x: doorX + dir[0] * 0.45,
          y: 0,
          z: doorZ + dir[1] * 0.45,
          w: alongX ? 1.9 : 0.9,
          h: 0.24,
          d: alongX ? 0.9 : 1.9,
          role: 'trim',
        })
      }
      break
    case 'industrial': {
      // Wall vents + a wide loading door on the door face (or +x face).
      const vx = dir && !alongX ? 0 : w / 2
      out.push({ x: vx * 0.98, y: h - 1.1, z: -d * 0.28, w: vx ? 0.14 : 1, h: 0.7, d: vx ? 1 : 0.14, role: 'vent' })
      out.push({ x: vx * 0.98, y: h - 1.1, z: d * 0.28, w: vx ? 0.14 : 1, h: 0.7, d: vx ? 1 : 0.14, role: 'vent' })
      if (dir) {
        out.push({
          x: doorX * 1.006 + (alongX ? -w * 0.24 : 0),
          y: 0,
          z: doorZ * 1.006 + (alongX ? 0 : -d * 0.24),
          w: alongX ? w * 0.36 : 0.12,
          h: 3,
          d: alongX ? 0.12 : d * 0.36,
          role: 'dark',
        })
      }
      break
    }
    case 'block':
      break
  }
  return out
}
