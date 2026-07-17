import * as THREE from 'three'
import type { FadeMeshEntry, OccluderDescriptor, RegisteredOccluder } from './visibilityTypes'

/**
 * Material strategy: SWAP-ON-FADE.
 *
 * Idle occludables keep their ORIGINAL materials — many of those are shared
 * city-wide (window glow, GLB loader cache) and are driven per-frame by the
 * world director, so leaving them untouched costs nothing and never risks
 * contaminating unrelated instances.
 *
 * When a fade begins, each mesh swaps to a per-occludable CLONE (created
 * once, cached per source material). While active, clones sync the live
 * properties (opacity, emissiveIntensity) from their sources so glowing
 * windows keep glowing mid-fade. On full restore the original materials are
 * swapped back and the mesh is bit-identical to before. Shared sources are
 * NEVER mutated.
 *
 * Extension point: applyFade currently implements 'wholeObject'. A
 * 'roofOnly' / 'facadeOnly' policy plugs in here by filtering which meshes
 * enter the FadeMeshEntry list (e.g. by world-Y or face normal) — detection
 * and runtime need no changes.
 */

/** Shadow policy: a building fainter than this stops casting shadows —
    a hard shadow from a nearly invisible wall reads as a glitch. */
export const SHADOW_CUTOFF_OPACITY = 0.5

interface FadeableMaterial extends THREE.Material {
  opacity: number
  transparent: boolean
  depthWrite: boolean
  alphaTest: number
  emissiveIntensity?: number
}

/** Clone cache per occludable: one clone per distinct source material. */
const cloneCaches = new WeakMap<object, Map<THREE.Material, THREE.Material>>()

function cloneFor(owner: object, source: THREE.Material): THREE.Material {
  let cache = cloneCaches.get(owner)
  if (!cache) {
    cache = new Map()
    cloneCaches.set(owner, cache)
  }
  let clone = cache.get(source)
  if (!clone) {
    clone = source.clone()
    clone.transparent = true
    // Keep depth behavior: depthTest stays on; depthWrite stays as authored
    // so the building self-sorts (front walls hide back walls) while the
    // subject — drawn in the opaque pass — shows through the blend.
    cache.set(source, clone)
  }
  return clone
}

function isExcluded(material: THREE.Material, descriptor: OccluderDescriptor): boolean {
  return !!descriptor.excludeMaterialNames?.includes(material.name)
}

/**
 * Traverses the occludable's group and builds the fade mesh list. Called
 * lazily at first fade (GLBs commit asynchronously behind Suspense, so
 * traversal at registration time would miss them).
 */
export function collectFadeMeshes(occluder: RegisteredOccluder): FadeMeshEntry[] {
  const entries: FadeMeshEntry[] = []
  const { descriptor, object } = occluder
  object.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const original = mesh.material
    const fade = Array.isArray(original)
      ? original.map((m) => (isExcluded(m, descriptor) ? m : cloneFor(occluder, m)))
      : isExcluded(original, descriptor)
        ? original
        : cloneFor(occluder, original)
    entries.push({
      mesh,
      originalMaterial: original,
      fadeMaterial: fade,
      originalCastShadow: mesh.castShadow,
    })
  })
  return entries
}

function eachPair(
  entry: FadeMeshEntry,
  fn: (source: FadeableMaterial, clone: FadeableMaterial) => void,
): void {
  const { originalMaterial, fadeMaterial } = entry
  if (Array.isArray(originalMaterial)) {
    const fades = fadeMaterial as THREE.Material[]
    for (let i = 0; i < originalMaterial.length; i++) {
      if (fades[i] !== originalMaterial[i]) {
        fn(originalMaterial[i] as FadeableMaterial, fades[i] as FadeableMaterial)
      }
    }
  } else if (fadeMaterial !== originalMaterial) {
    fn(originalMaterial as FadeableMaterial, fadeMaterial as FadeableMaterial)
  }
}

/** Swap the fade clones in (idempotent). */
export function swapToFadeMaterials(occluder: RegisteredOccluder): void {
  if (occluder.swapped) return
  if (!occluder.meshes) occluder.meshes = collectFadeMeshes(occluder)
  for (const entry of occluder.meshes) {
    entry.mesh.material = entry.fadeMaterial
  }
  occluder.swapped = true
}

/** Swap the originals back and restore shadow state exactly (idempotent). */
export function restoreOriginalMaterials(occluder: RegisteredOccluder): void {
  if (!occluder.swapped || !occluder.meshes) return
  for (const entry of occluder.meshes) {
    entry.mesh.material = entry.originalMaterial
    entry.mesh.castShadow = entry.originalCastShadow
  }
  occluder.swapped = false
  // GLBs can re-commit (fallback → model swap); rebuild the list next fade.
  occluder.meshes = null
}

/**
 * Per-frame application while a fade is active: sync live source properties
 * into the clones and scale opacity by the fade factor. No allocations.
 */
export function applyFade(occluder: RegisteredOccluder, fadeOpacity: number): void {
  if (!occluder.meshes) return
  const castShadows = fadeOpacity >= SHADOW_CUTOFF_OPACITY
  for (const entry of occluder.meshes) {
    eachPair(entry, (source, clone) => {
      // Live sync: glow-driven emissives and animated opacities keep working
      // mid-fade instead of freezing at their swap-time values.
      if (clone.emissiveIntensity !== undefined && source.emissiveIntensity !== undefined) {
        clone.emissiveIntensity = source.emissiveIntensity
      }
      const baseOpacity = source.transparent ? source.opacity : 1
      clone.opacity = baseOpacity * fadeOpacity
    })
    if (entry.originalCastShadow) entry.mesh.castShadow = castShadows
  }
}
