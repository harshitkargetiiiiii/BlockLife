import { useEffect, useState } from 'react'
import { useGameStore } from '../game/store/useGameStore'
import { registry } from '../game/world/runtimeRegistry'
import { getMood } from '../game/simulation/worldMoodSystem'
import { formatClock } from '../game/simulation/timeSystem'
import { CROSSWALKS } from '../game/traffic/trafficData'
import {
  findVehicleOverlaps,
  getCrosswalkStatus,
  trafficRuntime,
} from '../game/traffic/trafficRuntime'
import { getPedestrianSignal, getPhaseAt } from '../game/traffic/signalRules'
import {
  getIntersectionCrossingSignal,
  getIntersectionCrossingZone,
  INTERSECTIONS,
} from '../game/traffic/intersections/intersectionRegistry'
import { getIntersectionPhaseAt } from '../game/traffic/intersections/crossIntersection'
import { getCrimeEventsSnapshot } from '../game/crime/crimeRuntime'
import { getWantedSnapshot } from '../game/crime/wantedRuntime'
import { getPoliceUnitsSnapshot, policeRuntime } from '../game/police/policeRuntime'
import { missionRuntime } from '../game/missions/missionRuntime'
import { MISSION_DEFINITIONS, getMissionDefinition } from '../game/missions/missionDefinitions'
import { tripRuntime } from '../game/citizens/destinations/tripRuntime'
import { getDistrict } from '../game/world/cityLayout'
import { getBlendedModifiers, weatherRuntime } from '../game/weather/weatherSystem'
import { visibilityRuntime } from '../game/visibility/visibilityRuntime'
import { characterRuntime } from '../game/characters/characterRuntime'
import { getRoadGraph } from '../game/traffic/routing/roadGraphBuilder'
import { routeRuntime } from '../game/traffic/routing/routeRuntime'
import { streamingRuntime } from '../game/world/sectors/sectorStreaming'
import { worldToSectorId } from '../game/world/sectors/worldGrid'
import { COMPILED_SECTORS } from '../game/world/authoring/compiledSectors'
import { validateCompiledSectorContent } from '../game/world/authoring/sectorAuthoring'
import { certifyCity } from '../game/world/integrity/districtCertification'

interface DebugInfo {
  position: string
  fps: number
  speed: number
}

// Compiled sector content is immutable after module load, so validation is
// run once per sector and cached for the panel's 500ms re-render tick.
const authoringValidationCache = new Map<string, string[]>()
function getAuthoringValidation(sectorId: string): string[] {
  let errors = authoringValidationCache.get(sectorId)
  if (!errors) {
    const compiled = COMPILED_SECTORS.find((c) => c.sectorId === sectorId)
    errors = compiled ? validateCompiledSectorContent(compiled) : []
    authoringValidationCache.set(sectorId, errors)
  }
  return errors
}

// District certification is derived from immutable authored data — compute once.
let cityCertCache: ReturnType<typeof certifyCity> | null = null
function getCityCert(): ReturnType<typeof certifyCity> {
  if (!cityCertCache) cityCertCache = certifyCity()
  return cityCertCache
}

/** Developer readout, toggled with the Debug button or the ` key. */
export function DebugPanel() {
  const debugOpen = useGameStore((s) => s.debugOpen)
  const toggleDebug = useGameStore((s) => s.toggleDebug)
  const stats = useGameStore((s) => s.stats)
  const mode = useGameStore((s) => s.mode)
  const activeInteractableId = useGameStore((s) => s.activeInteractableId)
  const questStates = useGameStore((s) => s.questStates)
  const worldPaused = useGameStore((s) => s.worldPaused)
  const location = useGameStore((s) => s.location)
  const appearance = useGameStore((s) => s.appearance)
  const [info, setInfo] = useState<DebugInfo>({ position: '—', fps: 0, speed: 0 })

  useEffect(() => {
    if (!debugOpen) return
    let lastFrames = registry.frameCount
    const interval = setInterval(() => {
      const p = mode === 'driving' ? registry.vehiclePosition : registry.playerPosition
      const frames = registry.frameCount
      setInfo({
        position: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
        fps: Math.round((frames - lastFrames) / 0.5),
        speed: registry.flags.drivingSpeed,
      })
      lastFrames = frames
    }, 500)
    return () => clearInterval(interval)
  }, [debugOpen, mode])

  const p = mode === 'driving' ? registry.vehiclePosition : registry.playerPosition
  const rows: [string, string][] = [
    ['pos', info.position],
    ['location', location],
    ['district', location === 'apartment' ? '(indoors)' : getDistrict(p.x, p.z)],
    ['outfit', `${appearance.shirtColor} · ${appearance.pantsColor}`],
    ['mode', worldPaused ? `${mode} (paused)` : mode],
    ...(mode === 'driving'
      ? ([['speed', `${info.speed.toFixed(1)} u/s`]] as [string, string][])
      : []),
    ['active', activeInteractableId ?? '—'],
    ['quest', questStates['coffee_for_ravi'] ?? '—'],
    ['clock', `d${stats.day} ${formatClock(stats.hour)} · ${getMood(stats.hour)}`],
    [
      'weather',
      weatherRuntime.transition < 1
        ? `${weatherRuntime.kind}→${weatherRuntime.targetKind} ${(weatherRuntime.transition * 100).toFixed(0)}%`
        : weatherRuntime.kind,
    ],
    [
      'wet/rain',
      `${weatherRuntime.wetness.toFixed(2)} · ${getBlendedModifiers(weatherRuntime).rainStrength.toFixed(2)}`,
    ],
    ['fps', `~${info.fps}`],
  ]

  // Live traffic snapshot (read straight from the runtime; refreshed by the
  // same 500ms interval tick that re-renders this panel).
  const phaseNow = getPhaseAt(trafficRuntime.signal.elapsed)
  const overlaps = findVehicleOverlaps()
  const trafficRows: [string, string][] = [
    [
      'signal',
      `${phaseNow.phase} (${phaseNow.remaining.toFixed(0)}s) · ped ${getPedestrianSignal(phaseNow.phase)}`,
    ],
    ...(overlaps.length > 0
      ? ([['⚠ overlap', overlaps.map((p) => p.join('×')).join(', ')]] as [string, string][])
      : []),
    ...[...trafficRuntime.cars.values()].map(
      (c) =>
        [
          c.id.replace('vehicle_ambient_', ''),
          `${c.state} ${c.speed.toFixed(1)}→${c.targetSpeed.toFixed(1)}${
            c.blockedTime > 0.5 ? ` ⏱${c.blockedTime.toFixed(1)}s` : ''
          }`,
        ] as [string, string],
    ),
    ...[...trafficRuntime.pedestrians.values()]
      .filter((p) => p.state !== 'idle' && p.state !== 'walking_sidewalk')
      .map((p) => [p.id.replace('npc_', '').replace('_01', ''), p.state] as [string, string]),
    ...CROSSWALKS.map((zone) => {
      const s = getCrosswalkStatus(zone)
      return [
        zone.id.replace('crosswalk_', 'cw '),
        s.occupied ? 'occupied' : s.hasWaitingPedestrian ? 'ped waiting' : 'clear',
      ] as [string, string]
    }),
    // Destination-driven citizen trips (opt-in via setCitizenDestinationDebug).
    ...(tripRuntime.debugEnabled
      ? [...tripRuntime.trips.values()].map(
          (trip) =>
            [
              trip.citizenId.replace('cit_', ''),
              `${trip.phase}${trip.destinationId ? ` → ${trip.destinationId.replace('pdest_', '')}` : ''} · wp ${trip.waypointIndex}/${trip.plan?.waypoints.length ?? 0} · trips ${trip.tripsCompleted}${trip.recoveryStage > 0 ? ` · rec ${trip.recoveryStage}` : ''}`,
            ] as [string, string],
        )
      : []),
    // Signalized-intersection crossings: queues, occupancy and walk state
    // (opt-in via setPedestrianCrossingDebug — four rows per intersection).
    ...(trafficRuntime.pedestrianCrossingDebug
      ? INTERSECTIONS.flatMap((x) => {
          const phase = getIntersectionPhaseAt(x, trafficRuntime.signal.elapsed)
          return x.crossings.map((c) => {
            const zone = getIntersectionCrossingZone(c.id)!
            const s = getCrosswalkStatus(zone)
            let queued = 0
            for (const p of trafficRuntime.pedestrians.values()) {
              if (p.waitingAtCrosswalkId === c.id) queued += 1
            }
            return [
              c.id.replace(`${x.id}_cross_`, 'ix '),
              `${getIntersectionCrossingSignal(c.id, trafficRuntime.signal.elapsed)} ${phase.remaining.toFixed(0)}s · q${queued}${s.occupied ? ' · occupied' : ''}`,
            ] as [string, string]
          })
        })
      : []),
  ]

  return (
    <div className="debug-wrap">
      <button className="btn btn-small btn-ghost" data-testid="debug-toggle" onClick={toggleDebug}>
        🐞 Debug
      </button>
      {debugOpen && (
        <div className="debug-panel panel" data-testid="debug-panel">
          {rows.map(([label, value]) => (
            <div className="debug-row" key={label}>
              <span className="debug-label">{label}</span>
              <span className="debug-value">{value}</span>
            </div>
          ))}
          <div className="debug-section" data-testid="debug-character">
            character
          </div>
          {(() => {
            const c = characterRuntime.instances.get('player')
            const rows: [string, string][] = c
              ? [
                  ['visual', `${c.activeVisual} (${c.renderMode})${c.fallbackReason ? ` — ${c.fallbackReason}` : ''}`],
                  ['anim', `${c.animState} ← ${c.previousAnimState} · rate ${c.playbackRate.toFixed(2)}`],
                  ['motion', `${c.speed.toFixed(1)} u/s · facing ${((c.facingAngle * 180) / Math.PI).toFixed(0)}°`],
                  ['slots', c.resolvedSlots.join(', ') || '—'],
                  ['instances', `${characterRuntime.instances.size} · actions ${c.activeActionCount}`],
                ]
              : [['visual', 'not registered']]
            return rows.map(([label, value]) => (
              <div className="debug-row" key={`char-${label}`}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
          <div className="debug-section" data-testid="debug-visibility">
            visibility
          </div>
          {(() => {
            const v = visibilityRuntime.debug
            const rows: [string, string][] = [
              ['subject', v.subjectId ? `${v.subjectId} (${v.subjectKind})` : '— (indoors/off)'],
              ['occluders', `${v.registeredCount} reg · ${v.candidateCount} candidates`],
              [
                'faded',
                v.fadedIds.length === 0
                  ? 'none'
                  : v.fadedIds
                      .map((id) => {
                        const occ = visibilityRuntime.occluders.get(id)
                        return `${id.replace('building_', '')} ${occ ? occ.state.currentOpacity.toFixed(2) : ''}`
                      })
                      .join(', '),
              ],
            ]
            return rows.map(([label, value]) => (
              <div className="debug-row" key={label}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
          <div className="debug-section" data-testid="debug-traffic">
            traffic
          </div>
          {trafficRows.map(([label, value]) => (
            <div className="debug-row" key={label}>
              <span className="debug-label">{label}</span>
              <span className="debug-value">{value}</span>
            </div>
          ))}
          <div className="debug-section" data-testid="debug-crime">
            crime / police
          </div>
          {(() => {
            const w = getWantedSnapshot()
            const rows: [string, string][] = [
              ['wanted', `L${w.level} · ${w.status} · heat ${w.heat.toFixed(1)}`],
              ['incidents', `${w.activeIncidentIds.length}`],
            ]
            const police = getPoliceUnitsSnapshot()
            if (police.length > 0 || policeRuntime.arrestsMade > 0) {
              rows.push(['police', `${police.length} units · ${policeRuntime.arrestsMade} arrests`])
              for (const u of police.slice(0, 3)) {
                rows.push([u.id.replace('police_', 'unit '), `${u.state}${u.seesSuspect ? ' · sees' : ''}`])
              }
            }
            const open = getCrimeEventsSnapshot().filter(
              (e) => e.status === 'unseen' || e.status === 'witnessed' || e.status === 'reported',
            )
            for (const e of open.slice(-4)) {
              rows.push([e.type.replace(/_/g, ' '), `${e.status} · w${e.witnessedBy.length}`])
            }
            return rows.map(([label, value]) => (
              <div className="debug-row" key={`crime-${label}`}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
          <div className="debug-section" data-testid="debug-missions">
            missions
          </div>
          {(() => {
            const a = missionRuntime.active
            const def = a ? getMissionDefinition(a.missionId) : undefined
            const obj = def?.objectives[a?.objectiveIndex ?? 0]
            const rows: [string, string][] = []
            if (a && def) {
              rows.push(['active', `${def.id} · ${a.attemptId}`])
              rows.push([
                'objective',
                `${(a.objectiveIndex + 1)}/${def.objectives.length} · ${obj?.id ?? '—'} (${obj?.kind ?? '—'})`,
              ])
              const vars = Object.entries(a.variables)
              if (vars.length) rows.push(['vars', vars.map(([k, v]) => `${k}=${v}`).join(' ')])
              if (a.ownedEntityIds.size) rows.push(['owned', [...a.ownedEntityIds].join(' ')])
            } else {
              rows.push(['active', 'none'])
            }
            const res = missionRuntime.result
            if (res) rows.push(['last result', `${res.missionId} · ${res.outcome}${res.reason ? ` (${res.reason})` : ''}`])
            for (const def2 of MISSION_DEFINITIONS) {
              const h = missionRuntime.history[def2.id]
              const cd = missionRuntime.cooldowns[def2.id]
              const bits: string[] = []
              if (h) bits.push(`${h.completions}× · $${h.totalEarned}`)
              if (cd) bits.push(`ready@${cd.readyAtGameHours}h`)
              if (missionRuntime.discovered.has(def2.id)) bits.push('found')
              if (bits.length) rows.push([def2.id, bits.join(' · ')])
            }
            if (missionRuntime.lastEventType) rows.push(['last event', missionRuntime.lastEventType])
            return rows.map(([label, value]) => (
              <div className="debug-row" key={`mission-${label}`}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
          <div className="debug-section" data-testid="debug-streaming">
            world streaming
          </div>
          {(() => {
            const states = [...streamingRuntime.states.values()]
            const count = (lifecycle: string) =>
              states.filter((s) => s.lifecycle === lifecycle).length
            const rows: [string, string][] = [
              [
                'sectors',
                `${states.length} total · ${count('active')} active · ${count('warm')} warm · ${count('cooling')} cooling · ${count('unloaded')} unloaded`,
              ],
              [
                'player @',
                worldToSectorId(registry.playerPosition.x, registry.playerPosition.z),
              ],
              [
                'queue',
                `${streamingRuntime.queue.length} pending · ${streamingRuntime.metrics.transitions} transitions · ${streamingRuntime.metrics.loads}↑ ${streamingRuntime.metrics.unloads}↓`,
              ],
              ...states
                .filter((s) => s.lifecycle !== 'unloaded')
                .map(
                  (s) =>
                    [
                      s.id,
                      `${s.lifecycle} · ${s.simulationTier}${s.loadDurationMs !== null ? ` · ${s.loadDurationMs.toFixed(0)}ms load` : ''}${s.error ? ` · ⚠ ${s.error}` : ''}`,
                    ] as [string, string],
                ),
            ]
            return rows.map(([label, value]) => (
              <div className="debug-row" key={`sector-${label}`}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
          <div className="debug-section" data-testid="debug-authoring">
            authoring kit
          </div>
          {(() => {
            const rows: [string, string][] = COMPILED_SECTORS.map((c) => {
              const errors = getAuthoringValidation(c.sectorId)
              return [
                c.sectorId,
                `${c.buildings.length} bld · ${c.props.length} props · ${c.citizens.length} ctz · ${c.segmentSpecs.length} seg · ${c.destinations.length} dest · ${
                  errors.length === 0 ? 'valid ✓' : `⚠ ${errors.length} errors`
                }`,
              ] as [string, string]
            })
            if (rows.length === 0) rows.push(['sectors', 'none compiled'])
            return rows.map(([label, value]) => (
              <div className="debug-row" key={`authoring-${label}`}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
          <div className="debug-section" data-testid="debug-certification">
            certification
          </div>
          {(() => {
            const cert = getCityCert()
            const rows: [string, string][] = [
              ['city', `${cert.verdict === 'pass' ? '✓ CERTIFIED' : '✗ FAIL'} · ${cert.passed}/${cert.totalDistricts}`],
              ...cert.districts.map(
                (d) =>
                  [
                    d.sectorId,
                    `${d.verdict === 'pass' ? '✓' : `✗ ${d.errors} err`}${d.warnings ? ` · ${d.warnings} warn` : ''}`,
                  ] as [string, string],
              ),
            ]
            return rows.map(([label, value]) => (
              <div className="debug-row" key={`cert-${label}`}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
          <div className="debug-section" data-testid="debug-routing">
            routing
          </div>
          {(() => {
            const graph = getRoadGraph()
            const states = [...routeRuntime.states.values()]
            const recovering = states.filter((s) => s.recoveryStage > 0).length
            const rows: [string, string][] = [
              [
                'graph',
                `${graph.segments.size} seg · ${graph.edges.length} edges · ${graph.destinations.size} dest`,
              ],
              [
                'fleet',
                `${states.length} routed · ${trafficRuntime.cars.size - states.length} loop · ${recovering} recovering`,
              ],
              ['congestion', routeRuntime.congestion.size === 0 ? 'clear' : `${routeRuntime.congestion.size} segs`],
              ...states.map(
                (s) =>
                  [
                    s.vehicleId.replace('vehicle_ambient_', ''),
                    `${s.mode === 'throughTraffic' ? 'thru' : 'cross'} → ${
                      s.destinationId?.replace('dest_', '').replace('exit_', '⇥') ?? '—'
                    } · ${s.segmentIndex + 1}/${s.route?.segmentIds.length ?? 0}${
                      s.blockageReason !== 'none' ? ` · ${s.blockageReason}` : ''
                    }${s.recoveryStage > 0 ? ` · R${s.recoveryStage}` : ''} · trips ${s.tripsCompleted}`,
                  ] as [string, string],
              ),
            ]
            return rows.map(([label, value]) => (
              <div className="debug-row" key={`route-${label}`}>
                <span className="debug-label">{label}</span>
                <span className="debug-value">{value}</span>
              </div>
            ))
          })()}
        </div>
      )}
    </div>
  )
}
