import { beforeEach, describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { render, screen } from '@testing-library/react'
import { AmbientCars } from '../../world/AmbientCars'
import { trafficRuntime } from '../trafficRuntime'
import { routeRuntime } from '../routing/routeRuntime'
import { AMBIENT_CARS } from '../../world/cityLayout'
import { useGameStore, createInitialGameState } from '../../store/useGameStore'
import { DebugPanel } from '../../../app/DebugPanel'

beforeEach(() => {
  useGameStore.setState(createInitialGameState())
  routeRuntime.states.clear()
  routeRuntime.blockedSegmentIds.clear()
  routeRuntime.forcedDestinations.clear()
})

const ROUTED = AMBIENT_CARS.filter((d) => d.routeMode)

describe('RoutedCar integration (R3F)', () => {
  it('routed cars register runtime + route state and start driving', async () => {
    const renderer = await ReactThreeTestRenderer.create(<AmbientCars />)
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(10, 1 / 60)
    })
    expect(routeRuntime.states.size).toBe(ROUTED.length)
    for (const def of ROUTED) {
      const state = routeRuntime.states.get(def.id)
      expect(state, def.id).toBeDefined()
      expect(state!.route).not.toBeNull()
      expect(state!.destinationId).not.toBeNull()
      expect(state!.mode).toBe(def.routeMode)
      const agent = trafficRuntime.cars.get(def.id)
      expect(agent).toBeDefined()
      // Open road at spawn: accelerating toward the segment limit.
      expect(agent!.targetSpeed).toBeGreaterThan(0)
    }
    await renderer.unmount()
    // Runtime registries clean up completely (no leaks across mounts).
    expect(routeRuntime.states.size).toBe(0)
    expect(trafficRuntime.cars.size).toBe(0)
  })

  it('a routed car makes real progress along its planned polyline', async () => {
    const renderer = await ReactThreeTestRenderer.create(<AmbientCars />)
    const def = ROUTED[0]
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(240, 1 / 60) // 4 simulated seconds
    })
    const agent = trafficRuntime.cars.get(def.id)!
    const state = routeRuntime.states.get(def.id)!
    expect(agent.speed).toBeGreaterThan(0.5)
    expect(state.segmentProgress + state.segmentIndex).toBeGreaterThan(0)
    await renderer.unmount()
  })

  it('pausing snaps routed cars deterministically to their seeded spawn', async () => {
    const renderer = await ReactThreeTestRenderer.create(<AmbientCars />)
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(120, 1 / 60)
    })
    useGameStore.setState({ worldPaused: true })
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
    const first = ROUTED.map((d) => {
      const s = routeRuntime.states.get(d.id)!
      return [s.route!.segmentIds.join(','), s.destinationId]
    })
    useGameStore.setState({ worldPaused: false })
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(60, 1 / 60)
    })
    useGameStore.setState({ worldPaused: true })
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
    const second = ROUTED.map((d) => {
      const s = routeRuntime.states.get(d.id)!
      return [s.route!.segmentIds.join(','), s.destinationId]
    })
    expect(second).toEqual(first)
    await renderer.unmount()
  })
})

describe('DebugPanel routing section', () => {
  it('lists graph counts and per-vehicle route state when open', () => {
    useGameStore.setState({ debugOpen: true })
    render(<DebugPanel />)
    expect(screen.getByTestId('debug-routing')).toBeInTheDocument()
    expect(screen.getByTestId('debug-panel')).toHaveTextContent('seg ·')
    expect(screen.getByTestId('debug-panel')).toHaveTextContent('routed')
  })
})
