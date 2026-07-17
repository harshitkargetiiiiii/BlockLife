import { beforeEach, describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { render, screen } from '@testing-library/react'
import { AmbientCars } from '../../world/AmbientCars'
import { trafficRuntime } from '../trafficRuntime'
import { AMBIENT_CARS } from '../../world/cityLayout'
import { useGameStore, createInitialGameState } from '../../store/useGameStore'
import { DebugPanel } from '../../../app/DebugPanel'

beforeEach(() => {
  useGameStore.setState(createInitialGameState())
})

describe('AmbientCars traffic integration (R3F)', () => {
  it('registers live agents that drive through the rules each frame', async () => {
    const renderer = await ReactThreeTestRenderer.create(<AmbientCars />)
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(5, 1 / 60)
    })
    expect(trafficRuntime.cars.size).toBe(AMBIENT_CARS.length)
    for (const def of AMBIENT_CARS) {
      const agent = trafficRuntime.cars.get(def.id)
      expect(agent, `agent for ${def.id}`).toBeDefined()
      expect(agent!.laneId).toBe(def.laneId)
      expect([
        'cruising',
        'slowing',
        'yielding',
        'stopped',
        'resuming',
        'blocked',
      ]).toContain(agent!.state)
      // Accelerating from standstill toward the limit on an open road.
      expect(agent!.targetSpeed).toBeGreaterThan(0)
    }
    await renderer.unmount()
    expect(trafficRuntime.cars.size).toBe(0)
  })
})

describe('DebugPanel traffic section', () => {
  it('shows traffic state only while debug is open', () => {
    trafficRuntime.cars.set('vehicle_ambient_car_01', {
      id: 'vehicle_ambient_car_01',
      laneId: 'lane_inner_cw',
      x: 0,
      z: -24.6,
      heading: 0,
      speed: 1.2,
      targetSpeed: 0,
      state: 'yielding',
      reason: 'crosswalk',
      blockedTime: 0,
      lastHonkAt: -Infinity,
    })
    trafficRuntime.pedestrians.set('npc_leo_01', {
      id: 'npc_leo_01',
      x: 0,
      z: -22.2,
      state: 'waiting_to_cross',
      waitingAtCrosswalkId: 'crosswalk_north',
      crossingCrosswalkId: null,
      waitTime: 1,
    })

    const { rerender } = render(<DebugPanel />)
    expect(screen.queryByTestId('debug-traffic')).not.toBeInTheDocument()

    useGameStore.setState({ debugOpen: true })
    rerender(<DebugPanel />)
    expect(screen.getByTestId('debug-traffic')).toBeInTheDocument()
    expect(screen.getByTestId('debug-panel')).toHaveTextContent('yielding')
    expect(screen.getByTestId('debug-panel')).toHaveTextContent('waiting_to_cross')
    expect(screen.getByTestId('debug-panel')).toHaveTextContent('ped waiting')

    trafficRuntime.cars.clear()
    trafficRuntime.pedestrians.clear()
  })
})
