import { describe, expect, it } from 'vitest'
import { getRoadGraph } from './roadGraphBuilder'
import { planRoute } from './routePlanner'

/**
 * Planner cost stays bounded as the city grows: all-destination sweeps
 * over the 132-segment expansion graph must stay comfortably real-time.
 * (Absolute numbers are generous CI-safe ceilings, not benchmarks.)
 */
describe('route planner performance envelope', () => {
  it('plans to every destination from a central segment well under budget', () => {
    const graph = getRoadGraph()
    const destinations = [...graph.destinations.keys()]
    const t0 = performance.now()
    let planned = 0
    for (const dest of destinations) {
      const route = planRoute(graph, 'ring_in_n_a', 0.3, dest)
      if (route.ok) planned += 1
    }
    const elapsed = performance.now() - t0
    expect(planned).toBe(destinations.length)
    // 26 plans; generous ceiling ≈ 2ms per plan on CI hardware.
    expect(elapsed).toBeLessThan(60)
  })
})
