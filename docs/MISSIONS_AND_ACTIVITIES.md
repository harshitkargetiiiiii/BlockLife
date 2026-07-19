# Missions & Open-World Activities

**Status:** v1 shipped, extended by later sprints. A reusable framework proven
by a growing catalog of data-only missions.
**Code:** [`src/game/missions/`](../src/game/missions/) · UI in
[`src/app/MissionTracker.tsx`](../src/app/MissionTracker.tsx) and
[`src/app/phone/PhoneMissions.tsx`](../src/app/phone/PhoneMissions.tsx).

The point of this subsystem is **not** the missions that ship with it. It is
that another mission — a race, a robbery, a taxi job, a story beat — should be
addable by writing a `MissionDefinition` and (maybe) an anchor, with no new
engine code. The shipped missions exist to prove that claim across the design
space: lawful, repeatable, on-foot/any-vehicle; criminal, requiring real theft,
a real wanted level, real police, and vehicle delivery; and pure observers that
own none of the systems they react to.

**Catalog** (each is data + observers only; the engine stays generic):

| Mission | Kind | Observes | Home doc |
|---|---|---|---|
| City Courier | lawful courier | pickup/dropoff anchors | this doc |
| Hot Cargo | criminal | exact stolen-vehicle identity, wanted, delivery | this doc |
| Corner Take | criminal | store-robbery events | [CRIMINAL_ACTIVITIES](CRIMINAL_ACTIVITIES.md) |
| Fast Exit | criminal | robbery/getaway-vehicle/wanted/proceeds events | [CRIMINAL_ACTIVITIES](CRIMINAL_ACTIVITIES.md) |
| Shelf Run | lawful supply | a legitimate commerce restock (`store_restocked`) | [PERSONAL_ECONOMY_INVENTORY](PERSONAL_ECONOMY_INVENTORY.md) §8 |

Corner Take, Fast Exit and Shelf Run are documented in full in their home docs
(they belong to those feature stacks); this doc owns the two proof missions and
the framework itself. Shelf Run added one generic objective kind
(`deliver_restock`) and one generic event (`store_restocked`) — not Shelf-Run
special-casing in the engine.

---

## 1. Mental model

```
   authored data                engine (generic)              world
 ┌────────────────────┐      ┌──────────────────────┐    ┌───────────────┐
 │ missionDefinitions │─────▶│ missionEngine        │◀───│ MissionDirector│
 │ missionAnchors     │      │  · startMission      │    │ (per-frame     │
 └────────────────────┘      │  · applyMissionEvent │    │  event source) │
                             │  · cancel/retry      │    └───────────────┘
                             └──────────┬───────────┘             ▲
                                        │ mutates                 │ emits
                                        ▼                    MissionGameEvent
                             ┌──────────────────────┐             │
                             │ missionRuntime       │      ┌──────┴───────┐
                             │ (module singleton)   │      │ store actions│
                             └──────────┬───────────┘      │ crime/police │
                                        │ syncMissionUI    │ vehicles     │
                                        ▼                  └──────────────┘
                             ┌──────────────────────┐
                             │ useGameStore         │──▶ MissionTracker, Phone
                             │  .missionView        │    MissionMarkers
                             └──────────────────────┘
```

Two rules make the whole thing tractable:

1. **The engine never reads the world.** Every world fact it needs arrives
   either in a `MissionGameEvent` or in the injected `MissionEngineContext`
   (`gameHours`, `gameTime`, `wantedLevel`, `resolveTarget`, `applyRewards`,
   `toast`). That is why it unit-tests without a canvas, a store, or rapier.
2. **The engine is the only writer of mission state.** Everything else emits
   events. There is no "just poke `missionRuntime.active` from here" path.

This follows the repo's two-tier state rule: per-frame mission state lives in
the module singleton [`missionRuntime.ts`](../src/game/missions/missionRuntime.ts);
only a small projection (`missionView`) is pushed into zustand, on a 0.25s
cadence, for React to render.

---

## 2. Authoring a mission

A `MissionDefinition` ([`missionTypes.ts`](../src/game/missions/missionTypes.ts))
is a plain object. `city_courier`, trimmed:

```ts
{
  id: 'city_courier',
  title: 'City Courier',
  category: 'delivery',          // delivery | vehicle | crime | story
  offer: { kind: 'phone_job' },  // phone_job | interactable | npc
  reward: { money: 100 },
  cooldownGameHours: 6,
  blockSaveWhenActive: false,
  objectives: [
    { kind: 'interact', interactableId: 'courier_depot', label: 'Pick up the parcels' },
    { kind: 'reach_zone', anchorId: 'courier_waterfront', label: 'Deliver to the Waterfront' },
    { kind: 'reach_zone', anchorId: 'courier_mainstreet', label: 'Deliver to Main St North' },
    { kind: 'return_to_giver', anchorId: 'courier_return', label: 'Return to the job board' },
  ],
  failureRules: [],
}
```

`hot_cargo` uses the same shape and adds nothing to the engine:

```ts
{
  id: 'hot_cargo',
  category: 'crime',
  offer: { kind: 'interactable', interactableId: 'hotcargo_fixer' },
  reward: { money: 280 },
  cooldownGameHours: 20,
  blockSaveWhenActive: true,     // no save-scumming a heist
  objectives: [
    { kind: 'steal_vehicle', selector: {...}, label: 'Steal the marked vehicle' },
    { kind: 'lose_wanted', label: 'Lose the police' },
    { kind: 'drive_vehicle_to_zone', anchorId: 'hotcargo_garage', label: "Drive it to the Fixer's garage" },
    { kind: 'exit_vehicle', label: 'Get out of the vehicle' },
    { kind: 'interact', interactableId: 'hotcargo_fixer', label: 'Hand over the vehicle' },
  ],
  failureRules: [
    { on: 'player_arrested', reason: 'Busted by the police' },
    { on: 'target_vehicle_destroyed', reason: 'The cargo was wrecked' },
  ],
}
```

**The ten objective kinds** — `reach_zone`, `interact`, `collect_item`,
`enter_vehicle`, `steal_vehicle`, `drive_vehicle_to_zone`, `lose_wanted`,
`exit_vehicle`, `deliver_vehicle`, `return_to_giver`. These were not chosen
by taste: each maps 1:1 onto an event the world already emits, so adding a
kind means adding an emit site, not a new subsystem.

Adding a mission is: append to `MISSION_DEFINITIONS`, add anchors if it needs
new places, add the offer interactable if it isn't a phone job. `validateMissions`
(§6) then refuses to let it ship broken.

### Anchors

[`missionAnchors.ts`](../src/game/missions/missionAnchors.ts) holds the five
places v1 uses. Anchors carry a position, a radius, a label, a marker kind —
and a **derived** `sectorId`:

```ts
anchor('courier_waterfront', 'delivery', [2, 0, -304], 5, 'Waterfront Drop')
// sectorId computed via worldToSectorCoord/sectorCoordToId — never hand-typed
```

Hand-typing `sectorId` is how you get an anchor that claims to live in a sector
it isn't in, and then a marker that never streams. Deriving it makes that
class of bug unrepresentable.

---

## 3. Event flow

`MissionGameEvent` is the entire vocabulary between the world and the engine:
`reached_zone`, `interactable_used`, `item_collected`, `vehicle_entered`,
`vehicle_exited`, `vehicle_stolen`, `vehicle_destroyed`, `wanted_changed`,
`player_arrested`, `player_died`, `mission_area_left`.

Emit sites (all funnel through `emitMissionEvent` in
[`missionBridge.ts`](../src/game/missions/missionBridge.ts)):

| Source | Emits |
|---|---|
| [`MissionDirector.tsx`](../src/game/missions/MissionDirector.tsx) | `reached_zone` (0.1s zone checks), `wanted_changed`, `vehicle_entered`/`vehicle_exited` (mode transitions) |
| `useGameStore.interact` | `interactable_used` |
| `useGameStore.stealVehicle` | `vehicle_stolen` |
| `useGameStore.giveItem` | `item_collected` |
| `useGameStore.respawnAfterIncident` | `player_arrested` / `player_died` |
| `useGameStore.enterApartment` | `mission_area_left` |

`applyMissionEvent` is **idempotent by construction**: it advances at most one
objective per call, and a repeated terminal event finds no active mission and
returns. The soak asserts this in the harshest way available — it fires the
courier's final `reached_zone` twice and checks `totalEarned === completions * 100`.

`MissionDirector` follows the repo's per-frame rules: real clamped delta, bounded
work (`ZONE_CHECK_INTERVAL = 0.1`, `UI_INTERVAL = 0.25` — not every frame), and
no throwing. That last one is not paranoia; see §9.

---

## 4. Rewards: paid once, ever

[`missionRewards.ts`](../src/game/missions/missionRewards.ts) uses **receipts**
keyed by `attemptId`. Every `startMission` mints a fresh `attemptId` from
`attemptSeq`. `claimMissionReward` records a receipt and refuses a second claim
for the same attempt.

This is deliberately belt-and-braces on top of idempotent events. Money is the
one thing in this game a player would notice being wrong, and a double-pay from
a duplicated event, a save/load race, or a retry is exactly the kind of bug that
only shows up in the wild. The receipt makes double-pay impossible even if an
event *does* get duplicated.

**Across save/load** (see §7) the receipts *and* the `attemptSeq` counter are
persisted, and a restored active mission is **re-minted a fresh attempt id**. So
reloading a pre-completion save and finishing again is a distinct attempt, no
attempt id is ever reused across sessions, and no reward is ever paid twice.

## 3b. Exact stolen-vehicle identity (Hot Cargo)

A vehicle-delivery job must verify the **exact** boosted target reaches the
drop — not merely "some stolen car". The one drivable car
([`vehicleCrimeState.ts`](../src/game/vehicles/vehicleCrimeState.ts)) records the
`sourceVehicleId` it currently represents (`getPlayerCarSourceId()`), overwritten
on each theft. Two gates use it:

- `drive_vehicle_to_zone` — the `MissionDirector` emits `reached_zone` only when
  `getPlayerCarSourceId() === targetVehicle` (plus in-zone, stopped, wanted 0).
- `deliver_vehicle` — the engine completes the handoff only when
  `ctx.drivenVehicleSourceId === targetVehicle`.

So a boosted **decoy** can never be handed off in place of the target. The
identity is cleared on handoff and every terminal path (the bridge clears it
when a mission resolves while you still drive its target; arrest / incapacitation
/ reset / load clear it via the full vehicle-crime reset).

Complementing this, boosting a *different* car while driving the target emits a
typed **`vehicle_lost`** event (`store.stealVehicle` → `notifyVehicleStolen`),
which the `target_vehicle_lost` failure rule turns into a deterministic fail —
so abandoning the target for a replacement fails the job immediately rather than
leaving it quietly uncompletable.

---

## 5. Availability, cooldowns, and the in-game clock

`getMissionAvailability(id)` → `locked | available | active | cooldown`.

**Cooldowns are measured in in-game hours** (`stats.day * 24 + stats.hour`), not
the crime system's seconds clock and not wall-clock. A 6-hour courier cooldown
means the player sleeps or lives through six in-game hours — which is the unit
the fiction speaks in. Mixing clocks here would have made the phone's "ready in
4h" text a lie.

Missions must be **discovered** before they appear on the phone
(`discoverMission`); `hot_cargo` is only discoverable by walking into the Fixer's
garage. The Jobs+ board shows a locked hint rather than nothing, so the player
learns the job exists without being handed it.

---

## 6. Validation

[`missionValidation.ts`](../src/game/missions/missionValidation.ts) takes world
facts by injection and returns a list of problems: anchors inside no sector,
interactable ids that don't exist, objectives referencing unknown anchors,
selectors that can't match, unreachable sectors. It runs in unit tests against
the **real** `SECTOR_DEFINITIONS` and `INTERACTABLE_BY_ID`, and it is exposed at
`GAME_TEST_API.getMissionValidation()` so E2E and the soak assert it stays empty.

This is the guard rail that makes "just author a new mission" safe. A typo'd
anchor id fails a unit test instead of producing a mission that silently can't
be finished.

---

## 7. Save/load

[`missionPersistence.ts`](../src/game/missions/missionPersistence.ts),
`MISSION_SAVE_VERSION = 1`. Persists active mission + objective index + vars +
attemptId, history (completions, totalEarned, lastCompletedGameHours), cooldowns,
discovered set, **reward receipts, and the `attemptSeq` counter**. Every nested
field is rigorously validated (`isValidMissionSave`); a malformed record is
dropped, fail-safe. Old saves that predate receipts/attemptSeq stay valid (both
optional). On load, `attemptSeq` is kept monotonic (max of the saved counter,
any receipt's number, and any restored attempt) and the restored active mission
is **re-minted a fresh attempt id** — so a reload can neither reuse an attempt id
nor re-pay a completed one.

`blockSaveWhenActive` lets a definition opt out of mid-mission saves —
`hot_cargo` does, `city_courier` doesn't. Reasoning: the courier run is
low-stakes and long; blocking saves there would be hostile. The heist has a
wanted level and a fail state worth respecting.

---

## 8. Streaming safety

Mission state stores **ids and positions, never scene objects** — the same rule
the rest of the runtimes follow, for the same reason: a mission must survive its
target vehicle's sector unloading and reloading.

- `MissionMarkers` is a **single global beacon** parented outside sector roots,
  not a per-sector marker. It reads `streamingRuntime.states.get(sector.id)` to
  decide whether the destination is mounted, and renders regardless — a marker
  for an unloaded sector still points you there.
- The soak cycles `s1_-2` (a courier destination) unload→load mid-mission and
  asserts the mission still completes.
- `ownedEntities` is released on every terminal path (complete, fail, cancel).
  Both the soak and the E2E suite assert `ownedEntities === []` after resolution;
  a leaked owned vehicle would mean a car the traffic system can never reclaim.

---

## 9. Gotchas earned the hard way

1. **A throwing `useFrame` freezes the entire R3F loop.** `MissionMarkers` read
   `streamingRuntime.sectors` (the real field is `.states`), threw every frame
   once a mission went active, and silently killed *every other* `useFrame` in
   the game — interaction prompts stuck, teleports not updating. It presented as
   "interaction is broken", nowhere near the actual bug. Diagnosed only via
   `page.on('pageerror')`. Any new per-frame component must be driven in a live
   run with pageerror assertions before you believe it works.
2. **Anchors must be placed by looking at the world, not by reading coordinates.**
   The first courier depot sat *inside* the Nook Offices building; the first
   fixer garage sat 2m from a live traffic lane. Both were plausible numbers.
   Screenshots caught both.
3. **The preview pane is rAF-throttled** — inspect visuals through headless
   Playwright, never the preview.
4. **Cooldowns limit soak iteration count.** The 180s mission soak completes only
   ~1 courier + ~2 hot-cargo attempts, because 6h/20h in-game cooldowns don't
   clear in three real minutes and `setTime` moves the hour, not the day. The
   soak still proves the invariants it asserts; it is not a high-iteration
   fuzzer. If you need one, add a day-skip to the test API.
5. **Never sleep a fixed duration around streaming — wait on the lifecycle.**
   Test 12 used `waitForTimeout(900)` around a forced sector unload/reload. Real
   measured cost: unload **0.9–7.3s** (it waits out an in-flight prewarm load
   plus the 3s `unloadDelayMs`), remount→ready **1.5–4.9s**. Besides blowing the
   budget under load, a too-short sleep would let a slow unload silently *skip*
   the cycle the test exists to prove — a false pass. Wait on
   `getSectorState(id)`, like `tests/e2e/sectors.spec.ts` does.
6. **This suite found a pre-existing streaming bug — don't assume the mission is
   at fault.** Test 12 failed ~1 run in 8 because a sector could wedge in
   `loading` forever after an unload→reload (React identity omitted the sector
   generation; readiness reports were staleness-guarded in only one direction).
   Nothing about it was mission-specific: missions were simply the first thing to
   force-cycle a sector while ambient routed-vehicle prewarm fought back. See
   [LARGE_CITY_FOUNDATION](LARGE_CITY_FOUNDATION.md) and CONVENTIONS gotcha 12b.

---

## 10. Test API (DEV-only)

All under `window.GAME_TEST_API`, all `import.meta.env.DEV`-guarded, all grep to
**0** in `dist/`:

`getMissionDefinitions`, `getMissionState`, `getMissionAvailability`,
`getMissionHistory`, `getMissionCooldownHours`, `getMissionTargetVehicle`,
`setMissionTargetVehicle`, `getMissionValidation`, `startMission`,
`cancelMission`, `retryMission`, `forceMissionEvent`,
`teleportToMissionObjective`, `setMissionDebug`.

Both missions are completable through **normal gameplay** without any of these;
the API exists so tests can reach states quickly, not so the missions depend on it.

---

## 11. Coverage

| Layer | What |
|---|---|
| Unit | 58 in [`missionEngine.test.ts`](../src/game/missions/missionEngine.test.ts) (objectives, idempotency, rewards-once, cooldowns, exact-target handoff, `vehicle_lost`, **Fast Exit** flow, **Shelf Run** flow via the generic `deliver_restock` objective + `store_restocked` event, validation vs. real sector data, persistence: receipts/attemptSeq/re-mint/no-double-pay) + 12 in [`vehicleCrimeState.test.ts`](../src/game/vehicles/vehicleCrimeState.test.ts) (source-id tracking, clear) |
| E2E | 16 in [`tests/e2e/missions.spec.ts`](../tests/e2e/missions.spec.ts) — both missions end-to-end, save/load, cancel/retry, streaming, apartment policy, **a replacement stolen car cannot complete Hot Cargo**, **save/load never duplicates a reward or reuses an attempt id** |
| Soak | [`tests/e2e/mission-soak.spec.ts`](../tests/e2e/mission-soak.spec.ts) — 180s, repeated attempts + sector cycling, asserts no page errors, no double-pay, no stale ownership |
| Visual | 7 baselines in [`tests/visual/mission-visuals.spec.ts`](../tests/visual/mission-visuals.spec.ts) |

---

## 12. Adding mission #3

1. Add anchors to `missionAnchors.ts` if it needs new places (position + radius +
   label; `sectorId` derives itself). **Look at it in a screenshot.**
2. Add the `MissionDefinition` to `missionDefinitions.ts`.
3. If the offer is an interactable, add it to `MISSION_INTERACTABLES` in
   [`src/data/interactables.ts`](../src/data/interactables.ts), deriving its
   position from the anchor.
4. Run `vitest` — `validateMissions` will tell you what you got wrong.
5. Only if you needed a genuinely new objective kind: add it to
   `MissionObjective`, handle it in `applyMissionEvent`, and add the emit site.

Steps 1–4 are data. Step 5 is the exception, and if you hit it often, the kind
vocabulary is wrong and worth revisiting.
