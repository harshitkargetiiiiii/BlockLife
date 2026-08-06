import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { AssetManifestEntry } from './assetManifest'
import { getManifestEntry, reportAssetLoadFailure, resolveGlbUrl, shouldLoadGlb } from './modelRegistry'
import { applyVariant, createVariantInstances, disposeVariantMaterials, type MaterialVariant } from './assetVariants'
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
}: {
  entry: AssetManifestEntry
  castShadow: boolean
  receiveShadow: boolean
  /** Palette variant (issue #21 §6): recolors the entry's declared material slots. */
  variant?: MaterialVariant
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

  // Clone so several landmarks can share one file; apply shadow flags; and — when the
  // entry declares palette slots (§21 §6) — isolate those materials per instance so a
  // variant can recolor walls/trim/glass without mutating the shared cache or siblings.
  const { scene, slots } = useMemo(() => {
    const cloned = gltf.scene.clone(true)
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = castShadow
        obj.receiveShadow = receiveShadow
      }
    })
    const slotMap = entry.materialSlots
    const isolated = slotMap ? createVariantInstances(cloned, slotMap, Object.keys(slotMap)) : null
    return { scene: cloned, slots: isolated }
  }, [gltf.scene, castShadow, receiveShadow, entry])

  // Dispose the per-instance isolated materials symmetrically with the memo that made them.
  useEffect(() => () => { if (slots) disposeVariantMaterials(slots) }, [slots])

  // Apply the palette variant — only the declared, isolated slots are recolored.
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

  return (
    <group name={`asset:${assetId}`} position={position} rotation-y={rotationY}>
      {useGlb ? (
        <AssetErrorBoundary assetId={assetId} fallback={children}>
          <Suspense fallback={children}>
            <GlbModel entry={entry} castShadow={castShadow} receiveShadow={receiveShadow} variant={variant} />
          </Suspense>
        </AssetErrorBoundary>
      ) : (
        children
      )}
    </group>
  )
}
