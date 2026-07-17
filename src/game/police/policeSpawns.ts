import type { Vec2 } from '../world/worldTypes'
import { getRoadGraph, pointAtProgress } from '../traffic/routing/roadGraphBuilder'
import { getRoadRects } from '../world/cityLayout'
import { COMPILED_SECTORS } from '../world/authoring/compiledSectors'
import { collectSolidFootprints } from '../world/solidFootprints'

/**
 * Validated police spawn anchors, derived from the road-graph spawn points
 * (on real asphalt, never in water/buildings/props). Cached once — the
 * graph is immutable. The dispatch director picks an anchor NEAR the
 * suspect but OFF-CAMERA so police never pop in on screen.
 */

export interface PoliceSpawnAnchor {
  id: string
  position: Vec2
  headingSeed: number
}

let anchorCache: PoliceSpawnAnchor[] | null = null

function buildAnchors(): PoliceSpawnAnchor[] {
  const graph = getRoadGraph()
  const water = COMPILED_SECTORS.flatMap((c) => c.waterRects)
  const solids = collectSolidFootprints()
  const anchors: PoliceSpawnAnchor[] = []
  for (const [id, sp] of graph.spawnPoints) {
    const seg = graph.segments.get(sp.segmentId)
    if (!seg) continue
    const [x, z] = pointAtProgress(seg, sp.progress)
    // Reject anything not on clear ground.
    if (water.some((w) => x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ)) continue
    if (solids.some((s) => Math.abs(x - s.position.x) < s.halfWidth && Math.abs(z - s.position.z) < s.halfLength)) continue
    anchors.push({ id: `pspawn_${id}`, position: [x, z], headingSeed: 0 })
  }
  return anchors
}

export function getPoliceSpawnAnchors(): PoliceSpawnAnchor[] {
  if (!anchorCache) anchorCache = buildAnchors()
  return anchorCache
}

export function invalidatePoliceSpawnCache(): void {
  anchorCache = null
}

export interface CameraBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Pick the spawn anchor closest to `near` that sits OUTSIDE the camera box
 * (so the spawn is never visible) and is not on top of another unit's
 * chosen spot. Falls back to the nearest anchor if all are on-camera.
 */
export function pickSpawnAnchor(
  near: Vec2,
  cameraBox: CameraBox | null,
  taken: ReadonlySet<string> = new Set(),
): PoliceSpawnAnchor | null {
  const anchors = getPoliceSpawnAnchors()
  let best: PoliceSpawnAnchor | null = null
  let bestScore = Infinity
  let fallback: PoliceSpawnAnchor | null = null
  let fallbackScore = Infinity
  for (const a of anchors) {
    if (taken.has(a.id)) continue
    const d = Math.hypot(a.position[0] - near[0], a.position[1] - near[1])
    // Prefer anchors 25–120 units away — close enough to respond, far
    // enough to be off the edge of the view.
    const score = Math.abs(d - 55)
    if (score < fallbackScore) {
      fallback = a
      fallbackScore = score
    }
    const onCamera =
      cameraBox !== null &&
      a.position[0] > cameraBox.minX &&
      a.position[0] < cameraBox.maxX &&
      a.position[1] > cameraBox.minZ &&
      a.position[1] < cameraBox.maxZ
    if (onCamera || d < 20) continue // never spawn on-screen or in the player's lap
    if (score < bestScore) {
      best = a
      bestScore = score
    }
  }
  return best ?? fallback
}

/** Validation: every anchor sits on asphalt and off water/solids. */
export function validatePoliceSpawns(): string[] {
  const errors: string[] = []
  const roads = getRoadRects()
  for (const a of getPoliceSpawnAnchors()) {
    const onRoad = roads.some(
      (r) => a.position[0] > r.minX - 2 && a.position[0] < r.maxX + 2 && a.position[1] > r.minZ - 2 && a.position[1] < r.maxZ + 2,
    )
    if (!onRoad) errors.push(`${a.id}: spawn anchor is not on a road`)
  }
  if (getPoliceSpawnAnchors().length === 0) errors.push('no police spawn anchors resolved')
  return errors
}
