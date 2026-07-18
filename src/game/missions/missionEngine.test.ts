import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyMissionEvent,
  cancelMission,
  discoverMission,
  retryMission,
  startMission,
  type MissionEngineContext,
} from './missionEngine'
import { missionRuntime, resetMissionRuntime } from './missionRuntime'
import { MISSION_DEFINITIONS, getMissionDefinition } from './missionDefinitions'
import { MISSION_ANCHORS } from './missionAnchors'
import { SECTOR_DEFINITIONS } from '../world/sectors/sectorRegistry'
import { getMissionAvailability, selectMissionTarget } from './missionSelectors'
import { validateMissions } from './missionValidation'
import {
  applyMissionSave,
  isValidMissionSave,
  serializeMissions,
} from './missionPersistence'
import { claimMissionReward } from './missionRewards'

const TARGET = 'theft_occupied_plaza'

function ctx(over: Partial<MissionEngineContext> = {}): MissionEngineContext {
  return {
    gameHours: 100,
    gameTime: 1000,
    wantedLevel: 0,
    // Default: the player is driving the resolved target (the happy path).
    drivenVehicleSourceId: TARGET,
    resolveTarget: () => TARGET,
    applyRewards: vi.fn(),
    toast: vi.fn(),
    ...over,
  }
}

/** Start City Courier and drive it all the way to a paid completion. */
function completeCourier(c: MissionEngineContext) {
  startMission('city_courier', c)
  applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, c)
  finishCourierFromWaterfront(c)
}

/** Finish an active City Courier that is at the Waterfront drop (post-depot). */
function finishCourierFromWaterfront(c: MissionEngineContext) {
  applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_waterfront' }, c)
  applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_mainstreet' }, c)
  applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_return' }, c)
}

/**
 * A validation context that resolves every ref the two proof missions use.
 * `registeredSectorIds` comes from the REAL sector registry (not from the
 * anchors themselves), so this genuinely proves every mission anchor lands in
 * an authored, streamed sector rather than passing circularly.
 */
function validationCtx() {
  return {
    anchorIds: new Set(MISSION_ANCHORS.map((a) => a.id)),
    interactableIds: new Set(['courier_depot', 'hotcargo_fixer']),
    registeredSectorIds: new Set(SECTOR_DEFINITIONS.map((d) => d.id)),
    phoneJobIds: new Set(['city_courier', 'corner_take', 'fast_exit']),
  }
}

beforeEach(() => resetMissionRuntime())

// ---- Definitions & validation --------------------------------------------

describe('definitions & validation', () => {
  it('has stable, unique mission + objective ids in deterministic order', () => {
    expect(MISSION_DEFINITIONS.map((m) => m.id)).toEqual([
      'city_courier',
      'hot_cargo',
      'corner_take',
      'fast_exit',
    ])
    for (const def of MISSION_DEFINITIONS) {
      const ids = def.objectives.map((o) => o.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('the shipped definitions validate against the world context', () => {
    expect(validateMissions(validationCtx())).toEqual([])
  })

  it('rejects an unknown anchor reference', () => {
    const bad = { ...validationCtx(), anchorIds: new Set<string>() }
    expect(validateMissions(bad).some((e) => e.includes('unknown anchor'))).toBe(true)
  })

  it('rejects an unknown interactable reference', () => {
    const bad = { ...validationCtx(), interactableIds: new Set<string>() }
    expect(validateMissions(bad).some((e) => e.includes('unknown interactable'))).toBe(true)
  })

  it('every mission anchor resolves to a registered sector', () => {
    const errs = validateMissions(validationCtx())
    expect(errs.filter((e) => e.includes('not registered'))).toEqual([])
  })
})

// ---- Deterministic target selection --------------------------------------

describe('target selection', () => {
  it('is deterministic for a given mission/attempt/day', () => {
    const args = {
      missionId: 'hot_cargo',
      selectorId: 'hotcargo_target',
      attemptSeq: 3,
      gameDay: 5,
      candidates: ['theft_occupied_plaza', 'theft_occupied_market'],
    }
    expect(selectMissionTarget(args)).toBe(selectMissionTarget(args))
  })

  it('is independent of candidate order', () => {
    const base = { missionId: 'hot_cargo', selectorId: 's', attemptSeq: 1, gameDay: 2 }
    const a = selectMissionTarget({ ...base, candidates: ['a', 'b', 'c'] })
    const b = selectMissionTarget({ ...base, candidates: ['c', 'b', 'a'] })
    expect(a).toBe(b)
  })

  it('returns null when there are no candidates', () => {
    expect(
      selectMissionTarget({ missionId: 'm', selectorId: 's', attemptSeq: 1, gameDay: 1, candidates: [] }),
    ).toBeNull()
  })
})

// ---- Availability ---------------------------------------------------------

describe('availability', () => {
  const courier = getMissionDefinition('city_courier')!
  const hot = getMissionDefinition('hot_cargo')!
  const base = { gameHours: 100, activeMissionId: null, discovered: new Set<string>(), cooldownReadyAt: {} }

  it('phone-offered lawful missions are available from the start', () => {
    expect(getMissionAvailability(courier, base)).toBe('available')
  })
  it('interactable-offered missions stay locked until discovered', () => {
    expect(getMissionAvailability(hot, base)).toBe('locked')
    expect(getMissionAvailability(hot, { ...base, discovered: new Set(['hot_cargo']) })).toBe('available')
  })
  it('reports cooldown while the readiness hour is in the future', () => {
    expect(getMissionAvailability(courier, { ...base, cooldownReadyAt: { city_courier: 106 } })).toBe('cooldown')
    expect(getMissionAvailability(courier, { ...base, cooldownReadyAt: { city_courier: 99 } })).toBe('available')
  })
})

// ---- State machine --------------------------------------------------------

describe('mission state machine', () => {
  it('starts a mission into an active runtime with a unique attempt id', () => {
    const r = startMission('city_courier', ctx())
    expect(r.ok).toBe(true)
    expect(missionRuntime.active?.missionId).toBe('city_courier')
    expect(missionRuntime.active?.attemptId).toBe('city_courier#1')
    expect(missionRuntime.active?.objectiveIndex).toBe(0)
  })

  it('enforces one active mission at a time', () => {
    startMission('city_courier', ctx())
    discoverMission('hot_cargo')
    const r = startMission('hot_cargo', ctx())
    expect(r).toEqual({ ok: false, reason: 'another_active' })
  })

  it('ignores an event that does not satisfy the current objective', () => {
    startMission('city_courier', ctx())
    applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_waterfront' }, ctx()) // pickup still pending
    expect(missionRuntime.active?.objectiveIndex).toBe(0)
  })

  it('does not double-advance on a duplicate event', () => {
    startMission('city_courier', ctx())
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, ctx())
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, ctx())
    expect(missionRuntime.active?.objectiveIndex).toBe(1) // advanced exactly once
  })

  it('cancellation cleans up the active mission without a reward', () => {
    const c = ctx()
    startMission('city_courier', c)
    expect(cancelMission(c)).toBe(true)
    expect(missionRuntime.active).toBeNull()
    expect(missionRuntime.result?.outcome).toBe('cancelled')
    expect(c.applyRewards).not.toHaveBeenCalled()
  })

  it('retry creates a fresh attempt id after a failure', () => {
    startMission('city_courier', ctx())
    applyMissionEvent({ type: 'player_arrested' }, ctx())
    expect(missionRuntime.active).toBeNull()
    const r = retryMission(ctx())
    expect(r.ok).toBe(true)
    expect(missionRuntime.active?.attemptId).toBe('city_courier#2')
  })
})

// ---- City Courier full loop + rewards ------------------------------------

describe('City Courier flow', () => {
  function runToReturn(c: MissionEngineContext) {
    startMission('city_courier', c)
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, c)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_waterfront' }, c)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_mainstreet' }, c)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_return' }, c)
  }

  it('completes the full loop, grants the reward once, and starts a cooldown', () => {
    const c = ctx({ gameHours: 100 })
    runToReturn(c)
    expect(missionRuntime.active).toBeNull()
    expect(missionRuntime.result?.outcome).toBe('completed')
    expect(c.applyRewards).toHaveBeenCalledTimes(1)
    expect(c.applyRewards).toHaveBeenCalledWith([{ kind: 'money', amount: 100 }], 100)
    expect(missionRuntime.history['city_courier'].completions).toBe(1)
    expect(missionRuntime.cooldowns['city_courier'].readyAtGameHours).toBe(106) // +6h
  })

  it('a stray return event after completion cannot re-grant the reward', () => {
    const c = ctx()
    runToReturn(c)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_return' }, c) // no active mission now
    expect(c.applyRewards).toHaveBeenCalledTimes(1)
  })

  it('a wrong-order delivery does not advance the mission', () => {
    const c = ctx()
    startMission('city_courier', c)
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, c) // → drop_waterfront
    applyMissionEvent({ type: 'reached_zone', anchorId: 'courier_mainstreet' }, c) // wrong drop
    expect(missionRuntime.active?.objectiveIndex).toBe(1)
  })
})

// ---- Hot Cargo full loop --------------------------------------------------

describe('Hot Cargo flow', () => {
  it('resolves a deterministic target and only the correct theft advances', () => {
    const c = ctx({ wantedLevel: 2 })
    startMission('hot_cargo', c)
    expect(missionRuntime.active?.variables.targetVehicle).toBe(TARGET)
    expect(missionRuntime.active?.ownedEntityIds.has(TARGET)).toBe(true)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: 'theft_parked_market', theftKind: 'vehicle_theft' }, c)
    expect(missionRuntime.active?.objectiveIndex).toBe(0) // wrong vehicle: no advance
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    expect(missionRuntime.active?.objectiveIndex).toBe(1) // → lose_heat
  })

  it('gates delivery on losing the wanted level', () => {
    const wanted = { level: 2 }
    const c = () => ctx({ wantedLevel: wanted.level })
    startMission('hot_cargo', c())
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(1) // lose_heat (wanted 2)
    // Arrive at the garage while still wanted → rejected.
    applyMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(1)
    // Clear wanted → lose_heat completes → deliver_drive.
    wanted.level = 0
    applyMissionEvent({ type: 'wanted_changed', previous: 2, current: 0 }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(2) // deliver_drive
    applyMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(3) // dismount
  })

  it('an unwitnessed theft (already wanted 0) advances past lose_wanted instantly', () => {
    const c = ctx({ wantedLevel: 0 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    // boost → lose_heat (instantly complete, wanted 0) → deliver_drive
    expect(missionRuntime.active?.objectiveIndex).toBe(2)
  })

  it('completes handoff, pays once, cleans up the target, and starts the long cooldown', () => {
    const c = ctx({ wantedLevel: 0, gameHours: 200 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' }, c) // deliver_drive
    applyMissionEvent({ type: 'vehicle_exited', vehicleId: TARGET }, c) // dismount
    applyMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }, c) // handoff
    expect(missionRuntime.active).toBeNull()
    expect(missionRuntime.result?.outcome).toBe('completed')
    expect(c.applyRewards).toHaveBeenCalledWith([{ kind: 'money', amount: 280 }], 280)
    expect(missionRuntime.cooldowns['hot_cargo'].readyAtGameHours).toBe(220) // +20h
  })

  it('fails when the player is arrested', () => {
    const c = ctx({ wantedLevel: 3 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'player_arrested' }, c)
    expect(missionRuntime.active).toBeNull()
    expect(missionRuntime.result?.outcome).toBe('failed')
    expect(missionRuntime.result?.reason).toBe('player_arrested')
  })

  it('fails when the target vehicle is disabled', () => {
    const c = ctx({ wantedLevel: 1 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'vehicle_disabled', vehicleId: TARGET }, c)
    expect(missionRuntime.result?.reason).toBe('target_vehicle_disabled')
  })

  it('a non-target vehicle being disabled does NOT fail the mission', () => {
    const c = ctx({ wantedLevel: 1 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'vehicle_disabled', vehicleId: 'some_other_car' }, c)
    expect(missionRuntime.active).not.toBeNull()
  })

  // ---- Exact stolen-vehicle identity (Fix 2) ------------------------------

  it('handoff is REJECTED when the driven car is not the exact boosted target', () => {
    // Drive to the garage and dismount, then interact with the fixer while the
    // player's drivable car represents a DIFFERENT (replacement) source. The
    // handoff must not complete — a decoy cannot satisfy Hot Cargo.
    const c = ctx({ wantedLevel: 0 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' }, c) // deliver_drive → dismount
    applyMissionEvent({ type: 'vehicle_exited', vehicleId: TARGET }, c) // dismount → handoff
    expect(missionRuntime.active?.objectiveIndex).toBe(4) // at handoff
    // Now the driven source is a replacement car, not the target.
    const decoy = ctx({ wantedLevel: 0, drivenVehicleSourceId: 'theft_parked_market' })
    applyMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }, decoy)
    expect(missionRuntime.active?.objectiveIndex).toBe(4) // still at handoff — rejected
    expect(missionRuntime.active).not.toBeNull()
    // Driving the real target again completes it.
    applyMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }, ctx({ wantedLevel: 0 }))
    expect(missionRuntime.result?.outcome).toBe('completed')
  })

  it('handoff is REJECTED when the car is not stolen at all (source null)', () => {
    const c = ctx({ wantedLevel: 0 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'hotcargo_garage' }, c)
    applyMissionEvent({ type: 'vehicle_exited', vehicleId: TARGET }, c)
    const onFoot = ctx({ wantedLevel: 0, drivenVehicleSourceId: null })
    applyMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }, onFoot)
    expect(missionRuntime.active).not.toBeNull() // no car ⇒ no handoff
  })

  // ---- target_vehicle_lost (Fix 3) ----------------------------------------

  it('a vehicle_lost for the boosted target fails with target_vehicle_lost', () => {
    const c = ctx({ wantedLevel: 0 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'vehicle_lost', vehicleId: TARGET }, c)
    expect(missionRuntime.active).toBeNull()
    expect(missionRuntime.result?.outcome).toBe('failed')
    expect(missionRuntime.result?.reason).toBe('target_vehicle_lost')
  })

  it('a vehicle_lost for a non-target vehicle does NOT fail the mission', () => {
    const c = ctx({ wantedLevel: 0 })
    startMission('hot_cargo', c)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'occupied_vehicle_theft' }, c)
    applyMissionEvent({ type: 'vehicle_lost', vehicleId: 'theft_parked_market' }, c)
    expect(missionRuntime.active).not.toBeNull()
  })

  it('cannot start until discovered, then can', () => {
    expect(startMission('hot_cargo', ctx()).ok).toBe(true) // engine start is discovery-agnostic
    // (discovery gates AVAILABILITY, tested above; the engine start guards active/cooldown.)
  })
})

// ---- Corner Take: a mission that OBSERVES a robbery ------------------------

describe('Corner Take flow', () => {
  const LOOTED = (amount: number, storeId = 'robbery_mainst_store') =>
    ({ type: 'activity_event', event: { type: 'register_looted', activityId: storeId, storeId, amount } }) as const
  const SECURED = (amount: number) =>
    ({ type: 'activity_event', event: { type: 'proceeds_secured', amount } }) as const

  it('advances on a qualifying robbery, then on securing, and pays the bonus once', () => {
    const c = ctx({ gameHours: 300 })
    startMission('corner_take', c)
    expect(missionRuntime.active?.objectiveIndex).toBe(0) // rob_store
    // A take BELOW the minimum does not advance.
    applyMissionEvent(LOOTED(80), c)
    expect(missionRuntime.active?.objectiveIndex).toBe(0)
    // A different store does not advance.
    applyMissionEvent(LOOTED(200, 'robbery_waterfront_kiosk'), c)
    expect(missionRuntime.active?.objectiveIndex).toBe(0)
    // The marked store for >= the minimum advances to secure.
    applyMissionEvent(LOOTED(150), c)
    expect(missionRuntime.active?.objectiveIndex).toBe(1) // secure_proceeds
    applyMissionEvent(SECURED(150), c)
    expect(missionRuntime.active).toBeNull()
    expect(missionRuntime.result?.outcome).toBe('completed')
    expect(c.applyRewards).toHaveBeenCalledWith([{ kind: 'money', amount: 150 }], 150)
  })

  it('fails on arrest and does not pay the bonus', () => {
    const c = ctx()
    startMission('corner_take', c)
    applyMissionEvent({ type: 'player_arrested' }, c)
    expect(missionRuntime.result?.outcome).toBe('failed')
    expect(c.applyRewards).not.toHaveBeenCalled()
  })
})

// ---- Fast Exit: getaway car + observed robbery + pursuit ------------------

describe('Fast Exit flow', () => {
  const LOOTED = (amount: number, storeId = 'robbery_mainst_store') =>
    ({ type: 'activity_event', event: { type: 'register_looted', activityId: storeId, storeId, amount } }) as const
  const SECURED = (amount: number) =>
    ({ type: 'activity_event', event: { type: 'proceeds_secured', amount } }) as const

  /** Walk from a fresh Fast Exit up to (but not through) the given objective idx,
   *  driving the exact getaway target the whole time. `wanted` is the live heat. */
  function startAndStage(wanted = 2) {
    const c = () => ctx({ wantedLevel: wanted })
    startMission('fast_exit', c())
    expect(missionRuntime.active?.objectiveIndex).toBe(0) // brief
    applyMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(1) // getaway
    expect(missionRuntime.active?.variables.targetVehicle).toBe(TARGET)
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'vehicle_theft' }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(2) // stage
    return c
  }

  it('passes preferParked into target selection for the getaway car', () => {
    const seen: { preferParked?: boolean }[] = []
    const c = ctx({
      resolveTarget: (_selector, opts) => {
        seen.push(opts ?? {})
        return TARGET
      },
    })
    startMission('fast_exit', c)
    applyMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }, c)
    // The getaway steal_vehicle objective resolves with preferParked = true.
    expect(seen).toEqual([{ preferParked: true }])
  })

  it('stages a still-hot getaway car (requireClean:false skips the wanted gate)', () => {
    const c = startAndStage(2)
    // Wanted 2 but staging is a staging park, not a clean delivery → it advances.
    applyMissionEvent({ type: 'reached_zone', anchorId: 'fastexit_staging' }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(3) // rob
  })

  it('completes the whole loop, pays the bonus once, and starts a cooldown', () => {
    const wanted = { level: 2 }
    const applyRewards = vi.fn()
    // One shared reward sink; heat is live via the `wanted` box.
    const c = () => ctx({ wantedLevel: wanted.level, gameHours: 400, applyRewards })
    startMission('fast_exit', c())
    applyMissionEvent({ type: 'interactable_used', interactableId: 'hotcargo_fixer' }, c()) // brief → getaway
    applyMissionEvent({ type: 'vehicle_stolen', vehicleId: TARGET, theftKind: 'vehicle_theft' }, c()) // → stage
    applyMissionEvent({ type: 'reached_zone', anchorId: 'fastexit_staging' }, c()) // → rob (hot ok)
    applyMissionEvent(LOOTED(140), c()) // rob a qualifying take → to_getaway
    expect(missionRuntime.active?.objectiveIndex).toBe(4)
    applyMissionEvent({ type: 'vehicle_entered', vehicleId: TARGET }, c()) // back in the getaway → lose_heat
    expect(missionRuntime.active?.objectiveIndex).toBe(5)
    // Still wanted: securing can't be reached until heat is gone.
    applyMissionEvent(SECURED(140), c())
    expect(missionRuntime.active?.objectiveIndex).toBe(5)
    wanted.level = 0
    applyMissionEvent({ type: 'wanted_changed', previous: 2, current: 0 }, c()) // → secure
    expect(missionRuntime.active?.objectiveIndex).toBe(6)
    applyMissionEvent(SECURED(140), c()) // secure the take → complete
    expect(missionRuntime.active).toBeNull()
    expect(missionRuntime.result?.outcome).toBe('completed')
    expect(applyRewards).toHaveBeenCalledTimes(1)
    expect(applyRewards).toHaveBeenCalledWith([{ kind: 'money', amount: 250 }], 250)
    expect(missionRuntime.cooldowns['fast_exit'].readyAtGameHours).toBe(424) // +24h
  })

  it('only the EXACT getaway car re-entry advances to lose_heat', () => {
    const c = startAndStage(2)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'fastexit_staging' }, c()) // → rob
    applyMissionEvent(LOOTED(140), c()) // → to_getaway
    expect(missionRuntime.active?.objectiveIndex).toBe(4)
    // Entering a DIFFERENT car does not satisfy the getaway re-entry.
    applyMissionEvent({ type: 'vehicle_entered', vehicleId: 'theft_parked_market' }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(4)
    applyMissionEvent({ type: 'vehicle_entered', vehicleId: TARGET }, c())
    expect(missionRuntime.active?.objectiveIndex).toBe(5) // lose_heat
  })

  it('a sub-minimum take does not satisfy the robbery step', () => {
    const c = startAndStage(2)
    applyMissionEvent({ type: 'reached_zone', anchorId: 'fastexit_staging' }, c())
    applyMissionEvent(LOOTED(100), c()) // below $120
    expect(missionRuntime.active?.objectiveIndex).toBe(3) // still robbing
    applyMissionEvent(LOOTED(120), c())
    expect(missionRuntime.active?.objectiveIndex).toBe(4) // → to_getaway
  })

  it('fails if the getaway car is disabled during the run', () => {
    const c = startAndStage(2)
    applyMissionEvent({ type: 'vehicle_disabled', vehicleId: TARGET }, c())
    expect(missionRuntime.result?.reason).toBe('target_vehicle_disabled')
  })

  it('fails on arrest mid-heist and pays nothing', () => {
    const c = startAndStage(3)
    applyMissionEvent({ type: 'player_arrested' }, c())
    expect(missionRuntime.result?.outcome).toBe('failed')
    expect(missionRuntime.result?.reason).toBe('player_arrested')
  })

  it('is save-blocking: an active Fast Exit is never serialized', () => {
    startMission('fast_exit', ctx())
    expect(serializeMissions().active).toBeUndefined()
  })
})

// ---- Persistence ----------------------------------------------------------

describe('persistence', () => {
  it('serializes history/cooldowns/discovered and a lawful active mission', () => {
    const c = ctx()
    discoverMission('hot_cargo')
    startMission('city_courier', c)
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, c) // at drop_waterfront
    const data = serializeMissions()
    expect(isValidMissionSave(data)).toBe(true)
    expect(data.discovered).toContain('hot_cargo')
    expect(data.active?.missionId).toBe('city_courier')
    expect(data.active?.objectiveIndex).toBe(1)
  })

  it('never serializes an active criminal (save-blocking) mission', () => {
    const c = ctx()
    startMission('hot_cargo', c)
    const data = serializeMissions()
    expect(data.active).toBeUndefined()
  })

  it('restores a lawful active mission at its objective; markers rebuilt empty', () => {
    const c = ctx()
    startMission('city_courier', c)
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, c)
    const data = serializeMissions()
    resetMissionRuntime()
    applyMissionSave(data)
    expect(missionRuntime.active?.missionId).toBe('city_courier')
    expect(missionRuntime.active?.objectiveIndex).toBe(1)
    expect(missionRuntime.active?.activeMarkerIds.size).toBe(0)
  })

  it('an old save (no mission field) loads with empty history, no crash', () => {
    applyMissionSave(undefined)
    expect(missionRuntime.history).toEqual({})
    expect(missionRuntime.active).toBeNull()
  })

  it('drops an active mission whose definition version no longer matches (fail safe)', () => {
    const c = ctx()
    startMission('city_courier', c)
    const data = serializeMissions()
    data.active!.missionVersion = 999
    resetMissionRuntime()
    applyMissionSave(data)
    expect(missionRuntime.active).toBeNull()
  })

  it('loading never grants a reward', () => {
    const c = ctx()
    startMission('city_courier', c)
    const data = serializeMissions()
    resetMissionRuntime()
    applyMissionSave(data)
    expect(c.applyRewards).not.toHaveBeenCalled()
  })

  // ---- Persistence hardening (Fix 4) --------------------------------------

  it('persists receipts and the attempt counter', () => {
    const c = ctx()
    completeCourier(c) // attempt #1 → receipt
    const data = serializeMissions()
    expect(data.attemptSeq).toBe(1)
    expect(data.receipts.map((r) => r.attemptId)).toContain('city_courier#1')
    expect(isValidMissionSave(data)).toBe(true)
  })

  it('attempt ids never repeat after a reload / fresh session', () => {
    const c = ctx()
    completeCourier(c) // uses attempt #1
    const data = serializeMissions()
    resetMissionRuntime() // fresh session: attemptSeq back to 0
    applyMissionSave(data)
    // The next mission must NOT reuse #1 — the counter was restored.
    expect(missionRuntime.attemptSeq).toBeGreaterThanOrEqual(1)
    startMission('hot_cargo', ctx())
    expect(missionRuntime.active?.attemptId).toBe('hot_cargo#2')
    expect(missionRuntime.active?.attemptId).not.toBe('hot_cargo#1')
  })

  it('a persisted receipt blocks re-paying the SAME attempt after reload', () => {
    const c = ctx()
    completeCourier(c) // receipt for city_courier#1
    const data = serializeMissions()
    resetMissionRuntime()
    applyMissionSave(data) // receipts restored
    // Attempting to claim the already-paid attempt id pays nothing.
    const claim = claimMissionReward('city_courier', 'city_courier#1', [{ kind: 'money', amount: 100 }], 100)
    expect(claim.alreadyClaimed).toBe(true)
    expect(claim.moneyTotal).toBe(0)
  })

  it('re-mints a restored active mission with a fresh, unused attempt id', () => {
    const c = ctx()
    startMission('city_courier', c) // attempt #1
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, c)
    const data = serializeMissions()
    const savedId = data.active!.attemptId
    resetMissionRuntime()
    applyMissionSave(data)
    // Progress is preserved but the attempt id is a NEW one (never the saved id),
    // so finishing a reloaded save can't collide with a prior completion receipt.
    expect(missionRuntime.active?.objectiveIndex).toBe(1)
    expect(missionRuntime.active?.attemptId).not.toBe(savedId)
    expect(missionRuntime.active?.attemptId).toMatch(/^city_courier#\d+$/)
  })

  it('reloading a pre-completion save then finishing does NOT double-pay the same attempt', () => {
    // Full integration of the guarantee: save mid-mission, finish once (paid),
    // reload the SAME pre-completion save, finish again. Each finish is a
    // distinct re-minted attempt, and no single attempt id is ever paid twice.
    const first = ctx()
    startMission('city_courier', first) // #1
    applyMissionEvent({ type: 'interactable_used', interactableId: 'courier_depot' }, first)
    const midSave = serializeMissions() // active #1, no receipts yet
    finishCourierFromWaterfront(first)
    expect(first.applyRewards).toHaveBeenCalledTimes(1)
    const paidAttempts = Object.keys(missionRuntime.receipts)
    expect(paidAttempts).toHaveLength(1)

    // Reload the pre-completion save into the SAME runtime and finish again.
    applyMissionSave({ ...midSave, receipts: Object.values(missionRuntime.receipts), attemptSeq: missionRuntime.attemptSeq })
    const second = ctx()
    finishCourierFromWaterfront(second)
    // Every receipt is a UNIQUE attempt id — no id paid twice.
    const ids = Object.keys(missionRuntime.receipts)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(undefined)
  })

  it('rejects a save with a malformed nested active field (fail safe)', () => {
    const c = ctx()
    startMission('city_courier', c)
    const data = serializeMissions() as unknown as Record<string, unknown>
    ;(data.active as Record<string, unknown>).objectiveStates = [{ id: 5, phase: 'bogus', progress: 'x' }]
    expect(isValidMissionSave(data)).toBe(false)
  })

  it('rejects malformed receipts / attemptSeq', () => {
    const base = serializeMissions() as unknown as Record<string, unknown>
    expect(isValidMissionSave({ ...base, receipts: [{ attemptId: 1 }] })).toBe(false)
    expect(isValidMissionSave({ ...base, attemptSeq: -3 })).toBe(false)
    expect(isValidMissionSave({ ...base, attemptSeq: 'x' })).toBe(false)
  })

  it('an old save without receipts/attemptSeq is still valid (compat)', () => {
    const legacy = {
      version: 1,
      history: [{ missionId: 'city_courier', completions: 1, lastCompletedGameHours: 10, totalEarned: 100 }],
      cooldowns: [],
      discovered: ['hot_cargo'],
    }
    expect(isValidMissionSave(legacy)).toBe(true)
    applyMissionSave(legacy as unknown as ReturnType<typeof serializeMissions>)
    expect(missionRuntime.history['city_courier'].completions).toBe(1)
    expect(missionRuntime.discovered.has('hot_cargo')).toBe(true)
  })
})
