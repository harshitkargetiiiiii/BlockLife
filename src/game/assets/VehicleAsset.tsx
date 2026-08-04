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
 * from getActiveVehicleProjection(), never the model. Paint (and wheel-hub
 * tint) recolor declared material slots per-instance via the §3 variant system,
 * so one file backs every paint without duplicating geometry.
 *
 * v1 slice scope: only vehicle_compact_car_01 ships a GLB. Occupant indicator
 * spheres + the brake-light material swap remain CarMesh-only (the GLB body is
 * the real car); documented as a bounded v1 limitation.
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
    const slotMap = entry.materialSlots ?? DEFAULT_VEHICLE_SLOTS
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
export function VehicleAsset({ assetId, paint, wheelHub, children, entry: entryOverride }: VehicleAssetProps) {
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
      </Suspense>
    </VehicleErrorBoundary>
  )
}
