import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { AssetManifestEntry } from './assetManifest'
import { getManifestEntry, reportAssetLoadFailure, resolveGlbUrl, shouldLoadGlb } from './modelRegistry'
import { applyVariant, createVariantInstances, disposeVariantMaterials, type MaterialVariant, type ResolvedSlots } from './assetVariants'
import { acquireTintedMaterials, assignTintedMaterials } from './variantMaterialCache'
import { registry } from '../world/runtimeRegistry'

export interface LandmarkAssetProps {
  /** Stable semantic id, looked up in the asset manifest. */
  assetId: string
  /** Placement of the whole landmark (fallback and GLB alike). */
  position?: [number, number, number]
  rotationY?: number
  castShadow?: boolean
  receiveShadow?: boolean
  /** Procedural fallback — always kept, renders whenever the GLB can't. */
  children: ReactNode
  /**
   * Manifest entry override. Defaults to the registry lookup; injectable so
   * tests and tooling can exercise load paths without touching the manifest.
   */
  entry?: AssetManifestEntry
  /**
   * Palette variant (issue #21 §6): recolors the entry's declared material slots
   * for THIS instance only, so repeated archetypes stop looking cloned. Resolve
   * from `entry.variants[id]` at the call site, or pass an ad-hoc override.
   */
  variant?: MaterialVariant
  /**
   * Reusable-archetype visual projection (issue #25): a complete position/rotation/scale
   * applied as a NESTED GROUP around the GLB primitive ONLY (matrix composition with the
   * manifest entry's own TRS — never Euler addition). The procedural fallback (`children`)
   * renders OUTSIDE this group, so a disabled/missing/loading/failed GLB is never rotated
   * or scaled by it.
   */
  projection?: { rotationY: number; scale: [number, number, number]; offset: [number, number, number] }
  /** Issue #25: share one immutable tinted material-set per (source, slots, palette). */
  variantCacheKey?: string
  /**
   * Rendered ONLY alongside a GLB body that actually mounted (issue #42, mirroring the
   * `glbSiblings` slot VehicleAsset gained in issue #40). It lives inside the
   * Suspense/ErrorBoundary, so it appears exactly when the model does and disappears the moment
   * the fallback takes over.
   *
   * This is what lets a GLB that is GEOMETRY ONLY keep a repo-owned functional fitting without
   * duplicating the body: the approved streetlight carries no light, so the shared emissive bulb
   * and ground glow render here, positioned on the model's own lantern, while the complete
   * procedural lamp (pole AND light) stays the fallback. Nothing here is loaded, gated or
   * counted differently — it is a plain child of the same branch the primitive renders on.
   */
  glbSiblings?: ReactNode
}

interface BoundaryProps {
  assetId: string
  fallback: ReactNode
  children: ReactNode
}

/** Turns a failed GLB load (thrown through Suspense) into the fallback visual. */
class AssetErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    registry.glbLandmarksFailed++
    reportAssetLoadFailure(this.props.assetId, error)
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function GlbModel({
  entry,
  castShadow,
  receiveShadow,
  variant,
  variantCacheKey,
}: {
  entry: AssetManifestEntry
  castShadow: boolean
  receiveShadow: boolean
  /** Palette variant (issue #21 §6): recolors the entry's declared material slots. */
  variant?: MaterialVariant
  /**
   * Issue #25: when set, share ONE immutable tinted material-set per (source, slots,
   * palette) across every instance with this key instead of cloning per instance — the
   * material-budget fix for reused archetypes. Absent → the legacy per-instance path
   * (existing GLB buildings/vehicles), byte-identical to before.
   */
  variantCacheKey?: string
}) {
  const gltf = useGLTF(resolveGlbUrl(entry))

  // Signals "this landmark's model is actually on screen" — the definitive
  // scene-settled indicator used by visual tests via the test API.
  useEffect(() => {
    registry.glbLandmarksActive++
    return () => {
      registry.glbLandmarksActive--
    }
  }, [])

  // Clone so several landmarks can share one file; apply shadow flags. Materials: with a
  // variantCacheKey, assign the shared immutable tinted set (issue #25, no per-instance
  // clone/dispose); otherwise isolate this instance's declared slots per §21 §6.
  const { scene, slots } = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = castShadow
        obj.receiveShadow = receiveShadow
      }
    })
    const slotMap = entry.materialSlots
    if (slotMap && variantCacheKey) {
      const tinted = acquireTintedMaterials(variantCacheKey, gltf.scene, slotMap, variant)
      assignTintedMaterials(cloned, tinted)
      return { scene: cloned, slots: null as ResolvedSlots | null }
    }
    const isolated = slotMap ? createVariantInstances(cloned, slotMap, Object.keys(slotMap)) : null
    return { scene: cloned, slots: isolated }
  }, [gltf.scene, castShadow, receiveShadow, entry, variant, variantCacheKey])

  // Dispose ONLY the per-instance isolated materials (legacy path). Cache-shared materials
  // are process-lifetime and immutable — never disposed here.
  useEffect(() => () => { if (slots) disposeVariantMaterials(slots) }, [slots])

  // Legacy path only: recolor the isolated slots. Cache path bakes the color at build time.
  useEffect(() => {
    if (slots && variant) applyVariant(slots, variant)
  }, [slots, variant])

  return (
    <primitive
      object={scene}
      position={entry.positionOffset}
      rotation={entry.rotation}
      scale={entry.scale}
    />
  )
}

/**
 * Visual slot for a major landmark. Renders the GLB registered in the asset
 * manifest when one is available and enabled; in every other case — no entry,
 * no file, disabled, still loading, or load error — the procedural fallback
 * (children) renders instead. Gameplay and colliders never depend on which
 * branch is active.
 */
export function LandmarkAsset({
  assetId,
  position,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
  children,
  entry: entryOverride,
  variant,
  projection,
  variantCacheKey,
  glbSiblings,
}: LandmarkAssetProps) {
  const entry = entryOverride ?? getManifestEntry(assetId)
  const useGlb = shouldLoadGlb(entry)

  // Every instance that wants a GLB registers itself; assetsSettled() in the
  // test API compares this against actually-committed + failed instances.
  useEffect(() => {
    if (!useGlb) return
    registry.glbLandmarksExpected++
    return () => {
      registry.glbLandmarksExpected--
    }
  }, [useGlb])

  const model = (
    <GlbModel
      entry={entry as AssetManifestEntry}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      variant={variant}
      variantCacheKey={variantCacheKey}
    />
  )

  return (
    <group name={`asset:${assetId}`} position={position} rotation-y={rotationY}>
      {useGlb ? (
        <AssetErrorBoundary assetId={assetId} fallback={children}>
          <Suspense fallback={children}>
            {projection ? (
              // Nested group = matrix composition with the primitive's entry TRS.
              <group position={projection.offset} rotation-y={projection.rotationY} scale={projection.scale}>
                {model}
              </group>
            ) : (
              model
            )}
            {glbSiblings}
          </Suspense>
        </AssetErrorBoundary>
      ) : (
        children
      )}
    </group>
  )
}
