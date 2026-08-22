import { expect, test } from '@playwright/test'
import { gotoGame } from './helpers'

/**
 * Bounded SOCIAL LIFECYCLE soak (issue #13 §15) driving the REAL runtime wiring
 * through the dev API — conversations, gifts, favors, invitations + responses,
 * completed AND missed activities, phone/messages, district travel + an interior,
 * and save/load + reset boundaries — while asserting nothing duplicates, every
 * collection stays bounded, nothing leaks, no page/console errors occur, and no
 * World Integrity anomaly is introduced by social activity. This does NOT replace
 * the 300s city-integrity soak; it complements it with social wiring.
 */
const CAST = ['npc_ravi_01', 'npc_maya_01', 'npc_bruno_01', 'npc_leo_01', 'npc_kim_01', 'npc_nisha_01']
const DISTRICT_SPOTS: [number, number, number][] = [
  [0, 1.2, 0],
  [53, 1.2, -108],
  [13, 1.2, 14],
  [12, 1.2, -26],
]

test.describe('social lifecycle soak', { tag: '@simulation-only' }, () => {
  test('cycles the whole cast without duplication, leaks, or integrity damage', async ({ page }) => {
    test.setTimeout(180_000)

    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })

    await gotoGame(page)

    // Drive ~30 game-days of varied social activity through the real store/runtime.
    const summary = await page.evaluate(
      async ({ cast, spots }) => {
        const api = window.GAME_TEST_API!
        api.resetGame()
        // Everyone meets the player first (real dialogues open the contacts).
        for (const id of cast) api.openDialogueWith(id)
        api.closePanel?.()

        const bounds: string[] = []
        const checkBounds = (day: number) => {
          const snap = api.getSocialSnapshot()
          if (snap.totalMemories > 16 * cast.length) bounds.push(`day${day} memories ${snap.totalMemories}`)
          if (snap.appliedEventCount > 256) bounds.push(`day${day} applied ${snap.appliedEventCount}`)
          if (snap.invitationCount > 16) bounds.push(`day${day} invitations ${snap.invitationCount}`)
          for (const id of cast) {
            if (api.getSocialMessages(id).length > 12) bounds.push(`day${day} ${id} messages`)
            if (api.getSocialMemories(id).length > 16) bounds.push(`day${day} ${id} memories`)
          }
        }

        for (let day = 1; day <= 30; day++) {
          api.setTime(9)
          const actor = cast[day % cast.length]

          // Conversation + check-in + a gift (real inventory) + a favor request.
          api.giveItem('snack', 1)
          api.performSocialAction(actor, 'talk')
          api.performSocialAction(actor, 'check_in')
          api.performSocialAction(actor, 'gift', 'snack')
          api.performSocialAction(actor, 'ask_favor')

          // Phone: NPCs reach out; the player answers whatever is pending.
          api.reconcileSocialOutreach(day, 10)
          for (const inv of api.getSocialInvitations().filter((i) => i.status === 'pending')) {
            api.respondToInvitation(inv.id, day % 3 === 0 ? 'declined' : day % 3 === 1 ? 'suggested_later' : 'accepted')
          }

          // Every 3rd day: a full player-invited hangout to COMPLETION (arrive at
          // the venue first — the destination gate requires it).
          if (day % 3 === 0) {
            api.sendSocialInvite(actor, 'coffee')
            const inv = api.getSocialInvitations().find((i) => i.source === 'player' && i.status === 'accepted')
            if (inv) {
              api.setGameDay(inv.proposedDay) // advance the clock into the plan's window
              api.setTime(inv.proposedHour)
              api.startSocialActivity(inv.id)
              api.setActiveInteractable(api.getActiveSocialActivity()?.venueId ?? null) // arrive
              api.advanceSocialActivity()
              api.advanceSocialActivity()
              api.setActiveInteractable(null)
            }
          }
          // Every 4th day: a favor errand, sometimes MISSED (cancelled → no-show).
          if (day % 4 === 0) {
            api.giveItem('snack', 1)
            api.startFavorFor(actor)
            api.setActiveInteractable(api.getActiveSocialActivity()?.venueId ?? null) // arrive
            if (day % 8 === 0) api.cancelSocialActivity()
            else {
              api.advanceSocialActivity()
              api.advanceSocialActivity()
              api.advanceSocialActivity()
            }
            api.setActiveInteractable(null)
          }

          // District travel + an interior visit on a cadence (lifecycle churn).
          if (day % 5 === 0) {
            api.teleportPlayer(spots[(day / 5) % spots.length])
          }
          if (day % 6 === 0) {
            api.enterInterior('store_mainst')
            api.exitInterior?.()
          }

          // Save/load + reset boundaries (state must survive / clear cleanly).
          if (day === 12) {
            await api.saveGame()
            api.resetGame()
            await api.loadGame()
          }

          checkBounds(day)
        }

        // Steady-state integrity: back at spawn, let the crowd settle, then verify
        // NO actor is embedded in a solid/vehicle — the occupancy contract social
        // activities must preserve. (Ambient crowd person-person transients are the
        // 300s soak's concern, not this one.)
        api.teleportPlayer([0, 1.2, 0])
        await new Promise((r) => setTimeout(r, 900))
        api.runIntegrityScan()
        const solidOverlaps = api.assertNoPersonSolidOverlaps().length
        const vehicleOverlaps = api.assertNoPersonVehicleOverlaps().length
        const socialOccupancyAnoms = api
          .getIntegrityAnomalies()
          .filter((a) => a.type === 'person_solid_overlap' || a.type === 'person_vehicle_overlap').length

        // Exact-once: a duplicate event id never re-applies.
        api.ingestSocialEvent({ id: 'soak_dup', kind: 'favor_completed', actorId: 'npc_ravi_01', gameDay: 30, gameHour: 9 })
        const t = api.getSocialRelationship('npc_ravi_01').trust
        const m = api.getSocialMemories('npc_ravi_01').length
        const dup = api.ingestSocialEvent({ id: 'soak_dup', kind: 'favor_completed', actorId: 'npc_ravi_01', gameDay: 30, gameHour: 9 })

        const snap = api.getSocialSnapshot()
        return {
          bounds,
          solidOverlaps,
          vehicleOverlaps,
          socialOccupancyAnoms,
          dupApplied: dup.applied,
          trustStable: api.getSocialRelationship('npc_ravi_01').trust === t,
          memsStable: api.getSocialMemories('npc_ravi_01').length === m,
          leftoverActivity: api.getActiveSocialActivity(),
          contactCount: snap.contactCount,
          allEngaged: cast.every((id) => api.getSocialMemories(id).length > 0),
          totalMemories: snap.totalMemories,
          totalMessages: snap.totalMessages,
          invitationCount: snap.invitationCount,
          appliedEventCount: snap.appliedEventCount,
        }
      },
      { cast: CAST, spots: DISTRICT_SPOTS },
    )

    // No page or console errors during the whole soak.
    expect(errors, errors.join('\n')).toEqual([])
    // Every collection stayed bounded on every checked day.
    expect(summary.bounds, summary.bounds.join('; ')).toEqual([])
    expect(summary.totalMemories).toBeLessThanOrEqual(16 * CAST.length)
    expect(summary.appliedEventCount).toBeLessThanOrEqual(256)
    expect(summary.invitationCount).toBeLessThanOrEqual(16)
    // No actor embedded in a solid/vehicle — social activity preserved occupancy.
    expect(summary.solidOverlaps).toBe(0)
    expect(summary.vehicleOverlaps).toBe(0)
    expect(summary.socialOccupancyAnoms).toBe(0)
    // Exact-once holds; nothing duplicated.
    expect(summary.dupApplied).toBe(false)
    expect(summary.trustStable).toBe(true)
    expect(summary.memsStable).toBe(true)
    // No stranded activity instance leaked at the end.
    expect(summary.leftoverActivity).toBeNull()
    // The whole cast is engaged (every actor accrued memories); the first-meeting
    // + familiarity-threshold contacts have unlocked.
    expect(summary.allEngaged).toBe(true)
    expect(summary.contactCount).toBeGreaterThanOrEqual(4)
  })
})
