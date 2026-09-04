/**
 * How much a building's PROCEDURAL body stands above its authored box.
 *
 * `BuildingMesh` caps every `def.size` box with a roof slab centred at `h + 0.22` and 0.45
 * thick, so the fallback body's real top is `h + 0.445`; 0.5 is that rounded conservatively up.
 * It is the number occlusion has always used, and it now also feeds the camera-clearance
 * authoring rule (issue #46 §2), so both read it from one place instead of each repeating 0.5.
 *
 * DELIBERATELY EXCLUDED: the thin decorative rooftop fittings `RooftopExtras` adds to the
 * apartment (water tank) and the towers (a 2 m antenna mast tipped with a 0.12 m sphere). Those
 * are a few centimetres of geometry, not mass — they cannot fill the frame or hide the subject,
 * which is what both consumers of this constant are about. `building_tower_04`'s mast does
 * reach above the camera plane; the orthographic camera's `near: -200` renders it without a
 * cutaway, and the tower is a backdrop 80 m outside the play area.
 */
export const BUILDING_ROOF_EXTRA = 0.5

/** Top of a building's procedural massing, in world units above the ground it stands on. */
export function buildingMassingTop(sizeY: number): number {
  return sizeY + BUILDING_ROOF_EXTRA
}
