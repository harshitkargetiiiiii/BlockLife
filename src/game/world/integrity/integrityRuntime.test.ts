import { beforeEach, describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { registry } from '../runtimeRegistry'
import {
  getActiveAnomalies,
  getIntegritySnapshot,
  resetIntegrityRuntime,
  runIntegrityScan,
} from './integrityRuntime'

describe('integrityRuntime (live mirror + scan)', () => {
  beforeEach(() => {
    resetIntegrityRuntime()
    registry.npcPositions.clear()
    registry.movingPersonIds.clear()
    registry.ambientCarPositions.clear()
    registry.playerPosition.set(1000, 0, 1000) // park the player far from the fixtures
  })

  it('mirrors people from the runtime and detects a person-person overlap', () => {
    registry.npcPositions.set('c1', new Vector3(0, 0, 0))
    registry.npcPositions.set('c2', new Vector3(0.4, 0, 0))
    runIntegrityScan()
    expect(getActiveAnomalies().some((a) => a.type === 'person_person_overlap')).toBe(true)
    const snap = getIntegritySnapshot()
    expect(snap.totalScans).toBe(1)
    expect(snap.entityCount).toBeGreaterThanOrEqual(3) // player + 2 citizens
  })

  it('reports a spaced-out scene as anomaly-free', () => {
    registry.npcPositions.set('c1', new Vector3(0, 0, 0))
    registry.npcPositions.set('c2', new Vector3(20, 0, 0))
    runIntegrityScan()
    expect(getActiveAnomalies()).toHaveLength(0)
  })

  it('resets scans, anomalies and mirrored entities', () => {
    registry.npcPositions.set('c1', new Vector3(0, 0, 0))
    registry.npcPositions.set('c2', new Vector3(0.4, 0, 0))
    runIntegrityScan()
    expect(getActiveAnomalies().length).toBeGreaterThan(0)
    resetIntegrityRuntime()
    expect(getActiveAnomalies()).toHaveLength(0)
    expect(getIntegritySnapshot().totalScans).toBe(0)
    expect(getIntegritySnapshot().registry.total).toBe(0)
  })
})
