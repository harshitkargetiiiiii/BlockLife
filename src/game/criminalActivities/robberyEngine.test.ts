import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginRobbery,
  lootRegister,
  fireAlarm,
  tickAlarm,
  abandonRobbery,
  secureProceeds,
  loseProceeds,
  type RobberyEngineContext,
} from './robberyEngine'
import { activityRuntime, getStoreState, resetActivityRuntime } from './activityRuntime'
import { ROBBERY_DEFINITIONS, getRobberyDefinition } from './activityDefinitions'
import { decideCashier, rollLoot, isAimingAtCashier } from './robberyLogic'
import { validateRobberies, type ActivityValidationContext } from './activityValidation'
import {
  applyActivitySave,
  isValidActivitySave,
  serializeActivities,
} from './activityPersistence'
import { INTERIORS } from '../interiors/interiorRegistry'
import { SECTOR_DEFINITIONS } from '../world/sectors/sectorRegistry'

const STORE = 'robbery_mainst_store'
const KIOSK = 'robbery_waterfront_kiosk'

const emitted: { type: string }[] = []

function ctx(over: Partial<RobberyEngineContext> = {}): RobberyEngineContext {
  return {
    gameTime: 1000,
    gameHours: 100,
    wantedLevel: 0,
    outOfCombat: true,
    reportCrime: vi.fn(),
    applyMoney: vi.fn(),
    emit: (e) => emitted.push(e),
    toast: vi.fn(),
    ...over,
  }
}

/** Force a store's next attempt to a chosen cashier decision (deterministic scan). */
function ordinalFor(defId: string, decision: 'comply' | 'flee' | 'refuse'): number {
  const def = getRobberyDefinition(defId)!
  for (let o = 0; o < 200; o++) if (decideCashier(def, o) === decision) return o
  throw new Error(`no ordinal yields ${decision}`)
}

function validationCtx(): ActivityValidationContext {
  const interiorBounds = new Map(
    INTERIORS.map((i) => [
      i.id,
      { origin: i.origin, halfWidth: i.size.width / 2, halfDepth: i.size.depth / 2 },
    ]),
  )
  return {
    interiorIds: new Set(INTERIORS.map((i) => i.id)),
    interiorBounds,
    registeredSectorIds: new Set(SECTOR_DEFINITIONS.map((d) => d.id)),
    interactableIds: new Set(['store_mainst_entrance', 'store_kiosk_entrance', 'hotcargo_fixer']),
    questCriticalNpcIds: new Set(['npc_ravi_01', 'npc_maya_01', 'npc_kim_01']),
  }
}

beforeEach(() => {
  resetActivityRuntime()
  emitted.length = 0
})

// ---- Definitions & validation --------------------------------------------

describe('definitions & validation', () => {
  it('has stable, unique ids in deterministic order', () => {
    expect(ROBBERY_DEFINITIONS.map((d) => d.id)).toEqual([STORE, KIOSK])
  })

  it('every definition validates against the real interiors + sectors', () => {
    expect(validateRobberies(validationCtx())).toEqual([])
  })

  it('rejects a cashier that is a quest-critical NPC', () => {
    const c = validationCtx()
    const bad: ActivityValidationContext = {
      ...c,
      questCriticalNpcIds: new Set(['cashier_mainst']),
    }
    const errs = validateRobberies(bad)
    expect(errs.some((e) => e.includes('quest-critical'))).toBe(true)
  })

  it('rejects a register outside its interior', () => {
    const c = validationCtx()
    const bounds = new Map(c.interiorBounds)
    bounds.set('store_mainst', { origin: [0, 0], halfWidth: 1, halfDepth: 1 })
    const errs = validateRobberies({ ...c, interiorBounds: bounds })
    expect(errs.some((e) => e.includes('outside interior'))).toBe(true)
  })
})

// ---- Deterministic logic --------------------------------------------------

describe('robbery logic (pure, seeded)', () => {
  it('cashier decision is stable per (store, ordinal)', () => {
    const def = getRobberyDefinition(STORE)!
    expect(decideCashier(def, 0)).toBe(decideCashier(def, 0))
    // All three outcomes are reachable across ordinals.
    const seen = new Set(Array.from({ length: 50 }, (_, o) => decideCashier(def, o)))
    expect(seen).toEqual(new Set(['comply', 'flee', 'refuse']))
  })

  it('loot is within range, rounded to $5, and stable per attempt id', () => {
    const def = getRobberyDefinition(STORE)!
    const a = rollLoot(def, 'robbery_mainst_store#1')
    expect(a).toBe(rollLoot(def, 'robbery_mainst_store#1')) // stable
    expect(a).toBeGreaterThanOrEqual(def.cashRange.min)
    expect(a).toBeLessThanOrEqual(def.cashRange.max)
    expect(a % 5).toBe(0)
    expect(rollLoot(def, 'robbery_mainst_store#2')).not.toBeNaN()
  })

  it('aim detection respects range and cone', () => {
    const def = getRobberyDefinition(STORE)!
    const [cx, cz] = def.cashierPosition
    // Stand 3 units south of the cashier, facing north (heading 0 → +z).
    const onTarget = isAimingAtCashier(def, cx, cz - 3, 0)
    expect(onTarget).toBe(true)
    // Facing away (south) → no.
    expect(isAimingAtCashier(def, cx, cz - 3, Math.PI)).toBe(false)
    // Too far.
    expect(isAimingAtCashier(def, cx, cz - 100, 0)).toBe(false)
  })
})

// ---- Engine: begin + cashier ---------------------------------------------

describe('robbery engine — begin', () => {
  it('comply → demanding (register openable); flee → threatening (locked)', () => {
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'comply')
    expect(beginRobbery(STORE, ctx()).ok).toBe(true)
    expect(activityRuntime.active?.phase).toBe('demanding')
    expect(emitted.map((e) => e.type)).toContain('cashier_decided')

    resetActivityRuntime()
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'flee')
    beginRobbery(STORE, ctx())
    expect(activityRuntime.active?.phase).toBe('threatening')
    expect(activityRuntime.active?.cashierPhase).toBe('fled')
  })

  it('guards: already active, on cooldown, register empty', () => {
    beginRobbery(STORE, ctx())
    expect(beginRobbery(STORE, ctx()).reason).toBe('already_active')
    resetActivityRuntime()
    getStoreState(STORE).cooldownReadyAtGameHours = 200
    expect(beginRobbery(STORE, ctx({ gameHours: 100 })).reason).toBe('on_cooldown')
    resetActivityRuntime()
    getStoreState(STORE).registerEmptied = true
    expect(beginRobbery(STORE, ctx()).reason).toBe('register_empty')
  })
})

// ---- Engine: loot exactly once -------------------------------------------

describe('robbery engine — loot', () => {
  function beginComply(gameHours = 100) {
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'comply')
    beginRobbery(STORE, ctx({ gameHours }))
  }

  it('pays exactly once, into unsecured proceeds, and closes the store', () => {
    beginComply()
    const amount = lootRegister(ctx({ gameHours: 100 }))
    expect(amount).toBeGreaterThan(0)
    expect(activityRuntime.unsecuredProceeds).toBe(amount)
    expect(getStoreState(STORE).registerEmptied).toBe(true)
    expect(getStoreState(STORE).robberyCount).toBeGreaterThan(0)
    expect(getStoreState(STORE).cooldownReadyAtGameHours).toBe(100 + 24)
    expect(activityRuntime.active).toBeNull()
    // Second loot (no active) is a no-op — no duplicate cash.
    expect(lootRegister(ctx())).toBe(0)
    expect(activityRuntime.unsecuredProceeds).toBe(amount)
    expect(emitted.filter((e) => e.type === 'register_looted')).toHaveLength(1)
  })

  it('cannot loot when the cashier did not comply', () => {
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'refuse')
    beginRobbery(STORE, ctx())
    expect(lootRegister(ctx())).toBe(0)
    expect(activityRuntime.unsecuredProceeds).toBe(0)
  })
})

// ---- Engine: alarm --------------------------------------------------------

describe('robbery engine — alarm', () => {
  it('silent alarm arms on threat and reports once at its time (idempotent)', () => {
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'comply')
    const report = vi.fn()
    const c = ctx({ gameTime: 1000, reportCrime: report })
    beginRobbery(STORE, c)
    expect(activityRuntime.active?.alarmReportsAtGameTime).toBe(1000 + 12)
    tickAlarm(ctx({ gameTime: 1005, reportCrime: report })) // before → no fire
    expect(report).not.toHaveBeenCalled()
    tickAlarm(ctx({ gameTime: 1012, reportCrime: report })) // at → fire once
    tickAlarm(ctx({ gameTime: 1020, reportCrime: report }))
    fireAlarm(ctx({ reportCrime: report }))
    expect(report).toHaveBeenCalledTimes(1)
    expect(emitted.filter((e) => e.type === 'alarm_triggered')).toHaveLength(1)
  })

  it('kiosk (alarm policy none) never arms a silent alarm', () => {
    getStoreState(KIOSK).robberyCount = ordinalFor(KIOSK, 'comply')
    beginRobbery(KIOSK, ctx())
    expect(activityRuntime.active?.alarmReportsAtGameTime).toBeNull()
  })
})

// ---- Engine: abandon / secure / lose -------------------------------------

describe('robbery engine — proceeds', () => {
  function lootStore(gameHours = 100): number {
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'comply')
    beginRobbery(STORE, ctx({ gameHours }))
    return lootRegister(ctx({ gameHours }))
  }

  it('abandon before loot resolves with no cash', () => {
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'refuse')
    beginRobbery(STORE, ctx())
    abandonRobbery(ctx())
    expect(activityRuntime.active).toBeNull()
    expect(activityRuntime.result?.outcome).toBe('abandoned')
    expect(activityRuntime.unsecuredProceeds).toBe(0)
  })

  it('securing converts once, only at wanted 0 + out of combat', () => {
    const amount = lootStore()
    const applyMoney = vi.fn()
    // Wanted > 0 → refused.
    expect(secureProceeds(ctx({ wantedLevel: 2, applyMoney }))).toBe(0)
    // In combat → refused.
    expect(secureProceeds(ctx({ outOfCombat: false, applyMoney }))).toBe(0)
    expect(activityRuntime.unsecuredProceeds).toBe(amount)
    // Clear + calm → converts once.
    expect(secureProceeds(ctx({ applyMoney }))).toBe(amount)
    expect(applyMoney).toHaveBeenCalledWith(amount)
    expect(activityRuntime.unsecuredProceeds).toBe(0)
    // Repeat → nothing.
    expect(secureProceeds(ctx({ applyMoney }))).toBe(0)
    expect(applyMoney).toHaveBeenCalledTimes(1)
    expect(emitted.filter((e) => e.type === 'proceeds_secured')).toHaveLength(1)
  })

  it('arrest loses unsecured proceeds exactly once and never as money', () => {
    const amount = lootStore()
    const applyMoney = vi.fn()
    const lost = loseProceeds('arrested', ctx({ applyMoney }))
    expect(lost).toBe(amount)
    expect(activityRuntime.unsecuredProceeds).toBe(0)
    expect(applyMoney).not.toHaveBeenCalled() // proceeds were never money
    expect(loseProceeds('arrested', ctx())).toBe(0) // idempotent
    expect(emitted.filter((e) => e.type === 'proceeds_lost')).toHaveLength(1)
  })
})

// ---- Persistence ----------------------------------------------------------

describe('persistence', () => {
  it('persists store cooldowns/counts + secure receipts, drops transient + unsecured', () => {
    getStoreState(STORE).robberyCount = ordinalFor(STORE, 'comply')
    beginRobbery(STORE, ctx({ gameHours: 50 }))
    lootRegister(ctx({ gameHours: 50 }))
    secureProceeds(ctx({ gameHours: 50 }))
    const data = serializeActivities()
    expect(isValidActivitySave(data)).toBe(true)
    const store = data.stores.find((s) => s.storeId === STORE)!
    expect(store.registerEmptied).toBe(true)
    expect(store.cooldownReadyAtGameHours).toBe(50 + 24)
    expect(data.secureReceipts.length).toBe(1)

    // Reload into a dirty runtime: transient cleared, stores restored.
    activityRuntime.unsecuredProceeds = 999
    activityRuntime.active = { activityId: STORE } as never
    applyActivitySave(data)
    expect(activityRuntime.unsecuredProceeds).toBe(0)
    expect(activityRuntime.active).toBeNull()
    expect(getStoreState(STORE).cooldownReadyAtGameHours).toBe(74)
    expect(getStoreState(STORE).registerEmptied).toBe(true)
  })

  it('old save (undefined) loads fresh stores; malformed rejected', () => {
    applyActivitySave(undefined)
    expect(getStoreState(STORE).registerEmptied).toBe(false)
    expect(isValidActivitySave({ version: 1, stores: [{ storeId: 5 }] })).toBe(false)
    expect(isValidActivitySave({ version: 2, stores: [] })).toBe(false)
    expect(isValidActivitySave({ version: 1, stores: [], attemptSeq: -1 })).toBe(false)
  })
})
