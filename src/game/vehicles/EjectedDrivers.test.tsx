import { beforeEach, describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { registry } from '../world/runtimeRegistry'
import { useGameStore } from '../store/useGameStore'
import { EjectedDrivers } from './EjectedDrivers'
import {
  DRIVER_FLEE_SPEED,
  ejectDriver,
  getEjectedDrivers,
  resetEjectedDrivers,
} from './ejectedDriverRuntime'

/**
 * Issue #34, Track A. The defect was at the COMPONENT boundary, not in the runtime: the `useFrame`
 * callback ignored its delta and called `stepEjectedDrivers(1 / 60, …)`, so flee distance tracked
 * frame COUNT rather than elapsed time. Every existing test calls `stepEjectedDrivers` directly and
 * supplies the delta itself, so none of them could see it — CI proved the runtime received 0.01667
 * in every update of every run while those tests stayed green.
 *
 * These drive the real component through the real `useFrame` and assert on what reached the runtime.
 */

// Open ground far from any building, so `avoidSolids` is a no-op and the step is measurable.
const CAR: [number, number] = [1000, 1000]
const EXIT: [number, number] = [1002, 1000]

function spawn(): void {
  ejectDriver({ id: 'd_boundary', vehicleId: 'v1', exit: EXIT, fleeFrom: CAR, color: '#fff', gameTime: 100 })
}
const driverX = (): number => getEjectedDrivers()[0].pos[0]

beforeEach(() => {
  resetEjectedDrivers()
  registry.npcPositions.clear()
  registry.movingPersonIds.clear()
  useGameStore.setState({ worldPaused: false })
})

describe('EjectedDrivers passes the real frame delta to the runtime', () => {
  it('a longer frame advances the driver further than a shorter one', async () => {
    spawn()
    const start = driverX()
    const renderer = await ReactThreeTestRenderer.create(<EjectedDrivers />)
    await renderer.advanceFrames(1, 0.01)
    const afterShort = driverX() - start
    await renderer.unmount()

    resetEjectedDrivers()
    registry.npcPositions.clear()
    registry.movingPersonIds.clear()
    spawn()
    const start2 = driverX()
    const renderer2 = await ReactThreeTestRenderer.create(<EjectedDrivers />)
    await renderer2.advanceFrames(1, 0.04)
    const afterLong = driverX() - start2
    await renderer2.unmount()

    // Both are under the runtime's 0.05 clamp, so the distances must differ in proportion to the
    // supplied deltas. Under the old hardcoded 1/60 they were identical whatever was supplied.
    expect(afterShort).toBeGreaterThan(0)
    expect(afterLong).toBeGreaterThan(afterShort * 2)
    expect(afterShort).toBeCloseTo(DRIVER_FLEE_SPEED * 0.01, 6)
    expect(afterLong).toBeCloseTo(DRIVER_FLEE_SPEED * 0.04, 6)
  })

  it('the exact regression: one 1 s frame beats sixty 1/60 s frames of the same wall clock', async () => {
    // The shape of crime.spec.ts:201 on a slow runner. One slow frame covering a second of wall
    // clock must not advance less than the clamp allows just because it was a single frame.
    spawn()
    const start = driverX()
    const renderer = await ReactThreeTestRenderer.create(<EjectedDrivers />)
    await renderer.advanceFrames(1, 1)
    const moved = driverX() - start
    await renderer.unmount()
    // Clamped to 0.05 s by the runtime, which is still THREE TIMES the old hardcoded 1/60 step.
    expect(moved).toBeCloseTo(DRIVER_FLEE_SPEED * 0.05, 6)
    expect(moved).toBeGreaterThan(DRIVER_FLEE_SPEED * (1 / 60))
  })

  it('the runtime clamp is still in force at the boundary', async () => {
    spawn()
    const start = driverX()
    const renderer = await ReactThreeTestRenderer.create(<EjectedDrivers />)
    await renderer.advanceFrames(1, 5)
    const moved = driverX() - start
    await renderer.unmount()
    // A 5 s frame may not teleport the driver 17 m; the clamp caps one step at 0.05 s of flee.
    expect(moved).toBeCloseTo(DRIVER_FLEE_SPEED * 0.05, 6)
    expect(moved).toBeLessThan(DRIVER_FLEE_SPEED * 0.06)
  })

  it('a paused frame does not advance the driver, whatever the delta', async () => {
    spawn()
    useGameStore.setState({ worldPaused: true })
    const start = driverX()
    const renderer = await ReactThreeTestRenderer.create(<EjectedDrivers />)
    await renderer.advanceFrames(3, 0.04)
    expect(driverX(), 'pause still freezes the flee').toBe(start)
    // ...and unpausing resumes it through the same path.
    useGameStore.setState({ worldPaused: false })
    await renderer.advanceFrames(1, 0.02)
    expect(driverX() - start).toBeCloseTo(DRIVER_FLEE_SPEED * 0.02, 6)
    await renderer.unmount()
  })
})
