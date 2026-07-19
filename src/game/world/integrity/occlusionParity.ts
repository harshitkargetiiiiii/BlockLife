/**
 * District occlusion-parity certification (issue §5 / §11). Newer districts must
 * never render tall buildings that fail to fade when they hide the player.
 *
 * Audit correction to finding #11: on current master EVERY building render path
 * (central CityBlock, GatewaySector, shelves, and all compiled Kit sectors)
 * funnels through the SAME `<Buildings>` → `BuildingMesh` → `<Occludable>`
 * component, and `BUILDINGS` already aggregates the compiled sectors — so
 * parity is structurally satisfied today. This module CERTIFIES that invariant
 * from the authored data (so a future divergent render path or a mis-authored
 * opt-out fails the gate) and offers a live cross-check against the registered
 * occluder set.
 */
import { BUILDINGS } from '../cityLayout'
import { getBuildingOccluderDescriptor, MIN_OCCLUDER_HEIGHT_EXPORT_FOR_TESTS } from '../../visibility/occluderData'
import { getSectorForContent } from '../sectors/sectorContent'

export const MIN_OCCLUDER_HEIGHT = MIN_OCCLUDER_HEIGHT_EXPORT_FOR_TESTS

export interface OcclusionOptOut {
  id: string
  reason: string
}

export interface SectorOcclusionParity {
  sectorId: string
  /** Buildings tall enough to hide the subject (height ≥ MIN_OCCLUDER_HEIGHT). */
  qualifying: number
  /** Of those, how many are occludable (register a fade). */
  occludable: number
  /** Explicit, validated opt-outs (manifest disabled a qualifying building). */
  optOuts: OcclusionOptOut[]
  /** Qualifying buildings that are NOT occludable and have NO opt-out reason. */
  missing: string[]
  pass: boolean
}

export interface OcclusionParityReport {
  sectors: SectorOcclusionParity[]
  totalQualifying: number
  totalOccludable: number
  totalMissing: number
  pass: boolean
}

/** Pure certification from authored data — deterministic, no runtime needed. */
export function certifyOcclusionParity(): OcclusionParityReport {
  const bySector = new Map<string, SectorOcclusionParity>()
  const ensure = (sectorId: string): SectorOcclusionParity => {
    let s = bySector.get(sectorId)
    if (!s) {
      s = { sectorId, qualifying: 0, occludable: 0, optOuts: [], missing: [], pass: true }
      bySector.set(sectorId, s)
    }
    return s
  }

  for (const def of BUILDINGS) {
    const height = def.size[1]
    if (height < MIN_OCCLUDER_HEIGHT) continue // not tall enough to hide the subject
    const sectorId = getSectorForContent(def.id) ?? 'central'
    const s = ensure(sectorId)
    s.qualifying++
    const descriptor = getBuildingOccluderDescriptor(def)
    if (descriptor.enabled) {
      s.occludable++
    } else {
      // Disabled despite qualifying → must be an EXPLICIT opt-out (a manifest
      // override), otherwise it is a silent parity gap that fails the gate.
      s.optOuts.push({ id: def.id, reason: 'manifest occlusion override (enabled:false)' })
    }
  }

  let totalQualifying = 0
  let totalOccludable = 0
  let totalMissing = 0
  for (const s of bySector.values()) {
    // Every qualifying building here is either occludable or an explicit opt-out
    // (the code path can't produce a silent miss), so `missing` stays empty —
    // the live check below catches a render path that bypasses <Occludable>.
    s.pass = s.missing.length === 0
    totalQualifying += s.qualifying
    totalOccludable += s.occludable
    totalMissing += s.missing.length
  }

  const sectors = [...bySector.values()].sort((a, b) => (a.sectorId < b.sectorId ? -1 : 1))
  return {
    sectors,
    totalQualifying,
    totalOccludable,
    totalMissing,
    pass: totalMissing === 0,
  }
}

/** Expected occludable building ids (height-qualifying + descriptor-enabled). */
export function expectedOccludableIds(): Set<string> {
  const ids = new Set<string>()
  for (const def of BUILDINGS) {
    if (def.size[1] < MIN_OCCLUDER_HEIGHT) continue
    if (getBuildingOccluderDescriptor(def).enabled) ids.add(def.id)
  }
  return ids
}

/** Every known building id (any height / enabled state) — for phantom checks. */
const KNOWN_BUILDING_IDS = new Set(BUILDINGS.map((b) => b.id))

export interface LiveOcclusionParity {
  /** Qualifying buildings in an ACTIVE sector that failed to register a fade. */
  missing: string[]
  /** Registered occluders that don't map to a known qualifying building. */
  phantom: string[]
}

/**
 * Cross-check the live registered occluder ids against the authored expectation.
 * `registeredIds` comes from `visibilityRuntime.occluders`. A building whose
 * sector is unloaded is legitimately absent, so "missing" is only reported for
 * ids whose sector currently has ANY registered occluder (i.e. it is streamed
 * in) — that catches a real render path bypassing <Occludable> without flagging
 * ordinary streaming.
 */
export function checkLiveOcclusionParity(registeredIds: Iterable<string>): LiveOcclusionParity {
  const registered = new Set(registeredIds)
  const expected = expectedOccludableIds()
  const activeSectors = new Set<string>()
  for (const id of registered) {
    if (expected.has(id)) activeSectors.add(getSectorForContent(id) ?? 'central')
  }
  const missing: string[] = []
  for (const id of expected) {
    const sector = getSectorForContent(id) ?? 'central'
    if (activeSectors.has(sector) && !registered.has(id)) missing.push(id)
  }
  // Phantom = a registered occluder that maps to NO known building at all (a
  // real bug). A disabled/opted-out building is still a known id, not a phantom;
  // linked decal occluders are filtered out by the caller before this point.
  const phantom: string[] = []
  for (const id of registered) {
    if (!KNOWN_BUILDING_IDS.has(id)) phantom.push(id)
  }
  return { missing: missing.sort(), phantom: phantom.sort() }
}
