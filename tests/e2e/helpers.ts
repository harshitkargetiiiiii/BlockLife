import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Shape of window.GAME_TEST_API.getStats() (kept in sync with gameTestApi.ts). */
export interface TestStats {
  money: number
  hunger: number
  energy: number
  reputation: number
  strength: number
  day: number
  hour: number
  mood: string
  mode: string
  position: [number, number, number]
  activeInteractableId: string | null
  questStates: Record<string, string>
  inventory: Record<string, number>
  uiPanel: string
  worldPaused: boolean
}

export async function gotoGame(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.GAME_TEST_API?.ready() === true, undefined, {
    timeout: 45_000,
  })
  await expect(page.getByTestId('loading-overlay')).toBeHidden({ timeout: 10_000 })
}

export async function getStats(page: Page): Promise<TestStats> {
  return page.evaluate(() => window.GAME_TEST_API!.getStats() as unknown as TestStats)
}

export async function teleport(page: Page, position: [number, number, number]): Promise<void> {
  await page.evaluate((pos) => window.GAME_TEST_API!.teleportPlayer(pos), position)
  // Give the proximity scanner + camera a moment to catch up.
  await page.waitForTimeout(450)
}

export async function waitForActiveInteractable(page: Page, id: string): Promise<void> {
  await page.waitForFunction(
    (expected) => window.GAME_TEST_API!.getStats().activeInteractableId === expected,
    id,
    { timeout: 10_000 },
  )
}

export async function pressE(page: Page): Promise<void> {
  await page.keyboard.press('e')
  await page.waitForTimeout(150)
}

/**
 * Make the one drivable shell present for on-foot tests. Since issue #19 §3, a fresh game has NO
 * free car: the physical shell stays hidden until an OWNED vehicle is active (or one is stolen).
 * This arrange grants an owned, active Compact — which projects the exact legacy Compact at
 * CAR_SPAWN — so the classic "walk to the car, press E, drive, exit" flow is available again. It is
 * a DEV prerequisite only (like teleport); the car itself is driven through the real world path.
 * Call AFTER any resetGame()/resetWorld() (a reset clears ownership).
 */
export async function acquireDrivableCar(page: Page): Promise<void> {
  await page.evaluate(() => window.GAME_TEST_API!.vehicleGrant('veh_compact', { location: 'active' }))
  await page.waitForTimeout(150) // one frame for the shell body/mesh to wake + register its interactable
  // …and then wait for the shell to LAND. `resetGame()` re-seats it at CAR_SPAWN's y = 0.8 and
  // physics drops it; a test that drives away mid-fall leaves residual vertical velocity that
  // `VehicleController` preserves on every frame it writes (`setLinvel({ x, y: vel.y, z })`), so
  // the car keeps climbing — measured 0.302 -> 0.717 over six seconds on issue #47's branch,
  // which drags the follow camera and shifts an entire visual frame. The window is narrow (at
  // the merge base the same tests entered a car already at y = -0.00006), which is why only a
  // change in load timing exposed it.
  await waitForVehicleGrounded(page)
}

/** Wait until the ONE drivable shell has settled onto the ground after a respawn. */
export async function waitForVehicleGrounded(
  page: Page,
  opts: { maxY?: number; timeout?: number } = {},
): Promise<void> {
  const maxY = opts.maxY ?? 0.05
  await page.waitForFunction(
    (limit) => {
      const p = window.GAME_TEST_API?.getDrivableVehiclePosition?.() ?? null
      return p != null && Math.abs(p[1]) <= limit
    },
    maxY,
    { timeout: opts.timeout ?? 20_000, polling: 100 },
  )
}
