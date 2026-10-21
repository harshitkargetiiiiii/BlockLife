import * as THREE from 'three'
import { createRng, hashString } from '../../traffic/routing/routeRng'

/**
 * Central Plaza paving: a deterministic running-bond stone texture for the plaza plane in
 * `Ground.tsx`, replacing a flat grey fill. Purely visual — the plane, its size, its height and
 * every collider are unchanged. One tile of the texture covers PAVING_TILE_METERS on a side.
 */
export const PAVING_TILE_METERS = 4

const PX = 256
// Paver size in metres: 1.0 × 0.5 running bond.
const PAVER_W = 1
const PAVER_H = 0.5
const GROUT = '#b3a690'
// Warm stone family; each paver draws one shade so the field reads as laid stone, not noise.
const SHADES = ['#d8cdb9', '#d3c7b1', '#dccfba', '#cfc2ab', '#d6ccb9', '#e0d5c2']

/** Paver shade indices for one texture tile, row-major (rows of PAVER_H, offset every other). */
export function pavingShades(seedKey = 'central_plaza_paving'): number[] {
  const rng = createRng(hashString(seedKey))
  const rows = PAVING_TILE_METERS / PAVER_H
  const cols = PAVING_TILE_METERS / PAVER_W
  return Array.from({ length: rows * cols }, () => Math.floor(rng() * SHADES.length))
}

let cached: THREE.CanvasTexture | null | undefined

/**
 * The shared plaza paving texture, built once per session. Returns null where no DOM canvas
 * exists (node unit tests), so callers keep the flat colour there.
 */
export function getPlazaPavingTexture(planeSizeMeters: number): THREE.CanvasTexture | null {
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') return (cached = null)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return (cached = null)
  const m = PX / PAVING_TILE_METERS
  ctx.fillStyle = GROUT
  ctx.fillRect(0, 0, PX, PX)
  const shades = pavingShades()
  const rows = PAVING_TILE_METERS / PAVER_H
  const cols = PAVING_TILE_METERS / PAVER_W
  const gap = 2
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : PAVER_W / 2
    // One extra paver per row so the offset row wraps seamlessly across the tile edge.
    for (let c = -1; c < cols; c++) {
      ctx.fillStyle = SHADES[shades[r * cols + ((c + cols) % cols)]]
      const x = (c * PAVER_W + offset) * m
      ctx.fillRect(x + gap / 2, r * PAVER_H * m + gap / 2, PAVER_W * m - gap, PAVER_H * m - gap)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(planeSizeMeters / PAVING_TILE_METERS, planeSizeMeters / PAVING_TILE_METERS)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return (cached = texture)
}
