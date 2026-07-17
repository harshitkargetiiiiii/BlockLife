import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { OccluderDescriptor, RegisteredOccluder } from './visibilityTypes'
import { getCandidateOccluders, type CameraPoint } from './occlusionBroadPhase'
import {
  countBlockedSamples,
  snapOcclusionState,
  stepOcclusionState,
} from './occlusionDetection'
import { applyFade, restoreOriginalMaterials, swapToFadeMaterials } from './materialFade'
import {
  clearAllFades,
  getActiveVisibilitySubject,
  TELEPORT_DISTANCE,
  visibilityRuntime,
} from './visibilityRuntime'
import { useGameStore } from '../store/useGameStore'
import { registry } from '../world/runtimeRegistry'

/** Broad-phase corridor padding (covers the subject's readable width). */
const BROAD_PADDING = 1.2
/** Deterministic cap on simultaneous fades; ranked by intersection strength
    then proximity to the subject. Restores are never capped. */
const MAX_SIMULTANEOUS_FADES = 4

// Scratch structures — reused every frame, no per-frame allocation.
const candidateScratch: OccluderDescriptor[] = []
const occludedScratch: { occ: RegisteredOccluder; blocked: number; dist: number }[] = []
const occludedRank = new Map<RegisteredOccluder, number>()
const cameraScratch: CameraPoint = { x: 0, y: 0, z: 0 }

/**
 * The per-frame visibility driver. Broad phase → precise phase → hysteresis
 * → imperative material fades. Runs inside the Canvas; touches no React
 * state. Inactive occluders cost one Map iteration and a rect test.
 */
export function OcclusionManager() {
  const pauseSeq = useRef(-1)

  useFrame(({ camera }, rawDt) => {
    const runtime = visibilityRuntime
    const store = useGameStore.getState()
    const dt = Math.min(rawDt, 0.1)
    const now = performance.now() / 1000

    // Disabled (test API) or indoors: everything restores instantly.
    const subject = runtime.enabled ? getActiveVisibilitySubject() : null
    if (!subject) {
      if (runtime.debug.fadedIds.length > 0 || runtime.hasLastSubject) clearAllFades()
      runtime.debug.subjectId = null
      runtime.debug.subjectKind = null
      runtime.debug.candidateCount = 0
      return
    }

    // Teleports (test API, save/load, apartment exit): clear stale fades and
    // re-detect fresh this same frame.
    if (runtime.hasLastSubject) {
      const jump = Math.hypot(subject.x - runtime.lastSubjectX, subject.z - runtime.lastSubjectZ)
      if (jump > TELEPORT_DISTANCE) clearAllFades()
    }
    runtime.lastSubjectX = subject.x
    runtime.lastSubjectZ = subject.z
    runtime.hasLastSubject = true
    runtime.debug.subjectId = subject.id
    runtime.debug.subjectKind = subject.kind

    cameraScratch.x = camera.position.x
    cameraScratch.y = camera.position.y
    cameraScratch.z = camera.position.z

    // Broad phase over the cached descriptor list (pure rect math).
    const candidateCount = getCandidateOccluders(
      cameraScratch,
      subject,
      runtime.descriptorCache,
      BROAD_PADDING,
      candidateScratch,
    )
    runtime.debug.candidateCount = candidateCount

    // Precise phase: exact sight-line-vs-volume per candidate, then rank.
    occludedScratch.length = 0
    for (let i = 0; i < candidateCount; i++) {
      const reg = runtime.occluders.get(candidateScratch[i].id)
      if (!reg) continue
      const blocked = countBlockedSamples(cameraScratch, subject, reg.descriptor)
      if (blocked >= subject.minBlockedSamples) {
        const b = reg.descriptor.bounds2D
        const cx = (b.minX + b.maxX) / 2
        const cz = (b.minZ + b.maxZ) / 2
        occludedScratch.push({
          occ: reg,
          blocked,
          dist: Math.hypot(cx - subject.x, cz - subject.z),
        })
      }
    }
    runtime.debug.lastPrecise = candidateCount > 0
      ? `${candidateScratch[0].id}: ${countBlockedSamples(cameraScratch, subject, candidateScratch[0])}/${subject.minBlockedSamples} cam(${cameraScratch.x.toFixed(1)},${cameraScratch.y.toFixed(1)},${cameraScratch.z.toFixed(1)}) sub(${subject.x.toFixed(1)},${subject.z.toFixed(1)})`
      : 'none'
    occludedScratch.sort((a, b) => b.blocked - a.blocked || a.dist - b.dist)
    occludedRank.clear()
    for (let i = 0; i < occludedScratch.length; i++) {
      occludedRank.set(occludedScratch[i].occ, i)
    }

    // Snap fades once per pause so screenshots are deterministic.
    const snap = store.worldPaused && pauseSeq.current !== registry.pauseSeq
    if (snap) pauseSeq.current = registry.pauseSeq

    runtime.debug.fadedIds.length = 0
    for (const reg of runtime.occluders.values()) {
      if (reg.descriptor.linkedTo) {
        // Linked decals mirror their building's state exactly.
        const parent = runtime.occluders.get(reg.descriptor.linkedTo)
        if (parent) {
          reg.state.targetOpacity = parent.state.targetOpacity
          reg.state.currentOpacity = parent.state.currentOpacity
          reg.state.reason = `linked to ${parent.descriptor.id}`
        }
      } else {
        const rank = occludedRank.get(reg)
        const occludedNow = rank !== undefined && rank < MAX_SIMULTANEOUS_FADES
        const blocked = rank !== undefined ? occludedScratch[rank].blocked : 0
        stepOcclusionState(reg.state, occludedNow, blocked, reg.descriptor, now, dt)
        if (snap) snapOcclusionState(reg.state)
      }

      // Apply: swap in fade materials while below full opacity; restore
      // originals exactly once fully back.
      if (reg.state.currentOpacity < 1) {
        swapToFadeMaterials(reg)
        applyFade(reg, reg.state.currentOpacity)
        if (reg.state.currentOpacity < 0.999) runtime.debug.fadedIds.push(reg.descriptor.id)
      } else if (reg.swapped) {
        restoreOriginalMaterials(reg)
      }
    }
  })

  return null
}
