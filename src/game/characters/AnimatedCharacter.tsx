import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type {
  CharacterAppearance,
  CharacterAssetDefinition,
  CharacterMotionState,
  CharacterQualityTier,
  CharacterRenderMode,
} from './characterTypes'
import { resolveClips } from './characterManifest'
import { CharacterAnimationController } from './CharacterAnimationController'
import {
  applyCharacterAppearance,
  applyCharacterVariants,
  bodyBuildScale,
  createCustomizableMaterialInstances,
  disposeIsolatedMaterials,
} from './characterMaterials'
import {
  characterRuntime,
  createCharacterInstanceInfo,
  registerCharacterInstance,
  unregisterCharacterInstance,
  type CharacterInstanceInfo,
} from './characterRuntime'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'

export interface AnimatedCharacterProps {
  /** Stable instance id ('player', npc id, …). */
  instanceId: string
  tier: CharacterQualityTier
  def: CharacterAssetDefinition
  appearance: CharacterAppearance
  /** Normalized motion supplier, called once per frame (no allocations). */
  getMotion: (dt: number) => CharacterMotionState
  renderMode?: CharacterRenderMode
  /** Optional per-frame gate: when it returns false the animation mixer is NOT
   *  advanced this frame (the model holds its pose). Used to skip the skinning/mixer
   *  cost for hidden actors — e.g. an ambient citizen whose sector is dormant — so
   *  the bounded rigged crowd never adds per-frame cost for anyone off-screen. Omitted
   *  ⇒ always animate (player + named NPCs are unchanged). */
  active?: () => boolean
  /** Primitive fallback — always available, wardrobe-colored. */
  fallback: ReactNode
}

class ModelErrorBoundary extends Component<
  { info: CharacterInstanceInfo; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(error: Error): void {
    this.props.info.fallbackReason = error.message
    this.props.info.activeVisual = 'primitive'
    if (import.meta.env.DEV) {
      console.warn(`[characters] "${this.props.info.id}" fell back to primitive:`, error.message)
    }
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function resolveModelUrl(def: CharacterAssetDefinition): string {
  return `${import.meta.env.BASE_URL}${def.modelPath}`
}

function ModelInstance({
  def,
  appearance,
  getMotion,
  active,
  info,
}: {
  def: CharacterAssetDefinition
  appearance: CharacterAppearance
  getMotion: (dt: number) => CharacterMotionState
  active?: () => boolean
  info: CharacterInstanceInfo
}) {
  const gltf = useGLTF(resolveModelUrl(def))
  const pauseSeq = useRef(-1)
  const proofT = useRef<number | null>(null)
  const controllerRef = useRef<CharacterAnimationController | null>(null)

  // One-time per instance: skeleton-safe clone, material isolation, clip
  // resolution. Pure with respect to shared state (the clone is ours), so
  // it's safe in useMemo. Never re-traversed per frame.
  const instance = useMemo(() => {
    const scene = cloneSkinnedScene(gltf.scene)
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        // Skinned bounds don't track animation; skip per-mesh culling.
        mesh.frustumCulled = false
      }
    })
    const slots = createCustomizableMaterialInstances(def, scene)
    const { resolved, missing } = resolveClips(def, gltf.animations)
    if (missing.length > 0) {
      throw new Error(`missing required clips: ${missing.join(', ')}`)
    }
    if (def.skeletonRootName && !scene.getObjectByName(def.skeletonRootName)) {
      throw new Error(`skeleton root "${def.skeletonRootName}" not found`)
    }
    return { scene, slots, resolved, clipRoles: Object.keys(resolved) }
  }, [gltf, def])

  // Controller + registry state live in an effect so setup/teardown stay
  // symmetric: a StrictMode (or HMR) remount disposes the mixer and builds a
  // fresh one instead of leaving a disposed controller behind.
  useEffect(() => {
    const controller = new CharacterAnimationController(instance.scene, def, instance.resolved)
    controllerRef.current = controller
    info.modelLoaded = true
    info.activeVisual = 'model'
    info.fallbackReason = null
    info.resolvedSlots = Object.keys(instance.slots)
    return () => {
      controllerRef.current = null
      controller.dispose()
      // Disposed-but-still-assigned materials recompile on next use, so a
      // remount reusing the memoized clone stays healthy.
      disposeIsolatedMaterials(instance.slots)
      info.modelLoaded = false
      info.activeVisual = 'primitive'
    }
  }, [instance, def, info])

  // Wardrobe: colors apply immediately and only to THIS instance.
  useEffect(() => {
    applyCharacterAppearance(instance.slots, appearance)
    // Issue #23 (PR #24): show this identity's hair + accessory variant meshes (hide the
    // rest). Body build is composed into the render scale below. No-op on variant-less rigs.
    applyCharacterVariants(instance.scene, appearance)
    info.appearance = { ...appearance }
  }, [instance, appearance, info])

  useFrame((_, rawDt) => {
    const controller = controllerRef.current
    if (!controller) return
    const dt = Math.min(rawDt, 0.1)
    const paused = useGameStore.getState().worldPaused
    if (paused) {
      // Deterministic pose for visual tests: freeze at clip t=0 once per pause. Issue #27 H0
      // proof: a DEV proofFreezeTime freezes the current clip at an arbitrary time so a motion
      // review can step through one clip's frames (re-freezes whenever the target time changes).
      const pt = characterRuntime.proofFreezeTime
      if (pauseSeq.current !== registry.pauseSeq || proofT.current !== pt) {
        pauseSeq.current = registry.pauseSeq
        proofT.current = pt
        controller.freezeAt(pt ?? 0)
      }
      return
    }
    if (controller.frozen) controller.unfreeze()

    // Hidden actors (e.g. an ambient citizen in a dormant sector) hold their pose —
    // skipping the mixer keeps the bounded rigged crowd from adding any per-frame cost
    // for anyone off-screen (headless-sim perf; CONVENTIONS #18).
    if (active && !active()) return

    const motion = getMotion(dt)
    // Debug override (dev/test): force a gait without touching gameplay.
    const forced = characterRuntime.forcedAnimation
    if (forced) {
      motion.locomotion = forced
      motion.speed = forced === 'run' ? 6 : forced === 'walk' ? 3 : 0
    }
    controller.update(motion, dt)

    info.animState = controller.current
    info.previousAnimState = controller.previous
    info.playbackRate = controller.currentRate
    info.speed = motion.speed
    info.facingAngle = motion.facingAngle
    info.activeActionCount = controller.activeActionCount
  })

  // Body silhouette (issue #23): compose the scale-safe build onto the asset scale.
  const build = bodyBuildScale(appearance)
  return (
    <primitive
      object={instance.scene}
      scale={[def.scale * build[0], def.scale * build[1], def.scale * build[2]]}
      rotation-y={def.rotationOffset ?? 0}
      position-y={def.verticalOffset ?? 0}
    />
  )
}

/**
 * The reusable animated character: GLB model with semantic animation when
 * available, primitive fallback otherwise (load failure, missing clips,
 * forced mode, tests). Gameplay transforms live on the PARENT group —
 * this component is purely visual.
 */
export function AnimatedCharacter({
  instanceId,
  tier,
  def,
  appearance,
  getMotion,
  active,
  renderMode = 'auto',
  fallback,
}: AnimatedCharacterProps) {
  const info = useMemo(
    () => createCharacterInstanceInfo(instanceId, tier, def),
    [instanceId, tier, def],
  )
  // Registration is an effect so StrictMode's unmount/remount cycle
  // re-registers; the unregister call is identity-guarded in the runtime.
  useEffect(() => {
    registerCharacterInstance(info)
    return () => unregisterCharacterInstance(info)
  }, [info])

  // The global mode lives in the store so debug/test switches re-render.
  const globalMode = useGameStore((s) => s.characterRenderMode)
  const mode = globalMode !== 'auto' ? globalMode : renderMode
  info.renderMode = mode
  if (mode === 'primitive') {
    info.activeVisual = 'primitive'
    info.fallbackReason = 'forced primitive mode'
    return <>{fallback}</>
  }

  return (
    <ModelErrorBoundary info={info} fallback={fallback}>
      <Suspense fallback={fallback}>
        <ModelInstance
          def={def}
          appearance={appearance}
          getMotion={getMotion}
          active={active}
          info={info}
        />
      </Suspense>
    </ModelErrorBoundary>
  )
}
