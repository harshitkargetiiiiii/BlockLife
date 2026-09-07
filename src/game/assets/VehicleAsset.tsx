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
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { AssetManifestEntry } from './assetManifest'
import { getManifestEntry, markGlbBranch, noteGlbExpected, releaseGlbBranch, reportAssetLoadFailure, resolveGlbUrl, shouldLoadGlb } from './modelRegistry'
import { applyVariant, createVariantInstances, disposeVariantMaterials, type MaterialSlotMap, type MaterialVariant } from './assetVariants'
import { markAssetStage } from './assetStallProbe'
import { createMaskedPaintMaterial, setMaskedPaintColor, usePaintMask, wheelNodeTransform, type MaskedPaintMaterial, type PaintMaskState } from './maskedPaint'
import { noteGlbLandmarkChange, registry } from '../world/runtimeRegistry'

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
  /**
   * Wheel-style radius multiplier. The procedural fallback has always scaled its own wheel meshes
   * by this; issue #50 gives it somewhere to land on a GLB body too, for an entry whose derived
   * segmentation produced real wheel pivots. Ignored by every other body.
   */
  wheelScale?: number
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
  /**
   * See AssetErrorBoundary: the counter is a live census, so the failure is released on unmount —
   * and released against the id it was COUNTED for. The one shell projects whichever class is
   * active, so this boundary's `assetId` really does change from under it when the player
   * retrieves a different vehicle; releasing `this.props.assetId` would decrement the new class's
   * branch and strand the old one's.
   */
  private countedAssetId: string | null = null
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentWillUnmount(): void {
    const id = this.countedAssetId
    if (id === null) return
    this.countedAssetId = null
    registry.glbLandmarksFailed--
    noteGlbLandmarkChange()
    releaseGlbBranch(id, 'failed')
  }
  componentDidCatch(error: Error): void {
    if (this.countedAssetId === null) {
      this.countedAssetId = this.props.assetId
      registry.glbLandmarksFailed++
      noteGlbLandmarkChange()
      // Record the REAL branch, exactly as LandmarkAsset does. Without this a vehicle body is
      // invisible to `isGlbBodyRendering` and to the readiness API a visual spec uses to prove
      // WHICH body it is photographing (issue #46 §4) — the shot could only ever wait for
      // "loading finished", never for "the van is on screen".
      markGlbBranch(this.props.assetId, 'failed')
    }
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
  wheelScale,
  paintMaskState = null,
}: {
  entry: AssetManifestEntry
  paint: string
  wheelHub?: string
  /** Wheel-style radius multiplier — only meaningful for a body with derived wheel pivots. */
  wheelScale?: number
  /**
   * The derived contribution map's load state (issue #50), or null for a body that declares none.
   *
   * Three outcomes, kept apart on purpose. `pending` renders the body in its authored paint but
   * does NOT satisfy readiness. `error` is a failed REQUIRED asset and is rethrown here, inside the
   * boundary, so the complete procedural car and the `glbFailed` accounting behave exactly as they
   * do for a failed model. Only `ready` marks the branch active.
   */
  paintMaskState?: PaintMaskState | null
}) {
  // A required companion map that FAILED is an asset failure, raised where the boundary can see
  // it. Raised before the model hook so the two failures are indistinguishable to everything
  // downstream — same fallback, same counters, same branch.
  if (paintMaskState?.status === 'error') {
    throw paintMaskState.error instanceof Error
      ? paintMaskState.error
      : new Error(`paint contribution map failed for ${entry.id}`)
  }
  const paintMask = paintMaskState?.status === 'ready' ? (paintMaskState.texture ?? undefined) : undefined
  const maskReady = !paintMaskState || paintMaskState.status === 'ready'
  const gltf = useGLTF(resolveGlbUrl(entry))
  // Issue #47 shard 8 probe (DEV only, one asset). Reaching this line means parse, decode and
  // Suspense-resume have ALL succeeded; its ABSENCE leaves those three undistinguished.
  if (import.meta.env.DEV) markAssetStage(entry.id, 'hook-returned')

  useEffect(() => {
    // For a body with a companion map, "on screen" means on screen WEARING ITS PAINT. Marking the
    // branch active a frame earlier would let a visual gate photograph the authored colour and call
    // it the saved one. A map that FAILED never reaches here at all — it threw above, and the
    // boundary counts it as a failed asset — so readiness cannot hang on one either.
    if (!maskReady) return
    if (import.meta.env.DEV) markAssetStage(entry.id, 'active-effect')
    registry.glbLandmarksActive++
    noteGlbLandmarkChange()
    markGlbBranch(entry.id, 'active')
    return () => {
      registry.glbLandmarksActive--
      noteGlbLandmarkChange()
      releaseGlbBranch(entry.id, 'active')
    }
  }, [entry.id, maskReady])

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
    // Issue #50: a baked-atlas body has no recolorable slot, so the empty map above isolates
    // nothing. Its paint comes from the DERIVED mask instead — one cloned material per painted
    // group, per instance, exactly as the slot path clones per instance so two vehicles of one
    // class can wear different colours from one file.
    const masked: { body: MaskedPaintMaterial | null; wheel: MaskedPaintMaterial | null } = { body: null, wheel: null }
    const declaration = entry.paintMask
    if (declaration && paintMask) {
      const byName = new Map<string, MaskedPaintMaterial>()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return
        const name = mesh.material.name
        if (name !== declaration.bodyMaterial && name !== declaration.wheelMaterial) return
        let target = byName.get(name)
        if (!target) {
          target = createMaskedPaintMaterial(mesh.material, paintMask, declaration.referenceColor)
          byName.set(name, target)
        }
        mesh.material = target.material
      })
      masked.body = byName.get(declaration.bodyMaterial) ?? null
      masked.wheel = byName.get(declaration.wheelMaterial) ?? null
    }
    // The wheel pivots the segmentation step produced, resolved ONCE. Each keeps its authored
    // translation so a style change sets an absolute transform rather than compounding one.
    const wheels = (declaration?.wheelNodes ?? []).flatMap((w) => {
      const node = scene.getObjectByName(w.name)
      return node ? [{ node, radius: w.radius, baseY: node.position.y }] : []
    })
    if (import.meta.env.DEV) markAssetStage(entry.id, 'clone-built')
    return { scene, slots, masked, wheels }
  }, [gltf.scene, entry, paintMask])

  // 3. React actually COMMITTED this subtree (layout phase runs before paint and before passive
  //    effects), so a gap between 'clone-built' and here is a render that was thrown away.
  useLayoutEffect(() => {
    if (import.meta.env.DEV) markAssetStage(entry.id, 'react-commit')
  }, [entry.id, instance])

  // Dispose isolated materials symmetrically with the memo that made them.
  useEffect(() => () => {
    disposeVariantMaterials(instance.slots)
    instance.masked.body?.material.dispose()
    instance.masked.wheel?.material.dispose()
  }, [instance])

  // Paint (+ optional wheel hub) applies immediately and only to this clone. Both paths run: an
  // asset declares EITHER material slots OR a derived mask, and each is a no-op for the other.
  useEffect(() => {
    const variant: MaterialVariant = { [PAINT_SLOT]: { color: paint } }
    if (wheelHub) variant[WHEEL_SLOT] = { color: wheelHub }
    applyVariant(instance.slots, variant)
    if (instance.masked.body) setMaskedPaintColor(instance.masked.body, paint)
    // The wheel group's masked texels are the painted RIM; the tyre is outside the mask and stays
    // black. With no style chosen the source colour is kept rather than guessed at.
    if (instance.masked.wheel) setMaskedPaintColor(instance.masked.wheel, wheelHub)
  }, [instance, paint, wheelHub])

  // Wheel size (issue #50 §9). Absolute, never accumulated: the scale is set from the style and
  // the position from the wheel's own authored Y, so ten style changes leave the same transform as
  // one. The lift keeps the contact patch on the road when the radius grows.
  useEffect(() => {
    for (const wheel of instance.wheels) {
      const { scale, liftY } = wheelNodeTransform(wheel.radius, wheelScale ?? 1, entry.paintMask?.maxWheelRadiusScale)
      wheel.node.scale.set(scale[0], scale[1], scale[2])
      wheel.node.position.y = wheel.baseY + liftY
    }
  }, [instance, wheelScale])

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
export function VehicleAsset({ assetId, paint, wheelHub, wheelScale, children, glbSiblings, entry: entryOverride }: VehicleAssetProps) {
  const entry = entryOverride ?? (assetId ? getManifestEntry(assetId) : undefined)
  const useGlb = shouldLoadGlb(entry)
  // Started HERE, in the component that never suspends, so the map and the model load in parallel
  // and the boundary below keeps exactly ONE suspending resource — see `usePaintMask` for the
  // measurement that made that matter.
  const mask = usePaintMask(useGlb && entry?.paintMask ? `${import.meta.env.BASE_URL}${entry.paintMask.path}` : null)

  useEffect(() => {
    if (!useGlb) return
    registry.glbLandmarksExpected++
    if (entry) noteGlbExpected(entry.id, 1)
    noteGlbLandmarkChange()
    return () => {
      registry.glbLandmarksExpected--
      if (entry) noteGlbExpected(entry.id, -1)
      noteGlbLandmarkChange()
      // Branch claims are released by whoever took them (the model effect / the boundary), so a
      // parked vehicle unmounting cannot clear the branch of an identical one still on screen.
    }
  }, [useGlb, entry])

  if (!useGlb || !entry) return <>{children}</>
  // The boundary is keyed by the body id: the ONE shell swaps class, so a failure counted
  // against the old body must be released and the new one must not inherit `state.failed`
  // (issue #46 §4).
  return (
    <VehicleErrorBoundary key={entry.id} assetId={entry.id} fallback={children}>
      <Suspense fallback={children}>
        <VehicleGlb
          entry={entry}
          paint={paint}
          wheelHub={wheelHub}
          wheelScale={wheelScale}
          paintMaskState={entry.paintMask ? mask : null}
        />
        {glbSiblings}
      </Suspense>
    </VehicleErrorBoundary>
  )
}
