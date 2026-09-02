/**
 * Vehicle visual adapter (issue #21 §5). Projects an optional GLB body onto the
 * ONE physical driving shell, exactly mirroring LandmarkAsset's contract:
 * Suspense + ErrorBoundary + the shared settle counters, with a guaranteed
 * primitive fallback (CarMesh, passed as children). When no GLB is enabled for
 * the class — or one fails to load — CarMesh renders and the baseline is
 * byte-identical.
 *
 * The one-shell invariant is untouched: this component is purely the visual
 * child of Vehicle.tsx's rigid body; collider half-extents + mass still come
 * from getActiveVehicleProjection(), never the model.
 *
 * Paint recolors DECLARED material slots per-instance via the §3 variant system, so one file
 * backs every paint without duplicating geometry — but only for an asset that actually declares
 * one. An entry declaring an explicitly EMPTY slot map means "retain the source paint" and is
 * left untinted (issue #40): the Wave 1 bodies are a single baked atlas whose windows, lamps and
 * tyres share the panels' texture, so tinting it would recolor the whole vehicle.
 *
 * Since issue #40 Wave 1 all four owned classes ship a GLB body (compact sedan, scooter, utility
 * van, sports coupe); every one of them still renders through this single adapter onto the single
 * shell. `glbSiblings` renders INSIDE the Suspense/ErrorBoundary, so a caller can give a mounted
 * GLB a bounded fittings set while the `children` fallback keeps the complete one — see
 * VehicleVisual, which uses it to keep OCCUPANTS on a GLB body while dropping the procedural
 * wheels and lamps the approved models already contain. The brake-light material swap is
 * therefore procedural-body-only (the GLB's lamps are baked into its one texture and cannot be
 * lit separately); that is a recorded limitation, not a regression.
 */
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { AssetManifestEntry } from './assetManifest'
import { getManifestEntry, reportAssetLoadFailure, resolveGlbUrl, shouldLoadGlb } from './modelRegistry'
import { applyVariant, createVariantInstances, disposeVariantMaterials, type MaterialSlotMap, type MaterialVariant } from './assetVariants'
import { registry } from '../world/runtimeRegistry'

const PAINT_SLOT = 'paint'
const WHEEL_SLOT = 'wheel'
/** Fallback material-name candidates when the manifest entry declares no slots. */
const DEFAULT_VEHICLE_SLOTS: MaterialSlotMap = {
  [PAINT_SLOT]: ['paint', 'Paint', 'body', 'Body', 'carpaint', 'CarPaint'],
  [WHEEL_SLOT]: ['wheel', 'Wheel', 'tire', 'Tire', 'rim', 'Rim'],
}

export interface VehicleAssetProps {
  /** Manifest asset id for the active class, or null when the class has no GLB. */
  assetId: string | null
  /** Current paint (from the vehicle projection) — recolors the paint slot. */
  paint: string
  /** Wheel-style hub colour — recolors the wheel slot if the model has one. */
  wheelHub?: string
  /** CarMesh fallback — always kept, renders whenever the GLB can't. */
  children: ReactNode
  /**
   * Rendered ONLY alongside a GLB body that actually mounted (issue #40). It lives inside the
   * Suspense/ErrorBoundary, so it appears exactly when the model does and disappears the moment
   * the fallback takes over — which is what lets a caller give the GLB a bounded fittings set
   * while the fallback keeps the complete one.
   */
  glbSiblings?: ReactNode
  /** Injectable manifest entry for tests/tooling. */
  entry?: AssetManifestEntry
}

class VehicleErrorBoundary extends Component<
  { assetId: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
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

function VehicleGlb({
  entry,
  paint,
  wheelHub,
}: {
  entry: AssetManifestEntry
  paint: string
  wheelHub?: string
}) {
  const gltf = useGLTF(resolveGlbUrl(entry))

  useEffect(() => {
    registry.glbLandmarksActive++
    return () => {
      registry.glbLandmarksActive--
    }
  }, [])

  // One-time per instance: clone (so many painted shells share one file),
  // shadow flags, isolate the recolorable slots. Never re-traversed per frame.
  const instance = useMemo(() => {
    const scene = gltf.scene.clone(true)
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    // Merge declared slots OVER the defaults so a partial declaration (e.g. only
    // `paint`) still keeps the default `wheel` candidates — otherwise the `??`
    // dropped the wheel slot and wheel-hub recolor had nothing to target (round-2 #2).
    //
    // An EXPLICITLY EMPTY map is different from an absent one, and means "this asset exposes no
    // recolorable slots — retain its source paint" (issue #40). A body baked as one atlas —
    // windows, lights and tyres in the same texture as the panels — must not be tinted, and it
    // must not pick the defaults back up by having a material that happens to be called `body`.
    // Absent still means "use the default candidates", so no existing asset changes.
    const declared = entry.materialSlots
    const slotMap: MaterialSlotMap =
      declared && Object.keys(declared).length === 0
        ? {}
        : { ...DEFAULT_VEHICLE_SLOTS, ...(declared ?? {}) }
    const slots = createVariantInstances(scene, slotMap, [PAINT_SLOT, WHEEL_SLOT])
    return { scene, slots }
  }, [gltf.scene, entry])

  // Dispose isolated materials symmetrically with the memo that made them.
  useEffect(() => () => disposeVariantMaterials(instance.slots), [instance])

  // Paint (+ optional wheel hub) applies immediately and only to this clone.
  useEffect(() => {
    const variant: MaterialVariant = { [PAINT_SLOT]: { color: paint } }
    if (wheelHub) variant[WHEEL_SLOT] = { color: wheelHub }
    applyVariant(instance.slots, variant)
  }, [instance, paint, wheelHub])

  return (
    <primitive
      object={instance.scene}
      position={entry.positionOffset}
      rotation={entry.rotation}
      scale={entry.scale}
    />
  )
}

/**
 * Renders the GLB registered for a vehicle class when one is available and
 * enabled; otherwise (no entry, disabled, still loading, load error) the CarMesh
 * fallback renders. Gameplay/physics never depend on which branch is active.
 */
export function VehicleAsset({ assetId, paint, wheelHub, children, glbSiblings, entry: entryOverride }: VehicleAssetProps) {
  const entry = entryOverride ?? (assetId ? getManifestEntry(assetId) : undefined)
  const useGlb = shouldLoadGlb(entry)

  useEffect(() => {
    if (!useGlb) return
    registry.glbLandmarksExpected++
    return () => {
      registry.glbLandmarksExpected--
    }
  }, [useGlb])

  if (!useGlb || !entry) return <>{children}</>
  return (
    <VehicleErrorBoundary assetId={entry.id} fallback={children}>
      <Suspense fallback={children}>
        <VehicleGlb entry={entry} paint={paint} wheelHub={wheelHub} />
        {glbSiblings}
      </Suspense>
    </VehicleErrorBoundary>
  )
}
