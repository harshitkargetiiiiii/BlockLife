import { BUILDINGS, CITY_BOUNDS, FOOD_TRUCK, JOB_KIOSK, PROPS } from './cityLayout'

/**
 * Lightweight 2D footprint queries against the static city layout, derived
 * from the same data CityColliders uses. Used for gameplay decisions that
 * must not depend on the physics engine (e.g. picking a safe spot to step
 * out of the car).
 */
export interface Footprint {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function rect(cx: number, cz: number, halfW: number, halfD: number): Footprint {
  return { minX: cx - halfW, maxX: cx + halfW, minZ: cz - halfD, maxZ: cz + halfD }
}

/** Axis-aligned half extents, swapped when the prop is rotated ~90°. */
function rotatedRect(
  cx: number,
  cz: number,
  halfW: number,
  halfD: number,
  rotationY: number,
): Footprint {
  const sideways = Math.abs(Math.sin(rotationY)) > 0.5
  return sideways ? rect(cx, cz, halfD, halfW) : rect(cx, cz, halfW, halfD)
}

export const STATIC_FOOTPRINTS: Footprint[] = [
  ...BUILDINGS.map((b) => rect(b.position[0], b.position[1], b.size[0] / 2, b.size[2] / 2)),
  rect(FOOD_TRUCK.position[0] - 0.4, FOOD_TRUCK.position[1], 2.6, 1.3),
  rect(JOB_KIOSK.position[0], JOB_KIOSK.position[1], 0.9, 0.9),
  ...PROPS.filter((p) => p.type === 'parked_car').map((p) =>
    rotatedRect(p.position[0], p.position[1], 1, 2, p.rotationY ?? 0),
  ),
]

/** True when a circle of `radius` at (x, z) misses every static footprint and the world walls. */
export function isPointClear(x: number, z: number, radius = 0.5): boolean {
  if (
    x < CITY_BOUNDS.minX + radius ||
    x > CITY_BOUNDS.maxX - radius ||
    z < CITY_BOUNDS.minZ + radius ||
    z > CITY_BOUNDS.maxZ - radius
  ) {
    return false
  }
  for (const f of STATIC_FOOTPRINTS) {
    if (
      x > f.minX - radius &&
      x < f.maxX + radius &&
      z > f.minZ - radius &&
      z < f.maxZ + radius
    ) {
      return false
    }
  }
  return true
}

/**
 * Picks a safe spot to step out of the car: tries the passenger side first,
 * then driver side, then behind, then in front — first clear one wins. The
 * fallback (blocked on all sides) is the passenger side, where physics will
 * push the player out of any overlap.
 */
export function findClearExitPosition(
  carX: number,
  carZ: number,
  headingY: number,
): [number, number] {
  const fwdX = Math.sin(headingY)
  const fwdZ = Math.cos(headingY)
  const rightX = fwdZ
  const rightZ = -fwdX
  const candidates: [number, number][] = [
    [carX + rightX * 2.2, carZ + rightZ * 2.2],
    [carX - rightX * 2.2, carZ - rightZ * 2.2],
    [carX - fwdX * 3.4, carZ - fwdZ * 3.4],
    [carX + fwdX * 3.4, carZ + fwdZ * 3.4],
  ]
  for (const [x, z] of candidates) {
    if (isPointClear(x, z, 0.5)) return [x, z]
  }
  return candidates[0]
}
