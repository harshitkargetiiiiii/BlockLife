import type { BuildingDef } from '../worldTypes'
import { resolveFacadeStyle } from './facadeDetails'

/**
 * Rooftop plant for the industrial lots, derived from the building's own definition.
 *
 * Why the roof and not the walls: the diorama camera is fixed at `CAMERA_OFFSET [12, 18, 12]`,
 * looking down from 18 m, so a low building presents its ROOF as the largest surface on screen —
 * and the four industrial lots (`windows: false`) roof out as bare slabs. Three of them also author
 * their door on the west face, which the camera never sees, so wall dressing spends geometry where
 * the player cannot look. A first pilot did exactly that and was rejected on its own screenshots.
 *
 * Every box is visual only: no collider, no anchor, no routing obstacle, and it renders inside the
 * building's `Occludable`, so it fades with the parent instead of hiding the player. Shapes are
 * derived from `def.size`, so a lot that is re-authored keeps a coherent roof for free.
 */

export interface RoofBox {
  /** Offset from the building centre; `y` is measured from the top of the roof slab. */
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  /** Palette role — resolved to a colour by the renderer. */
  role: 'plant' | 'duct' | 'skylight'
}

/** Nothing on this roof may stand taller than this above the slab (camera clearance + read). */
export const MAX_ROOF_DETAIL_HEIGHT = 1.4

/**
 * Deterministic rooftop plant for one building — pure, ≤5 boxes, always inside the roof footprint.
 * Non-industrial styles return nothing: their roofs already carry authored flavour (the apartment's
 * water tank, the towers' antenna) and the generic AC unit.
 */
export function computeRoofDetails(def: BuildingDef): RoofBox[] {
  const style = resolveFacadeStyle(def)
  if (style !== 'industrial' && style !== 'shop') return []
  const [w, , d] = def.size
  // Keep everything within the slab, not the overhang, so nothing reads as floating off an edge.
  const halfW = w / 2 - 0.9
  const halfD = d / 2 - 0.9
  if (halfW <= 0.6 || halfD <= 0.6) return []

  const out: RoofBox[] = []
  if (style === 'shop') {
    // A shop roof is small and close to the camera, so it gets the quiet version: one housing and
    // one skylight. Anything busier would compete with the shopfront below it.
    out.push({ x: -halfW * 0.45, y: 0, z: -halfD * 0.3, w: 1.1, h: 0.55, d: 1.1, role: 'plant' })
    out.push({
      x: halfW * 0.3,
      y: 0,
      z: halfD * 0.45,
      w: Math.min(w * 0.3, 2.2),
      h: 0.16,
      d: 0.5,
      role: 'skylight',
    })
    return out
  }
  // Two extractor housings on the long axis, the larger one deeper into the roof.
  out.push({ x: -halfW * 0.55, y: 0, z: -halfD * 0.35, w: 1.5, h: 0.85, d: 1.5, role: 'plant' })
  out.push({ x: halfW * 0.5, y: 0, z: halfD * 0.45, w: 1.1, h: 0.6, d: 1.1, role: 'plant' })
  // A duct run between them: low, long, and clearly mechanical from above.
  out.push({
    x: -halfW * 0.05,
    y: 0,
    z: halfD * 0.05,
    w: Math.min(halfW * 1.1, 4.2),
    h: 0.34,
    d: 0.55,
    role: 'duct',
  })
  // Two skylight strips: the one element that reads as glass rather than plant from this camera.
  for (const side of [-1, 1]) {
    out.push({
      x: halfW * 0.15,
      y: 0,
      z: side * halfD * 0.72,
      w: Math.min(w * 0.34, 3.4),
      h: 0.18,
      d: 0.55,
      role: 'skylight',
    })
  }
  return out
}
