import { createRng, hashString } from '../../traffic/routing/routeRng'

/**
 * Surface & Facade Art Polish v1 — the surface-detail layer.
 *
 * Deterministic, data-driven decals that break up the city's large flat
 * planes: manholes and patches on roads, seams and curbs on sidewalks,
 * tonal patches on grass, paving bands on plazas, paint markings in the
 * yard. Everything is a thin rectangle or disc computed ONCE at module
 * load from the same rects that drive rendering and validation — details
 * are contained in their parent surface by construction, carry no
 * colliders, and never tick.
 */

export interface SurfaceRect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type SurfaceDetailKind =
  | 'manhole'
  | 'drain'
  | 'road_patch'
  | 'sidewalk_seam'
  | 'curb_strip'
  | 'grass_patch'
  | 'dirt_patch'
  | 'paving_band'
  | 'zone_paint'

export interface SurfaceDetail {
  id: string
  kind: SurfaceDetailKind
  /** Center position. */
  x: number
  z: number
  /** Footprint (w along x, d along z) — discs use w as diameter. */
  w: number
  d: number
  /** Render height offset tier (kept distinct per kind to avoid z-fights). */
  y: number
  rotated?: boolean
}

export interface SurfaceDetailInput {
  /** Stable seed root (sector id). */
  id: string
  roads: SurfaceRect[]
  sidewalks: SurfaceRect[]
  grass: SurfaceRect[]
  plazas?: SurfaceRect[]
  /** Rects grass details must stay clear of (buildings, water, roads). */
  avoid?: SurfaceRect[]
  /** Dashed paint strip (industrial loading zones etc.). */
  zonePaint?: { from: [number, number]; to: [number, number]; dash: number; width: number }[]
}

const Y = {
  grass_patch: 0.012,
  dirt_patch: 0.014,
  road_patch: 0.026,
  manhole: 0.028,
  drain: 0.029,
  sidewalk_seam: 0.032,
  curb_strip: 0.033,
  paving_band: 0.0315,
  zone_paint: 0.03,
} as const

const inside = (x: number, z: number, r: SurfaceRect, margin = 0) =>
  x > r.minX + margin && x < r.maxX - margin && z > r.minZ + margin && z < r.maxZ - margin

const overlapsAny = (x: number, z: number, w: number, d: number, rects: SurfaceRect[]) =>
  rects.some(
    (r) => x + w / 2 > r.minX && x - w / 2 < r.maxX && z + d / 2 > r.minZ && z - d / 2 < r.maxZ,
  )

/** All surface details for one sector — pure and deterministic. */
export function computeSurfaceDetails(input: SurfaceDetailInput): SurfaceDetail[] {
  const rng = createRng(hashString(`surface:${input.id}`))
  const out: SurfaceDetail[] = []
  let n = 0
  const push = (kind: SurfaceDetailKind, x: number, z: number, w: number, d: number, rotated?: boolean) => {
    out.push({
      id: `${input.id}_sd_${kind}_${n++}`,
      kind,
      x: Math.round(x * 10) / 10,
      z: Math.round(z * 10) / 10,
      w,
      d,
      y: Y[kind],
      rotated,
    })
  }

  // Roads: manholes/drains along the centerline, patches off-center.
  for (const road of input.roads) {
    const alongX = road.maxX - road.minX >= road.maxZ - road.minZ
    const length = alongX ? road.maxX - road.minX : road.maxZ - road.minZ
    const covers = Math.max(1, Math.floor(length / 26))
    for (let i = 0; i < covers; i++) {
      const t = (i + 0.5) / covers + (rng() - 0.5) * 0.2
      const cx = alongX ? road.minX + t * length : (road.minX + road.maxX) / 2 + (rng() - 0.5) * 1.5
      const cz = alongX ? (road.minZ + road.maxZ) / 2 + (rng() - 0.5) * 1.5 : road.minZ + t * length
      if (!inside(cx, cz, road, 1)) continue
      push(rng() < 0.6 ? 'manhole' : 'drain', cx, cz, 0.9, 0.9)
    }
    const patches = Math.max(1, Math.floor(length / 34))
    for (let i = 0; i < patches; i++) {
      const px = road.minX + 1.6 + rng() * (road.maxX - road.minX - 3.2)
      const pz = road.minZ + 1.6 + rng() * (road.maxZ - road.minZ - 3.2)
      if (!inside(px, pz, road, 1.4)) continue
      push('road_patch', px, pz, 1.8 + rng() * 1.4, 1.4 + rng() * 1.2, rng() < 0.5)
    }
  }

  // Sidewalks: expansion seams every ~6 u + a curb strip on the road edge.
  for (const walk of input.sidewalks) {
    const alongX = walk.maxX - walk.minX >= walk.maxZ - walk.minZ
    const length = alongX ? walk.maxX - walk.minX : walk.maxZ - walk.minZ
    const width = alongX ? walk.maxZ - walk.minZ : walk.maxX - walk.minX
    for (let s = 6; s < length - 2; s += 6) {
      if (alongX) push('sidewalk_seam', walk.minX + s, (walk.minZ + walk.maxZ) / 2, 0.14, width, false)
      else push('sidewalk_seam', (walk.minX + walk.maxX) / 2, walk.minZ + s, width, 0.14, false)
    }
    // Curb strip along whichever long edge touches a road rect.
    const road = input.roads.find((r) =>
      alongX
        ? (Math.abs(walk.minZ - r.maxZ) < 0.5 || Math.abs(walk.maxZ - r.minZ) < 0.5) &&
          walk.minX < r.maxX &&
          walk.maxX > r.minX
        : (Math.abs(walk.minX - r.maxX) < 0.5 || Math.abs(walk.maxX - r.minX) < 0.5) &&
          walk.minZ < r.maxZ &&
          walk.maxZ > r.minZ,
    )
    if (road) {
      if (alongX) {
        const edge = Math.abs(walk.minZ - road.maxZ) < 0.5 ? walk.minZ + 0.14 : walk.maxZ - 0.14
        push('curb_strip', (walk.minX + walk.maxX) / 2, edge, length, 0.26, false)
      } else {
        const edge = Math.abs(walk.minX - road.maxX) < 0.5 ? walk.minX + 0.14 : walk.maxX - 0.14
        push('curb_strip', edge, (walk.minZ + walk.maxZ) / 2, 0.26, length, false)
      }
    }
  }

  // Plazas: broad paving bands (also lifts night readability).
  for (const plaza of input.plazas ?? []) {
    const alongX = plaza.maxX - plaza.minX >= plaza.maxZ - plaza.minZ
    const length = alongX ? plaza.maxX - plaza.minX : plaza.maxZ - plaza.minZ
    for (let s = 4; s < length - 2; s += 8) {
      if (alongX)
        push('paving_band', plaza.minX + s, (plaza.minZ + plaza.maxZ) / 2, 2.2, plaza.maxZ - plaza.minZ, false)
      else push('paving_band', (plaza.minX + plaza.maxX) / 2, plaza.minZ + s, plaza.maxX - plaza.minX, 2.2, false)
    }
  }

  // Grass: tonal patches + occasional dirt, clear of everything solid.
  const avoid = [...(input.avoid ?? []), ...input.roads, ...input.sidewalks, ...(input.plazas ?? [])]
  for (const lawn of input.grass) {
    const area = (lawn.maxX - lawn.minX) * (lawn.maxZ - lawn.minZ)
    const target = Math.min(14, Math.max(3, Math.round(area / 260)))
    let attempts = 0
    let placed = 0
    while (placed < target && attempts < target * 10) {
      attempts++
      const w = 2.6 + rng() * 3.4
      const d = 2.2 + rng() * 3
      const x = lawn.minX + w / 2 + rng() * (lawn.maxX - lawn.minX - w)
      const z = lawn.minZ + d / 2 + rng() * (lawn.maxZ - lawn.minZ - d)
      if (overlapsAny(x, z, w, d, avoid)) continue
      push(rng() < 0.82 ? 'grass_patch' : 'dirt_patch', x, z, w, d, rng() < 0.5)
      placed++
    }
  }

  // Explicit paint markings (industrial loading zones): dashed strips.
  for (const [pi, paint] of (input.zonePaint ?? []).entries()) {
    const dx = paint.to[0] - paint.from[0]
    const dz = paint.to[1] - paint.from[1]
    const length = Math.hypot(dx, dz)
    const steps = Math.max(1, Math.floor(length / (paint.dash * 2)))
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      push(
        'zone_paint',
        paint.from[0] + dx * t,
        paint.from[1] + dz * t,
        Math.abs(dx) > Math.abs(dz) ? paint.dash : paint.width,
        Math.abs(dx) > Math.abs(dz) ? paint.width : paint.dash,
        false,
      )
    }
    void pi
  }

  return out
}
