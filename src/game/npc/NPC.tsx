import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { NPCDef } from './npcTypes'
import { getRoutineForHour, moveTowards } from './npcBehavior'
import type { Vec2 } from '../world/worldTypes'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { lerpAngle } from '../utils/math'
import { pushOutOfCircle } from '../world/trafficAvoidance'
import { resolvePersonOccupancy } from '../world/integrity/personOccupancy'
import { CROSSWALKS, SIGNALLED_CROSSWALK_IDS } from '../traffic/trafficData'
import { decidePedestrian } from '../traffic/pedestrianRules'
import { getPedestrianSignal, getPhaseAt } from '../traffic/signalRules'
import { gateEntitySimulation } from '../world/sectors/sectorSimulation'
import { panicFleeStep } from '../combat/panicFlee'
import { getCrimeGameTime } from '../crime/crimeSystem'
import type { PedestrianState } from '../traffic/trafficTypes'
import {
  collectCarViews,
  trafficRuntime,
  type PedestrianRuntime,
} from '../traffic/trafficRuntime'
import { WorldLabel } from '../ui3d/WorldLabel'

/** Pedestrians keep this much distance from any car's center. */
const CAR_CLEARANCE = 2.3
const PLAYER_CLEARANCE = 0.85
/** A rolling car this close makes an NPC read as stepping aside. */
const YIELD_AWARENESS = 3.2
import { SpeechBubble } from '../ui3d/SpeechBubble'
import { NpcCharacter } from '../characters/NpcCharacter'
import { characterRuntime } from '../characters/characterRuntime'
import { COFFEE_QUEST_ID } from '../../data/quests'

function NPCMesh({ def }: { def: NPCDef }) {
  return (
    <group name="npc-mesh">
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.34, 1.1, 10]} />
        <meshStandardMaterial color={def.bodyColor} />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow>
        <sphereGeometry args={[0.29, 14, 14]} />
        <meshStandardMaterial color={def.headColor} />
      </mesh>
      <mesh position={[-0.1, 1.43, 0.25]}>
        <sphereGeometry args={[0.035, 6, 6]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      <mesh position={[0.1, 1.43, 0.25]}>
        <sphereGeometry args={[0.035, 6, 6]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      {/* Officer Kim gets a cap */}
      {def.id === 'npc_kim_01' && (
        <mesh position={[0, 1.66, 0]}>
          <cylinderGeometry args={[0.24, 0.3, 0.16, 10]} />
          <meshStandardMaterial color="#2c3e5f" />
        </mesh>
      )}
    </group>
  )
}

/** Floating "!" over the quest giver while the coffee quest is available or deliverable. */
function QuestIndicator({ def }: { def: NPCDef }) {
  const questState = useGameStore((s) => s.questStates[COFFEE_QUEST_ID])
  if (def.id !== 'npc_ravi_01') return null
  if (questState === 'not_started') {
    return <WorldLabel text="!" className="quest-marker" offset={2.9} />
  }
  if (questState === 'has_coffee') {
    return <WorldLabel text="☕!" className="quest-marker" offset={2.9} />
  }
  return null
}

/**
 * A resident of the block: follows a data-driven routine, walks between
 * waypoints, bobs while walking, and occasionally says something out loud.
 */
export function NPC({ def }: { def: NPCDef }) {
  const group = useRef<THREE.Group>(null)
  const [bubble, setBubble] = useState<string | null>(null)

  const runtime = useRef({
    pos: [...getRoutineForHour(def, 8).points[0]] as Vec2,
    waypointIndex: 0,
    heading: 0,
    lod: { reducedDt: 0 },
    // Stagger first lines so the block doesn't all talk at once on load.
    nextBubbleAt: 10 + Math.random() * 16,
    bubbleUntil: 0,
    walking: false,
    pedState: 'walking_sidewalk' as PedestrianState,
    crosswalkId: null as string | null,
    waitTime: 0,
    pauseSeq: 0,
  })

  useEffect(() => {
    const p = runtime.current.pos
    registry.npcPositions.set(def.id, new THREE.Vector3(p[0], 0, p[1]))
    const pedRuntime: PedestrianRuntime = {
      id: def.id,
      x: p[0],
      z: p[1],
      state: 'walking_sidewalk',
      waitingAtCrosswalkId: null,
      crossingCrosswalkId: null,
      waitTime: 0,
    }
    trafficRuntime.pedestrians.set(def.id, pedRuntime)
    return () => {
      registry.npcPositions.delete(def.id)
      registry.movingPersonIds.delete(def.id)
      trafficRuntime.pedestrians.delete(def.id)
    }
  }, [def.id])

  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    const store = useGameStore.getState()
    const rt = runtime.current

    if (store.worldPaused) {
      // Snap to the canonical routine anchor once per pause so paused frames
      // are deterministic (visual regression tests rely on this).
      if (rt.pauseSeq !== registry.pauseSeq) {
        rt.pauseSeq = registry.pauseSeq
        const routine = getRoutineForHour(def, store.stats.hour)
        rt.pos = [...routine.points[0]] as Vec2
        rt.heading = 0
        rt.walking = false
        rt.pedState = 'walking_sidewalk'
        rt.waitTime = 0
        if (bubble) setBubble(null)
      }
    } else {
      // Dev/test repositioning (consumed once).
      const override = trafficRuntime.npcOverrides.get(def.id)
      if (override) {
        trafficRuntime.npcOverrides.delete(def.id)
        rt.pos = [override.position[0], override.position[1]]
        if (override.waypointIndex !== undefined) rt.waypointIndex = override.waypointIndex
        rt.pedState = 'walking_sidewalk'
        rt.waitTime = 0
      }

      // Sector simulation LOD: hidden + paused while the NPC's sector is
      // unmounted (identity/memory/schedule persist); ~15 Hz in warm
      // sectors. Character animation pauses with the skipped frames.
      const gate = gateEntitySimulation(rt.pos[0], rt.pos[1], dt, rt.lod)
      if (!gate.simulate) {
        if (g.visible) {
          g.visible = false
          if (bubble) setBubble(null)
        }
        return
      }
      if (!g.visible) g.visible = true
      if (gate.stepDt === 0) return
      dt = gate.stepDt

      const routine = getRoutineForHour(def, store.stats.hour)
      const target =
        routine.mode === 'idle'
          ? routine.points[0]
          : routine.points[rt.waypointIndex % routine.points.length]

      // Street etiquette: if the next stretch passes through a crosswalk,
      // wait at the curb for the walk signal and a clear road.
      const cars = collectCarViews()
      const decision = decidePedestrian({
        state: rt.pedState,
        position: rt.pos,
        target,
        waitTime: rt.waitTime,
        crosswalks: CROSSWALKS,
        cars,
        pedestrianSignal: getPedestrianSignal(getPhaseAt(trafficRuntime.signal.elapsed).phase),
        signalledCrosswalkIds: SIGNALLED_CROSSWALK_IDS,
      })
      rt.pedState = decision.state
      rt.crosswalkId = decision.crosswalkId
      rt.waitTime = decision.state === 'waiting_to_cross' ? rt.waitTime + dt : 0

      let arrived = false
      if (decision.mayMove) {
        // Cross with a bit of purpose; stroll everywhere else.
        const speed = def.walkSpeed * (rt.pedState === 'crossing' ? 1.25 : 1)
        const res = moveTowards(rt.pos, target, speed * Math.min(dt, 0.1))
        rt.pos = res.position
        rt.walking = !res.arrived
        arrived = res.arrived
        if (!res.arrived) {
          const targetHeading = Math.atan2(res.direction[0], res.direction[1])
          rt.heading = lerpAngle(rt.heading, targetHeading, dt * 8)
        }
      } else {
        rt.walking = false
        // Face the crossing while waiting at the curb.
        const waitHeading = Math.atan2(target[0] - rt.pos[0], target[1] - rt.pos[1])
        rt.heading = lerpAngle(rt.heading, waitHeading, dt * 5)
      }
      if (arrived) {
        if (routine.mode === 'patrol') {
          rt.waypointIndex = (rt.waypointIndex + 1) % routine.points.length
        }
        if (rt.pedState === 'crossing') {
          rt.pedState = 'walking_sidewalk'
          // A rare little wave for whoever waited.
          if (!bubble && Math.random() < 0.3) {
            setBubble('thanks! 👋')
            rt.bubbleUntil = clock.elapsedTime + 2
            rt.nextBubbleAt = clock.elapsedTime + 18 + Math.random() * 22
          }
        }
      }

      // Danger overrides etiquette: a nearby gunshot makes even the named
      // residents flee, layered on top of (and overriding) their routine step.
      // The recovery is automatic — once the panic window expires panicFleeStep
      // is a no-op and the routine walks them back to their anchor, so quest
      // givers (Ravi, Maya, Officer Kim) become reachable again on their own.
      // Named NPCs are never hittable, so a crime can't permanently strand a
      // quest; it only briefly scatters them.
      if (panicFleeStep(rt, def.id, def.walkSpeed, dt, getCrimeGameTime())) {
        rt.pedState = 'walking_sidewalk'
        rt.crosswalkId = null
        rt.waitTime = 0
      }

      // Cosmetic state for debug: reading as "stepping aside" while a
      // rolling car passes close by.
      if (rt.pedState === 'walking_sidewalk' || rt.pedState === 'yielding_to_car') {
        let carClose = false
        for (const car of cars) {
          if (
            car.speed > 0.35 &&
            Math.hypot(car.position.x - rt.pos[0], car.position.z - rt.pos[1]) < YIELD_AWARENESS
          ) {
            carClose = true
            break
          }
        }
        rt.pedState = carClose ? 'yielding_to_car' : rt.walking ? 'walking_sidewalk' : 'idle'
      } else if (rt.pedState === 'idle' && rt.walking) {
        rt.pedState = 'walking_sidewalk'
      }

      // Pedestrians step aside instead of being swallowed by cars: a soft
      // push out of the drivable car's and each ambient car's footprint.
      const maxPush = dt * 6
      const pushed = pushOutOfCircle(
        { x: rt.pos[0], z: rt.pos[1] },
        { x: registry.vehiclePosition.x, z: registry.vehiclePosition.z },
        CAR_CLEARANCE,
        maxPush,
      )
      if (pushed) rt.pos = [pushed.x, pushed.z]
      for (const car of registry.ambientCarPositions.values()) {
        const p = pushOutOfCircle(
          { x: rt.pos[0], z: rt.pos[1] },
          { x: car.x, z: car.z },
          CAR_CLEARANCE,
          maxPush,
        )
        if (p) rt.pos = [p.x, p.z]
      }
      // …and the same courtesy for the on-foot player: patrols route around
      // a standing player instead of walking through them.
      if (useGameStore.getState().mode === 'walking') {
        const p = pushOutOfCircle(
          { x: rt.pos[0], z: rt.pos[1] },
          { x: registry.playerPosition.x, z: registry.playerPosition.z },
          PLAYER_CLEARANCE,
          maxPush,
        )
        if (p) rt.pos = [p.x, p.z]
      }
      // Ambient speech bubbles on a randomized timer — long enough to read,
      // rare enough to stay charming.
      const t = clock.elapsedTime
      if (bubble && t > rt.bubbleUntil) {
        setBubble(null)
      } else if (!bubble && t > rt.nextBubbleAt && def.ambientLines.length > 0) {
        const line = def.ambientLines[Math.floor(Math.random() * def.ambientLines.length)]
        setBubble(line)
        rt.bubbleUntil = t + 4.2
        rt.nextBubbleAt = t + 18 + Math.random() * 22
      }
    }

    // Universal post-movement occupancy for every NAMED NPC — same contract as
    // ambient citizens: person spacing + on-foot player push for all, and the
    // hard vehicle/solid clamps for OFF-path (idle) NPCs. A walking NPC is on its
    // authored route and already steps out of cars (above), so it is treated as
    // on-path and the clamps are skipped to avoid fighting its patrol.
    resolvePersonOccupancy(rt.pos, def.id, dt, rt.walking, rt.walking)

    const bob =
      rt.walking && !store.worldPaused ? Math.abs(Math.sin(clock.elapsedTime * 8)) * 0.06 : 0
    g.position.set(rt.pos[0], bob, rt.pos[1])
    g.rotation.y = rt.heading

    const reg = registry.npcPositions.get(def.id)
    if (reg) reg.set(rt.pos[0], 0, rt.pos[1])
    // Track walking state so person-separation only steers moving-vs-moving.
    if (rt.walking) registry.movingPersonIds.add(def.id)
    else registry.movingPersonIds.delete(def.id)

    // Publish locomotion intent for the character pipeline (visual only —
    // behavior stays authoritative). Reuses one object per NPC.
    let motion = characterRuntime.npcMotion.get(def.id)
    if (!motion) {
      motion = { walking: false, speed: 0, heading: 0 }
      characterRuntime.npcMotion.set(def.id, motion)
    }
    motion.walking = rt.walking && !store.worldPaused
    motion.speed = def.walkSpeed
    motion.heading = rt.heading

    // Publish live pedestrian state (mutation only — no allocations).
    const ped = trafficRuntime.pedestrians.get(def.id)
    if (ped) {
      ped.x = rt.pos[0]
      ped.z = rt.pos[1]
      ped.state = rt.pedState
      ped.waitingAtCrosswalkId = rt.pedState === 'waiting_to_cross' ? rt.crosswalkId : null
      ped.crossingCrosswalkId = rt.pedState === 'crossing' ? rt.crosswalkId : null
      ped.waitTime = rt.waitTime
    }
  })

  return (
    <group ref={group} name={`npc:${def.id}`}>
      {def.characterAssetId ? (
        <NpcCharacter def={def} fallback={<NPCMesh def={def} />} />
      ) : (
        <NPCMesh def={def} />
      )}
      <WorldLabel text={def.name} className="npc-name" offset={2.15} />
      <QuestIndicator def={def} />
      {bubble && <SpeechBubble text={bubble} />}
    </group>
  )
}
