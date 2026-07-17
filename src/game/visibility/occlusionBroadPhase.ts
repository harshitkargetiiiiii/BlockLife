import type { OccluderDescriptor, Rect2D, VisibilitySubject } from './visibilityTypes'

/**
 * Broad phase: cheap 2D corridor test before any per-sample math.
 *
 * The sight line is the segment from the SUBJECT to the CAMERA, projected
 * onto the ground plane. An occluder is a candidate only if its (padded)
 * footprint intersects that segment — objects behind the camera (t > 1),
 * behind the subject (t < 0) or outside the corridor never qualify. Using
 * the live camera position each frame keeps this valid under zoom, camera
 * lead, and any future camera rotation.
 */

export interface CameraPoint {
  x: number
  y: number
  z: number
}

/**
 * Liang–Barsky style segment-vs-rect clip on the ground plane. Returns the
 * parametric [tEnter, tExit] of the segment inside the rect, or null when
 * they never intersect. t is measured from the subject (0) to the camera (1).
 */
export function clipSegmentToRect(
  sx: number,
  sz: number,
  cx: number,
  cz: number,
  rect: Rect2D,
  padding: number,
): [number, number] | null {
  const minX = rect.minX - padding
  const maxX = rect.maxX + padding
  const minZ = rect.minZ - padding
  const maxZ = rect.maxZ + padding
  const dx = cx - sx
  const dz = cz - sz

  let t0 = 0
  let t1 = 1
  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (sx < minX || sx > maxX) return null
  } else {
    let tA = (minX - sx) / dx
    let tB = (maxX - sx) / dx
    if (tA > tB) [tA, tB] = [tB, tA]
    t0 = Math.max(t0, tA)
    t1 = Math.min(t1, tB)
    if (t0 > t1) return null
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (sz < minZ || sz > maxZ) return null
  } else {
    let tA = (minZ - sz) / dz
    let tB = (maxZ - sz) / dz
    if (tA > tB) [tA, tB] = [tB, tA]
    t0 = Math.max(t0, tA)
    t1 = Math.min(t1, tB)
    if (t0 > t1) return null
  }
  return [t0, t1]
}

/** True when the occluder's footprint crosses the camera↔subject corridor. */
export function isFootprintBetweenCameraAndSubject(
  camera: CameraPoint,
  subject: VisibilitySubject,
  bounds: Rect2D,
  padding: number,
): boolean {
  return clipSegmentToRect(subject.x, subject.z, camera.x, camera.z, bounds, padding) !== null
}

/**
 * Broad-phase filter. Writes candidates into `out` (reused scratch array —
 * no per-frame allocation) and returns the count.
 */
export function getCandidateOccluders(
  camera: CameraPoint,
  subject: VisibilitySubject,
  occluders: Iterable<OccluderDescriptor>,
  padding: number,
  out: OccluderDescriptor[],
): number {
  let n = 0
  for (const occ of occluders) {
    if (!occ.enabled || occ.linkedTo) continue
    if (isFootprintBetweenCameraAndSubject(camera, subject, occ.bounds2D, padding)) {
      out[n++] = occ
    }
  }
  out.length = n
  return n
}
