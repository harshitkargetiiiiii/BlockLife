# Store Robbery & Criminal Activities

**Status:** v1 shipped. Two robbable locations on one reusable subsystem, plus
the Corner Take mission wrapper.
**Code:** [`src/game/criminalActivities/`](../src/game/criminalActivities/) ·
interiors in [`src/game/interiors/`](../src/game/interiors/) · UI in
[`src/app/RobberyHUD.tsx`](../src/app/RobberyHUD.tsx).

A spontaneous-robbery loop built ON TOP of the existing crime / witness / wanted
/ police / firearm / economy / interior / streaming stacks — it never
reimplements them. It owns the store/cashier/robbery state machines, deterministic
loot, and unsecured criminal proceeds; it *reports* crimes through the crime
runtime and *emits* typed activity events a mission can OBSERVE.

## 1. The loop

Enter a store → cover the cashier (handgun drawn, aim held, in range, with line
of sight) → the cashier deterministically complies / flees / refuses, and per the
store's alarm policy a silent alarm may arm → empty the register (deterministic
loot → **unsecured proceeds**) → escape the police and lose the wanted level →
secure the proceeds at the fixer (wanted 0, out of combat) for clean money. Get
arrested or downed and you lose the unsecured cash.

## 2. Architecture (invariant-aligned)

```
  authored data                 engine (generic)              world
 ┌────────────────────┐      ┌──────────────────────┐   ┌────────────────┐
 │ activityDefinitions│─────▶│ robberyEngine        │◀──│ ActivityDirector│
 │ interiorRegistry   │      │  · beginRobbery      │   │ (per-frame:     │
 └────────────────────┘      │  · lootRegister      │   │  threat + alarm)│
                             │  · secure/lose       │   └────────────────┘
                             └──────────┬───────────┘            ▲
                                        │ mutates          activityBridge
                                        ▼                  (crime + money +
                             ┌──────────────────────┐       UI + mission)
                             │ activityRuntime      │
                             │ (module singleton)   │──▶ useGameStore.activityView
                             └──────────────────────┘     RobberyHUD, markers
```

- **Module-singleton runtime** ([`activityRuntime.ts`](../src/game/criminalActivities/activityRuntime.ts)) — ids + scalars + receipts only, never scene objects, so it survives interior/sector streaming. A bounded `activityView` is mirrored into zustand at ~4 Hz by the director (no per-frame React writes).
- **Immutable definitions, stable ids** ([`activityDefinitions.ts`](../src/game/criminalActivities/activityDefinitions.ts)) — `sectorId` derived from the entrance, never hand-typed.
- **Pure engine** ([`robberyEngine.ts`](../src/game/criminalActivities/robberyEngine.ts)) — a reducer over the runtime with injected context; unit-tested with no browser/store/physics.
- **Seeded determinism** ([`robberyLogic.ts`](../src/game/criminalActivities/robberyLogic.ts)) — `createRng(hashString(key))`; the cashier decision and loot amount are fixed by identity, never `Math.random`.
- **Real clamped delta** — the director accumulates sustained-aim threat and advances the alarm with `Math.min(rawDt, 0.05)`.
- **No wanted mutation / no police spawning from robbery code** — the alarm calls `activityBridge.reportCrime`, which emits an `armed_robbery` crime and files a deterministic cashier report; the existing witness/wanted/dispatch stack takes it from there.

## 3. The two locations (data)

| | Main St Convenience | Waterfront Kiosk |
|---|---|---|
| id | `robbery_mainst_store` | `robbery_waterfront_kiosk` |
| interior | `store_mainst` | `store_kiosk` (open booth) |
| payout | $120–$260 | $40–$100 |
| alarm | silent, 12 s delay | none (organic witnesses only) |
| cooldown | 24 game hours | 12 game hours |
| LOS blockers | one shelf aisle | none |

Both run the *same* engine — the kiosk is not a second state machine, only a
different `RobberyActivityDefinition`.

## 4. Threat detection (normal gameplay)

`ActivityDirector` starts a robbery only when, inside a store, the player: has the
handgun **drawn**, **aims** within the cashier's cone (`aimDotMin`), is in
**range**, and has **line of sight** (segment vs. authored shelf rects), sustained
for `holdSeconds`. A holstered weapon, standing outside, a blocked line, or a
single dropped frame never triggers it (the threat meter decays when you look
away). E2E covers each negative.

## 5. Cashier, register, proceeds — exactly once

- **Cashier decision** is seeded on `(store, attempt ordinal)`: mostly comply, sometimes flee, rarely refuse. The alarm is *separate* (policy-driven) so a cashier can comply while a silent alarm ticks.
- **Register** pays once per attempt (a `LootReceipt` keyed by `attemptId` plus a phase guard). Repeated interaction, remount, or reload can't duplicate the cash.
- **Unsecured proceeds** are NOT money — they're shown in the HUD and only convert to `stats.money` at the fixer, once (`SecureReceipt`; the balance is zeroed). Arrest/incapacitation loses them exactly once (`proceeds_lost`), never as money.

## 6. Store lifecycle & the anti-exploit

A looted or alarmed store sets `cooldownReadyAtGameHours` and `registerEmptied` —
robbery is refused until the game clock passes it. Cooldowns are in-game hours
(survive streaming/save, advance through sleep, freeze on pause).

**Police do not enter interiors in v1** — they respond to the exterior entrance.
So the store must not become a pursuit reset: `CrimeDirector` treats
`location === 'store'` as active police LOS, which **blocks wanted decay** while
you're inside. Ducking in never melts a chase. (The robbery code itself never
touches wanted — this lives in the crime director, the wanted authority.)

## 7. Corner Take (mission wraps, doesn't own)

[`missionDefinitions.ts`](../src/game/missions/missionDefinitions.ts) `corner_take`
is a normal mission with two OBSERVE-only objectives: `rob_store` (completes when
the marked store's `register_looted` event carries ≥ the minimum take) and
`secure_proceeds` (completes on `proceeds_secured`). Activity events reach the
mission engine via a typed `activity_event` mission event. The mission selects the
target, shows markers, enforces the minimum, and pays a **$150 bonus** — it never
opens the register, forces compliance, creates cash, triggers alarms, sets wanted,
spawns police, secures proceeds, or bypasses cooldowns.

## 8. Interior registry (generalised just enough)

[`interiorRegistry.ts`](../src/game/interiors/interiorRegistry.ts) turns the
apartment-only model into a small registry (apartment + two stores). Every
interior is a self-contained room parked far off-grid, always mounted, entered by
a teleport-coordinated `enterInterior` / `exitInterior`. Old saves are
unaffected: the apartment entry reuses the original constants and `location` still
defaults to `'city'`. Weather is disabled indoors (interiors sit outside
`CITY_BOUNDS`, as before).

## 9. Save / load policy

Saving is **blocked** during an active robbery, while carrying unsecured
proceeds, during a wanted pursuit, and while a save-blocking mission is active.
**Persisted:** per-store cooldowns, robbery counts, register-emptied flags, secure
receipts ([`activityPersistence.ts`](../src/game/criminalActivities/activityPersistence.ts)).
**Never persisted:** an active robbery, cashier panic, alarm timers, or unsecured
proceeds. Loading reconstructs no partial loot and duplicates no proceeds; old
saves lack the field and load with fresh stores.

## 10. Test API (DEV-only)

All under `window.GAME_TEST_API`, `import.meta.env.DEV`-guarded, grep to **0** in
`dist/`: `getRobberyDefinitions`, `getActivityState`, `getStoreRobberyState`,
`getActivityValidation`, `getRobberyLoot`, `enterInterior`, `exitInterior`,
`forceBeginRobbery`, `lootStoreRegister`, `secureRobberyProceeds`,
`setPlayerHeading`, `resetActivities`, `setActivityDebug`. Both robberies are
completable through **normal gameplay** without them.

## 11. Coverage

- Unit: 18 in [`robberyEngine.test.ts`](../src/game/criminalActivities/robberyEngine.test.ts) (definitions/validation, seeded cashier + loot + LOS, begin/loot-once/alarm-idempotent/abandon/secure-gated/lose-once, persistence) + 2 Corner Take tests in `missionEngine.test.ts`.
- E2E: 11 in [`tests/e2e/store-robbery.spec.ts`](../tests/e2e/store-robbery.spec.ts) — full loop, holstered/outside/blocked-LOS negatives, pay-once, arrest loss, cooldown, anti-exploit, kiosk reuse, Corner Take, save-block.
- Soak: [`tests/e2e/robbery-soak.spec.ts`](../tests/e2e/robbery-soak.spec.ts) — 180 s, repeated cycles + sector cycling.
- Visual: 5 baselines in [`tests/visual/robbery-visuals.spec.ts`](../tests/visual/robbery-visuals.spec.ts).

## 12. v1 limitations

- Police contain the exterior; they do not enter store interiors (decay-suppression is the anti-exploit).
- The cashier "flee" is a pose + duck, not a routed escape to an anchor.
- One robbery active at a time.
- Escape-to-fixer driving in E2E is stood in with `clearWanted` + the secure interaction (the securing gates still run for real).
