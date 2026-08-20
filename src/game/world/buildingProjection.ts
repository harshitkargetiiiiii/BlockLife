import { hashString } from '../traffic/routing/routeRng'
import type { MaterialVariant } from '../assets/assetVariants'
import type { BuildingDef, Vec3 } from './worldTypes'

/**
 * Reusable-archetype visual projection (issue #25).
 *
 * Resolves a `BuildingDef.visual` (which archetype GLB backs this gameplay id) into ONE
 * complete visual transform — position (visualOffset), Y-rotation (canonical facing →
 * authored door), and per-axis scale (clamped `def.size / referenceSize`). The caller
 * applies it as a NESTED GROUP around the GLB primitive and its asset-local overlays, so
 * composition with the manifest `entry.rotation/scale/positionOffset` is matrix-based —
 * never component-wise Euler addition. The procedural fallback and every gameplay read
 * (collision / occlusion / routing / anchors / footprint / coordinates) IGNORE this;
 * `def.size` / `def.position` stay authoritative.
 */

const FACING_YAW: Record<'north' | 'south' | 'east' | 'west', number> = {
  south: 0,
  north: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
}

export interface ResolvedBuildingVisual {
  /** Archetype manifest id to render instead of def.id. */
  assetId: string
  /** Yaw (radians) to face the model's canonical front toward def.door. */
  rotationY: number
  /** Per-axis visual scale (clamped fit); never touches colliders. */
  scale: Vec3
  /** Visual-only offset; never moves anchors. */
  offset: Vec3
  /** Per-instance wall/trim recolor (from authored colors). */
  paletteVariant?: MaterialVariant
  /** Deterministic per-building seed so reused archetypes show distinct lit-window patterns. */
  overlaySeed: number
}

function clampAxis(ratio: number, dev: number): number {
  return Math.min(1 + dev, Math.max(1 - dev, ratio))
}

/**
 * Returns the resolved visual for a projected building, or `undefined` for a legacy
 * (id-keyed) building — which renders exactly as before.
 */
export function resolveBuildingVisual(def: BuildingDef): ResolvedBuildingVisual | undefined {
  const v = def.visual
  if (!v) return undefined
  const dev = v.maxScaleDeviation ?? 0.15
  const [rw, rh, rd] = v.referenceSize
  const [w, h, d] = def.size
  const scale: Vec3 = [clampAxis(w / rw, dev), clampAxis(h / rh, dev), clampAxis(d / rd, dev)]
  const canonical = v.canonicalFacing ?? 'south'
  const door = def.door ?? canonical
  // Nested-group rotation: this composes with the primitive's own entry.rotation via matrix
  // multiply at render time, NOT by adding Euler components.
  const rotationY = FACING_YAW[door] - FACING_YAW[canonical]
  return {
    assetId: v.assetId,
    rotationY,
    scale,
    offset: v.visualOffset ?? [0, 0, 0],
    paletteVariant: v.paletteVariant,
    overlaySeed: hashString(def.id),
  }
}

/** Transformed label anchor height: manifest label height (or fallback top) scaled + offset. */
export function projectedLabelHeight(
  visual: ResolvedBuildingVisual | undefined,
  labelHeight: number,
): number {
  if (!visual) return labelHeight
  return visual.offset[1] + visual.scale[1] * labelHeight
}
