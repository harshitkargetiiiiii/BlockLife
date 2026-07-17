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
