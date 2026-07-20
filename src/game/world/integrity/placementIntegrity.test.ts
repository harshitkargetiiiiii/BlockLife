import { describe, expect, it } from 'vitest'
import type { PlacementFailure } from './placementValidation'
import { getCityPlacementFailures, scanPlacementAnomalies } from './placementIntegrity'

describe('scanPlacementAnomalies (failure → runtime anomaly mapping)', () => {
  const fail = (kind: PlacementFailure['kind'], entityId: string, otherId?: string): PlacementFailure => ({
    kind,
    entityId,
    otherId,
    reason: 'x',
    correction: 0.4,
  })

  it('maps the three named placement failures to their anomaly types', () => {
    const raw = scanPlacementAnomalies([
      fail('prop_floating', 'prop_a'),
      fail('prop_clipping', 'prop_b', 'bld_1'),
      fail('anchor_invalid', 'cit_c', 'wall_2'),
    ])
    expect(raw.map((r) => r.type)).toEqual(['prop_floating', 'prop_clipping', 'anchor_invalid'])
    expect(raw[1].entityIds).toEqual(['prop_b', 'bld_1'])
    expect(raw[2].depth).toBe(0.4)
  })

  it('does not emit runtime anomalies for report-only kinds', () => {
    expect(scanPlacementAnomalies([fail('duplicate_citizen', 'a', 'b'), fail('route_corridor', 'r', 's')])).toEqual([])
  })
})

describe('city placement is clean at runtime', () => {
  it('the whole authored city produces zero placement failures', () => {
    const failures = getCityPlacementFailures()
    const detail = failures.map((f) => `${f.kind} ${f.entityId}: ${f.reason}`).join('\n')
    expect(failures, `\n${detail}`).toEqual([])
  })
})
