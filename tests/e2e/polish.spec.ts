import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * City Polish & Density Pass v1: street-level detail, citizen variety,
 * parked/service vehicles and map landmarks — all through validated
 * authoring flows, live in the running game.
 */

test.describe('city polish & density', () => {
  test('density lands validated: fixed props, queues/sitters, service vehicles', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await gotoGame(page)
    const snapshot = await page.evaluate(() => {
      const api = window.GAME_TEST_API!
      const sectors = ['s1_-1', 's0_-2', 's1_-2', 's2_-1', 's-1_-2']
      return {
        compiled: sectors.map((id) => api.getCompiledSectorContent(id)!),
        validations: sectors.map((id) => api.validateSectorAuthoring(id)),
        ownership: api.validateSectorOwnership(),
        citizens: api.getAmbientCitizens(),
        railingRef: api.getAuthoringSourceRef('s0_-2_railing_0'),
        frontRef: api.getAuthoringSourceRef('s1_-1_n2_front_0'),
      }
    })
    for (const v of snapshot.validations) expect(v).toEqual([])
    expect(snapshot.ownership).toEqual([])
    // The polish pass raised prop density across every kit sector.
    const totalProps = snapshot.compiled.reduce((n, c) => n + c.props, 0)
    expect(totalProps).toBeGreaterThanOrEqual(180)
    // Citizen VARIETY, not just count: queues, sitters and dock workers
    // from the polish pass are all in the live crowd.
    expect(snapshot.citizens.length).toBe(90)
    const ids = snapshot.citizens.map((c) => c.id)
    expect(ids.some((id) => id.includes('_queue_'))).toBe(true)
    expect(ids.some((id) => id.includes('_sitters_'))).toBe(true)
    expect(ids.some((id) => id.includes('_dock_walk_'))).toBe(true)
    expect(ids).toContain('cit_g_bench_reader')
    // Fixed-prop source refs are traceable to their authoring construct.
    expect(snapshot.railingRef).toEqual({
      sectorId: 's0_-2',
      templateId: 'line_props',
      localId: 'railing',
    })
    expect(snapshot.frontRef!.templateId).toMatch(/^front_detail:/)
    expect(errors).toEqual([])
  })

  test('phone map shows kit landmarks alongside district labels', async ({ page }) => {
    await gotoGame(page)
    await page.evaluate(() => {
      window.GAME_TEST_API!.resetGame()
      window.GAME_TEST_API!.teleportTo('central_plaza')
      window.GAME_TEST_API!.pauseWorld(true)
    })
    await page.waitForTimeout(600)
    await page.keyboard.press('Tab')
    await page.getByText('Map', { exact: true }).click()
    await expect(page.getByTestId('phone-map')).toBeVisible()
    for (const id of ['s0_-2_lm_pier_kiosk', 's1_-2_lm_exchange', 's2_-1_lm_green', 's-1_-2_lm_yard12']) {
      await expect(page.getByTestId(`map-marker-${id}`)).toBeVisible()
    }
    // Landmarks are clickable like any marker.
    await page.getByTestId('map-marker-s0_-2_lm_pier_kiosk').click()
    await expect(page.getByTestId('phone-map-caption')).toContainText('Pier Kiosk')
  })
})
