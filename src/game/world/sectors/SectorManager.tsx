import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../../store/useGameStore'
import { registry } from '../runtimeRegistry'
import { APARTMENT_STREET_EXIT } from '../../interiors/apartmentLayout'
import type { SectorId } from './worldGrid'
import { worldToSectorId } from './worldGrid'
import {
  getMountedSectorEntries,
  reportSectorColliders,
  reportSectorVisuals,
  streamingRuntime,
  updateStreaming,
  type StreamingContext,
} from './sectorStreaming'
import { getRoutePrewarmSectorIds } from '../../traffic/routing/segmentSectors'
import {
  completeTeleport,
  isTeleportDestinationReady,
  teleportRuntime,
} from './teleportCoordinator'
import { stepPlayerSafetyRing } from './sectorSafetyRing'
import { commitPlayerTeleport } from '../runtimeRegistry'

/**
 * Sector-root rendering. The streaming DIRECTOR ticks the runtime from the
 * frame loop (module state, never React); the visual/collider MANAGERS
 * sample the mounted set and re-render only when membership changes — no
 * per-frame React churn.
 *
 * Growth contract: register a visuals/colliders component pair per sector
 * id here; everything else (lifecycle, readiness, policy) is generic.
 */

export interface SectorComponents {
  Visuals?: ComponentType
  Colliders?: ComponentType
}

const SECTOR_COMPONENTS = new Map<SectorId, SectorComponents>()

export function registerSectorComponents(id: SectorId, components: SectorComponents): void {
  SECTOR_COMPONENTS.set(id, components)
}

// ---- Streaming director (frame loop → runtime tick) -----------------------

const contextScratch: StreamingContext = {
  playerX: 0,
  playerZ: 0,
  playerVelocityX: 0,
  playerVelocityZ: 0,
  locationMode: 'city',
  teleportDestinationSectorId: null,
  pinnedSectorIds: [],
  routedVehiclePrewarmSectorIds: [],
}
const pinnedScratch: SectorId[] = []

export function SectorDirector() {
  const last = useRef({ x: 0, z: 0, has: false, vx: 0, vz: 0 })

  useFrame(({ clock }, dt) => {
    const store = useGameStore.getState()
    const indoors = store.location === 'apartment'
    // Streaming follows the ACTIVE avatar: the car while driving (the
    // walking-player position goes stale the moment you get in), else the
    // player. Indoors the interior sits far outside the authored grid —
    // anchor to the street entrance and pin its sector so the exit always
    // returns to ready ground.
    const avatar = store.mode === 'driving' ? registry.vehiclePosition : registry.playerPosition
    const anchorX = indoors ? APARTMENT_STREET_EXIT[0] : avatar.x
    const anchorZ = indoors ? APARTMENT_STREET_EXIT[2] : avatar.z

    const l = last.current
    if (l.has && dt > 0 && !indoors) {
      const rawVx = (anchorX - l.x) / dt
      const rawVz = (anchorZ - l.z) / dt
      // Light smoothing; teleports (big jumps) reset the lead vector.
      if (Math.hypot(anchorX - l.x, anchorZ - l.z) > 20) {
        l.vx = 0
        l.vz = 0
      } else {
        l.vx += (rawVx - l.vx) * Math.min(1, dt * 6)
        l.vz += (rawVz - l.vz) * Math.min(1, dt * 6)
      }
    }
    l.x = anchorX
    l.z = anchorZ
    l.has = true

    pinnedScratch.length = 0
    pinnedScratch.push(worldToSectorId(APARTMENT_STREET_EXIT[0], APARTMENT_STREET_EXIT[2]))

    contextScratch.playerX = anchorX
    contextScratch.playerZ = anchorZ
    contextScratch.playerVelocityX = l.vx
    contextScratch.playerVelocityZ = l.vz
    contextScratch.locationMode = indoors ? 'apartment' : 'city'
    contextScratch.teleportDestinationSectorId = teleportRuntime.destinationSectorId
    contextScratch.pinnedSectorIds = pinnedScratch
    contextScratch.routedVehiclePrewarmSectorIds = getRoutePrewarmSectorIds()

    updateStreaming(contextScratch, clock.elapsedTime * 1000)

    // Safety ring (issue §6): after the streaming tick, evaluate coverage
    // around the active subject and run the bounded stuck-sector watchdog. The
    // movement backstop that consumes this is applied in the Player/Vehicle
    // controllers; here we only observe + self-heal.
    stepPlayerSafetyRing(
      {
        playerX: anchorX,
        playerZ: anchorZ,
        playerVelocityX: l.vx,
        playerVelocityZ: l.vz,
        locationMode: indoors ? 'apartment' : 'city',
      },
      clock.elapsedTime * 1000,
    )

    // Deferred teleport: commit the held move once the destination sector
    // reports ready (it streams at top priority via the context above).
    if (teleportRuntime.pendingPosition && isTeleportDestinationReady()) {
      const position = teleportRuntime.pendingPosition
      const seq = teleportRuntime.requestSeq
      commitPlayerTeleport(position)
      completeTeleport(seq)
    }
  })
  return null
}

// ---- Mounted-set sampling (React re-renders only on membership change) ----

/**
 * Samples the mounted set INCLUDING generation tokens. The generation must be
 * part of the sampled key and of each root's React key: an unload→reload makes
 * a new incarnation that has to remount and re-report readiness. Keying on the
 * id alone let React coalesce the unmount+remount into "no change" (likelier
 * under load, when renders batch), so the readiness effect never re-ran — and
 * since `stepLifecycle` clears the ready flags on unloaded→loading and only
 * leaves `loading` once they are true again, the sector wedged in `loading`
 * permanently: a hole in the world you could fall through.
 */
function useMountedSectors(): { id: SectorId; generation: number }[] {
  const [mounted, setMounted] = useState(() => getMountedSectorEntries())
  const key = useRef(entriesKey(mounted))
  useFrame(() => {
    const next = getMountedSectorEntries()
    const nextKey = entriesKey(next)
    if (nextKey !== key.current) {
      key.current = nextKey
      setMounted(next)
    }
  })
  return mounted
}

function entriesKey(entries: { id: SectorId; generation: number }[]): string {
  return entries.map((e) => `${e.id}:${e.generation}`).join(',')
}

/** Reports visual readiness for a mounted sector root. */
function SectorVisualRoot({
  id,
  generation,
  children,
}: {
  id: SectorId
  generation: number
  children: React.ReactNode
}) {
  // `generation` is the one this root was RENDERED for — never re-read it from
  // the runtime at effect time, or the report can name a newer incarnation than
  // the one that actually mounted.
  useEffect(() => {
    reportSectorVisuals(id, generation, true)
    return () => reportSectorVisuals(id, generation, false)
  }, [id, generation])
  return <group name={`sector-${id}`}>{children}</group>
}

function SectorColliderRoot({
  id,
  generation,
  children,
}: {
  id: SectorId
  generation: number
  children: React.ReactNode
}) {
  useEffect(() => {
    reportSectorColliders(id, generation, true)
    return () => reportSectorColliders(id, generation, false)
  }, [id, generation])
  return <>{children}</>
}

/** All mounted sectors' visual roots (outside physics). */
export function SectorVisuals() {
  const mounted = useMountedSectors()
  return (
    <group name="sectors">
      {mounted.map(({ id, generation }) => {
        const components = SECTOR_COMPONENTS.get(id)
        const Visuals = components?.Visuals
        return (
          <SectorVisualRoot key={`${id}:${generation}`} id={id} generation={generation}>
            {Visuals ? <Visuals /> : null}
          </SectorVisualRoot>
        )
      })}
    </group>
  )
}

/** All mounted sectors' collider roots (inside <Physics>). */
export function SectorColliders() {
  const mounted = useMountedSectors()
  return (
    <>
      {mounted.map(({ id, generation }) => {
        const components = SECTOR_COMPONENTS.get(id)
        const Colliders = components?.Colliders
        return (
          <SectorColliderRoot key={`${id}:${generation}`} id={id} generation={generation}>
            {Colliders ? <Colliders /> : null}
          </SectorColliderRoot>
        )
      })}
    </>
  )
}

/** Debug/test helper: streaming runtime reference for the panel. */
export function getStreamingRuntimeForDebug() {
  return streamingRuntime
}
