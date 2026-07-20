/**
 * Integrity runtime (module singleton) — drives the observe-only anomaly scan.
 * Each scan mirrors the live world into the registry (via adapters) and ingests
 * fresh overlap detections into the tracker. Throttled to ~4 Hz, spatially
 * indexed, bounded — never an all-pairs per-frame pass, never a Zustand write.
 */
import {
  AnomalyTracker,
  scanOccupancyAnomalies,
  scanStreamingAnomalies,
  scanTrafficAnomalies,
} from './anomalyDetector'
import { collectAllEntities } from './entityAdapters'
import { getRegistryStats, resetEntityRegistry, syncDynamicEntities } from './entityRegistry'
import { resetLiveObstacles } from './liveObstacles'
import { trafficRuntime } from '../../traffic/trafficRuntime'
import { consumeStreamingSafetySnapshot, resetSafetyRingRuntime } from '../sectors/sectorSafetyRing'
import { getCityPlacementFailures, scanPlacementAnomalies } from './placementIntegrity'
import type { AnomalyRecord } from './anomalyTypes'

/** ~4 Hz scan cadence (issue §10 suggests 4 Hz or lower where safe). */
export const SCAN_INTERVAL_SECONDS = 0.25

export const integrityRuntime = {
  tracker: new AnomalyTracker(),
  enabled: true,
  accumulator: 0,
  totalScans: 0,
  lastScanEntityCount: 0,
  /** Worst entity count seen (perf reporting). */
  peakEntityCount: 0,
}

/**
 * Run one scan immediately (used by the frame tick and by tests). Rebuilds the
 * registry snapshot from the adapters, then ingests overlap detections.
 */
export function runIntegrityScan(): void {
  const entities = collectAllEntities()
  syncDynamicEntities(entities)
  // ONE ingest per scan (ingest advances the tick counter): occupancy overlaps +
  // traffic stall/honk-loop diagnostics + streaming safety-ring coverage/self-heal.
  const raw = scanOccupancyAnomalies(entities)
  for (const t of scanTrafficAnomalies(trafficRuntime.cars.values())) raw.push(t)
  for (const s of scanStreamingAnomalies(consumeStreamingSafetySnapshot())) raw.push(s)
  // Static 3D-placement defects (float/clip/anchor) — memoized, so a clean city
  // adds nothing; a future authored defect surfaces here as a sustained anomaly.
  for (const p of scanPlacementAnomalies(getCityPlacementFailures())) raw.push(p)
  integrityRuntime.tracker.ingest(raw)
  integrityRuntime.totalScans++
  integrityRuntime.lastScanEntityCount = entities.length
  if (entities.length > integrityRuntime.peakEntityCount) {
    integrityRuntime.peakEntityCount = entities.length
  }
}

/** Frame hook — accumulates real clamped delta and scans at the throttle. */
export function tickIntegrity(dt: number): void {
  if (!integrityRuntime.enabled) return
  integrityRuntime.accumulator += dt
  if (integrityRuntime.accumulator < SCAN_INTERVAL_SECONDS) return
  integrityRuntime.accumulator = 0
  runIntegrityScan()
}

export interface IntegritySnapshot {
  totalScans: number
  entityCount: number
  peakEntityCount: number
  activeAnomalies: number
  sustainedAnomalies: number
  registry: ReturnType<typeof getRegistryStats>
}

export function getIntegritySnapshot(): IntegritySnapshot {
  return {
    totalScans: integrityRuntime.totalScans,
    entityCount: integrityRuntime.lastScanEntityCount,
    peakEntityCount: integrityRuntime.peakEntityCount,
    activeAnomalies: integrityRuntime.tracker.getActive().length,
    sustainedAnomalies: integrityRuntime.tracker.getSustained().length,
    registry: getRegistryStats(),
  }
}

export function getActiveAnomalies(): AnomalyRecord[] {
  return integrityRuntime.tracker.getActive()
}

export function resetIntegrityRuntime(): void {
  integrityRuntime.tracker.clear()
  integrityRuntime.accumulator = 0
  integrityRuntime.totalScans = 0
  integrityRuntime.lastScanEntityCount = 0
  integrityRuntime.peakEntityCount = 0
  resetEntityRegistry()
  resetLiveObstacles()
  resetSafetyRingRuntime()
}
