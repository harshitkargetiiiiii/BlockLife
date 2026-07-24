# CLAUDE.md — BlockLife context primer

Condensed orientation for coding agents. Full docs live in [`docs/`](docs/) —
read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) before a nontrivial change.

## What this is
BlockLife — an **original** browser 2.5D life-sandbox game (a low-poly
orthographic city you explore on foot or by car). **Not** GTA/Rockstar IP:
every asset is procedural primitive geometry authored in this repo. ~30k LOC
TypeScript, Vite + React 19 + three.js/R3F + rapier + zustand.

## Environment (do this first)
- Node is pinned to **v23.3.0**. Prefix npm/npx:
  `export PATH=$HOME/.nvm/versions/node/v23.3.0/bin:$PATH && …`
- Ports: dev `:5173`; Playwright dev server `:5199`.
- Scripts: `npm run dev|build|lint|test`, `test:e2e`, `test:visual`.

## The one big idea: two-tier state
- **High-frequency (per frame) → module-singleton runtimes**, mutated in
  `useFrame`, never React state. The hub is
  [`src/game/world/runtimeRegistry.ts`](src/game/world/runtimeRegistry.ts)
  (`registry`: bodies, positions, headings, `npcPositions`, `movingPersonIds`,
  flags). Same pattern for traffic/weather/visibility/character/crime/police/
  combat runtimes. Store **ids + positions + scalars, never scene objects** — so
  they survive sector streaming.
- **UI-reactive → the one zustand store**
  [`src/game/store/useGameStore.ts`](src/game/store/useGameStore.ts), mutated via
  named actions.
- Composition root: [`src/app/CanvasRoot.tsx`](src/app/CanvasRoot.tsx) (global
  systems mount once; static world visuals/colliders mount per streamed sector).

## Where things live
- 27 subsystems under `src/game/*` — see the module map in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#11-module-map).
- Deep dives per subsystem: [`docs/SYSTEMS.md`](docs/SYSTEMS.md).
- Static data: `src/data/` (npcs, quests, interactables). DOM UI: `src/app/`.
- World = 144-unit sector grid (`world/sectors/`); content authored as data via
  the kit (`world/authoring/`). Streaming lifecycle
  `unloaded→loading→warm→active→unloading`.

## Non-negotiable invariants
- **Never commit unless explicitly asked** (branch first if on default branch).
- **No test API in production**: everything on `window.GAME_TEST_API`
  ([`src/game/test/gameTestApi.ts`](src/game/test/gameTestApi.ts)) is
  `import.meta.env.DEV`-guarded and must grep to **0** in `dist/`.
- **Global road graph is immutable** at runtime.
- **No full navmesh** unless repo evidence proves it necessary (avoidance =
  capped, best-effort nudges).
- **Never weaken/skip a test to make it pass**; fix the root cause. No flaky
  tests. Don't raise timeouts without measured justification.
- Determinism: seed RNG (`createRng(hashString(key))`), never `Math.random()` in
  the sim; pause snaps actors to canonical poses (visual tests depend on it).

## Top gotchas (full list in docs/CONVENTIONS.md)
1. Second-based timers must use the **real clamped delta**
   (`useFrame((_, r)=>{const dt=Math.min(r,0.05)})`), never `1/60` — headless
   E2E runs slow and stalls hardcoded-delta timers.
2. Register runtime state in `useEffect` (identity-guarded), never in render /
   `useMemo` (StrictMode double-invokes).
3. After touching a **shared system** (crowd, traffic, person-separation), run
   the **FULL** E2E suite, not just your feature's.
4. **Never run E2E and visual suites concurrently** on `:5199` — contention
   starves timing-sensitive tests into false failures. Run sequentially; re-run
   a suspicious timing failure alone before calling it a regression.
5. Honest gates only: `pipefail`, assert `passed == DEFINED` (counts derived
   from spec files, not hardcoded), `failed==0`, `skipped==0`, guard `.only`.
6. Regenerate visual baselines with `--update-snapshots=all` and **view** the PNG.

## Verification
Order: **`tsc -b --force`** → `oxlint src/` (0 errors) → `vitest run` (0 failed) →
`build` + grep `dist/` for `GAME_TEST_API` (0) → affected E2E (+ full E2E if
shared-system) → visual ×2. Ready-made: `scripts/hardening-gate.sh` (full
regression) and `scripts/crime-gate.sh`.
**`tsc --noEmit` is a no-op here** — the root tsconfig is references-only, so it
compiles 0 files and always passes. Only `-b --force` really typechecks.

## Current state
In progress: **Social Life, Relationships & NPC Memory v1** (issue #13) — a staged,
**deterministic** social platform under [`src/game/social/`](src/game/social/) on
top of the existing NPC/phone/mission/inventory/crime/save stacks (reimplementing
none). Core loop: meet a named NPC → interact → bounded structured **memory** →
multidimensional **relationship** → visible **consequence**. Shipped across 5
slices: (1) the six-actor **registry** (id == world/save NPC id; Ravi
Coffee-compatible), an integer-bounded **relationship** model + derived tiers +
ONE mutation path, a **bounded memory ledger** (dedupe/salience/derived-decay/pins),
the ONE **event pipeline** (exact-once → memory → data-driven effect → unlock),
additive fail-safe **save** slice, DEV observability; (2) a contextual conversation
menu (talk/check-in/**gift**/ask-favor/apologize/threaten) with **anti-farming**
(once-per-NPC-per-day + real-item gifts via the inventory service), deterministic
dialogue templates, first-meeting **contact unlock**; (3) phone **contacts /
messages / invitations** (accept/decline/**suggest-later**) + availability +
**scheduling** + deterministic lazy NPC **outreach** (never per-frame); (4) three
reusable **activity** templates (meet / hangout / delivery-favor) + a HUD tracker +
**Coffee-for-Ravi** feeding the social system; (5) observe-only **consequences** —
crime **witness** reactions (Officer Kim hardest), a friendly Maya's food-truck
**discount**, public-arrest trust dings — plus a bounded **social lifecycle soak**
(200 game-days, whole cast, all bounds hold) and docs. UI re-renders via a
`socialVersion` store counter (the social runtime lives outside zustand). See
[`docs/SOCIAL_RELATIONSHIPS_AND_MEMORY.md`](docs/SOCIAL_RELATIONSHIPS_AND_MEMORY.md).

Prior sprint: **World Integrity & City Certification Platform v1** (issue #6) —
a foundational reliability platform under `src/game/world/integrity/` giving every
runtime entity ONE integrity contract. **Shipped + gated so far** (a staged
migration): a semantic entity **registry** (IDs/scalars only, generation-safe,
mirrors existing runtimes via adapters), a **spatial hash**, **universal person
occupancy** (`occupancy.ts` + live `resolvePersonSpacing` — idle citizens now
separate; **`yieldAroundStationary:false`** keeps waypoint trips deadlock-safe —
CONVENTIONS #16), observe-only **anomaly detection** (`anomalyDetector.ts` +
DEV-only ~4 Hz `IntegritySystem`), **viewport-clamped** speech bubbles
(`WorldAnchoredHtml`/`viewportClamp.ts`), and **occlusion-parity certification**
(`occlusionParity.ts` — corrects finding #11: all render paths already funnel
through `<Occludable>`; now certified + regression-guarded). Fixes screenshot bugs
#1 (crowd phasing), #4 (off-screen bubbles), #5 (district occlusion parity); the
Harbor Cross shuttle-lane **lockstep data defect** was de-conflicted (CONVENTIONS
#17). **Slice 2 (Live Spatial Integrity)** adds the live per-actor clamp
(`personOccupancy.ts` + `liveObstacles.ts`): every citizen + named NPC runs
spacing → on-foot player push, then — for **OFF-path** actors only (idle,
queueing, sitting, frozen, panicking, displaced) — **hard oriented vehicle
push-out** → **mandatory static-solid clamp** (fixes #2 person-on-car, #3
person-in-building). **On-path walkers are skipped**: they already gap-cross via
`decidePedestrian` + `CAR_CLEARANCE` on routes validated clear of solids, and
clamping them every frame both fights their crossings and adds per-citizen CPU
drag that slowed the headless yard-worker commute to a timeout (CONVENTIONS #18).
Also: safe vehicle-exit/respawn via `findClearPlayerSpawn`; police officers
mirrored for detection; ambient cars mirrored with real headings for
vehicle-overlap SAT; and a **traffic stall / honk-loop** diagnosis
(`scanTrafficAnomalies` over `CarRuntime.blockedTime`, which excludes signal/queue
waits) for the intersection-pileup / endless-blocked-honk failure mode.
**Slice 3 (Streaming Safety Ring, issue §6)** extends the transactional
streaming guarantee from teleport-only to ORDINARY walking/driving
(`sectorSafetyRing.ts`): a per-frame **coverage invariant** (the sector under the
subject + the velocity-projected entering sector must be gameplay-ready), a
**soft boundary backstop** wired into the player + vehicle controllers (zeroes
only the crossing velocity component into an un-ready neighbour — the rare
emergency; prewarm normally wins), and a **bounded watchdog self-heal**
(`forceSectorReload`) for a required sector wedged in `loading` (LOADING sectors
only, so the active ground under the player is never unloaded — CONVENTIONS #19).
Produces the `player_outside_coverage` + `sector_stuck_loading` anomalies; DEV
`holdSectorReadiness` injects delayed readiness for the streaming tests.
**Slice 4 (3D Placement & Authoring Integrity, issue §7/§8)** makes floating
props, facade clips, citizens-in-walls and duplicated routes authoring FAILURES
(bug #7): a canonical per-type **visual-bounds** table
([`propPlacement.ts`](src/game/world/propPlacement.ts), SEPARATE from
`PROP_SOLIDITY` collision, transcribed from the `Props.tsx` meshes) + pure
validators ([`placementValidation.ts`](src/game/world/integrity/placementValidation.ts):
base-contact, visual-clip, anchor-clearance, duplicate-citizen, route-corridor,
GLB/fallback parity) + a **whole-city gate**
([`cityPlacement.test.ts`](src/game/world/integrity/cityPlacement.test.ts): every
district validates to 0 defects) + `prop_floating`/`prop_clipping`/`anchor_invalid`
runtime anomalies ([`placementIntegrity.ts`](src/game/world/integrity/placementIntegrity.ts))
+ `getPlacementReport`. Foliage overhang (`canopy` → trunk-checked) + a
wall-abutting AC (`abutsBuilding`) are narrow per-TYPE intents, NEVER per-coordinate
exemptions (CONVENTIONS #20). The authored city was already clean — no data moved,
no baseline churn.
**Slice 5 (District Certification + Automated City Sweeper, issue §11–14)** is the
capstone: a deterministic per-district **certificate**
([`districtCertification.ts`](src/game/world/integrity/districtCertification.ts):
`certifyCity` aggregates occlusion parity + placement + road-graph + presence
checks over the §11 matrix — all 9 districts certify; surfaced in the debug panel
+ `getCityCertification`) and a GENERATED suite
([`citySweep.ts`](src/game/world/integrity/citySweep.ts)) that traverses,
photographs (content-centroid framed), and 300s-soaks the whole city so a new
district is covered automatically. The sweeper **found a real lockstep bug**
(`s1_-1_walkers_0/1` head-on on a shared 2-point path) no hand-authored test
caught → fixed at the COMPILER with parallel walker lanes (CONVENTIONS #21). The
300s soak **found a second real bug**: police pathing through the central plaza
pinned ON-path citizens (`cit_plaza_roamer`/`cit_c_window_shopper`) into
buildings — Slice 2 had skipped BOTH clamps for on-path walkers, but a shove can
drive one into a wall. Fixed in `personOccupancy.ts`: the VEHICLE push-out stays
off-path-only (crossing-safe), but the static-solid clamp is now UNIVERSAL,
guarded so an UNDISTURBED walker still skips the query (commute perf preserved) —
so no citizen, on-path or not, ends a frame embedded in a solid (CONVENTIONS #18,
§7b). **All six phases of issue #6 are now shipped + gated.** The final deferred
item — hard movement CLAMPS for police/interior/ejected-driver actors — is now
CLOSED: police route through `resolvePoliceOccupancy` (shared contract + a
police↔police pass) after their pursuit director, ejected drivers run the hard
clamp after their flee avoid, interior civilians were already `avoidInterior`-clamped;
the 300s soak now asserts zero sustained corruption with **police IN scope** (no
`police_*` filter). The `player` is the sole by-design exception (NPCs yield to it;
the platform never repositions it). See
[`docs/WORLD_INTEGRITY_AND_CERTIFICATION.md`](docs/WORLD_INTEGRITY_AND_CERTIFICATION.md).

Prior sprint: **Personal Economy, Inventory & Shopping v1** — a reusable
life-sandbox commerce loop ON TOP of the existing economy/inventory/store-interior/
robbery/apartment/wardrobe/mission/phone/save/streaming stacks (reimplementing
none). A typed **item catalog** (`src/game/items/`: catalog + pure
`inventoryService` + pure `itemEffects`) where the backpack + apartment storage
stay `Record<itemId,qty>` (the legacy save shape) and capacity = occupied slots
`Σ⌈qty/stackLimit⌉` (backpack 10, storage 40); ONE mutation path (giveItem/buyItem/
useItem/discard/deposit/withdraw + the legacy coffee reducer all funnel through
the service, guarded against overflow). ONE **commerce engine** (`src/game/commerce/`:
store defs reuse the robbery interiors+registers, pure `canPurchase`, module-
singleton `commerceRuntime` with lazy O(1) multi-interval restock reconcile — never
per-frame, never while paused) — the store register opens the **Shop** during
normal play (robbery still takes priority; a store refuses commerce while robbed/
recovering via `storeClosedForCommerce`). Item effects are typed DATA interpreted
by a pure service → a patch the store applies (stats/`setPlayerHealth`/`setAmmo`/
wardrobe unlocks), consuming one only on success. **Shelf Run** (5th, data-only
mission) OBSERVES a legitimate restock via the generic `deliver_restock` objective
+ `store_restocked` event (grants the crate through the normal item path; delivery
restocks once via a receipt). Phone gains a **Bag** page; **Shop**/**Storage-transfer**
panels; wardrobe premium colours (teal/gold) unlock via bought dyes. Save adds
additive `storage`/`wardrobe.unlocked`/`commerce` fields (old `inventory` migrates
via `sanitizeStacks`; malformed data fails safe). Coffee for Ravi is preserved on
the new catalog/path. See [`docs/PERSONAL_ECONOMY_INVENTORY.md`](docs/PERSONAL_ECONOMY_INVENTORY.md).
Gate green: unit **844**, E2E **194/194** (incl. new economy 13-case spec + 180s
economy soak), visual **95/95** ×2, dist clean.
Prior sprint: **Robbery Pursuit & Getaway Polish v1** — a pursuit/getaway layer
ON TOP of the robbery + crime + police + mission + vehicle-identity stacks (never
reimplementing them). Adds: a deterministic **police containment** phase machine
(`src/game/criminalActivities/containmentLogic.ts`: none→responding→contained→
warning→breach) that routes the EXISTING police stack to the store *entrance*
while the player is inside a robbed store with heat — the `ActivityDirector`
advances the phase, `PoliceUnits` overrides `suspectPos` to the entrance and
suppresses arrest LOS while the suspect is unseen inside, and the "breach" is a
fair forced-exit (`store.exitInterior()`) since police can't enter a far-off-grid
interior; **routed store civilians** (`src/game/interiors/interiorCivilians.ts` +
`interiorCivilianLogic.ts`) that REPLACE the old floor-sink duck with seeded
flee-to-exit / hide-in-cover / freeze reactions using best-effort seek + an
interior-aware avoid (no nav stack), recover home after the robbery, and (customer
0 always bolts) raise the alarm as an organic witness after reaching safety — the
kiosk's only report path; **reusable getaway-vehicle support** reusing the exact
stolen-vehicle identity (`steal_vehicle` with `preferParked` → `enter_vehicle` /
`drive_vehicle_to_zone` with `requireClean:false` staging), an `enter_vehicle`
marker+distance to the parked getaway car; and the **Fast Exit** mission (a 4th
data-only mission) that OBSERVES robbery/vehicle/wanted/proceeds events and owns
none of them. HUD adds a containment/breach warning + audio (siren/alert/chime).
Save is blocked through pursuit/containment (wanted>0) + Fast Exit + unsecured
proceeds. See [`docs/CRIMINAL_ACTIVITIES.md`](docs/CRIMINAL_ACTIVITIES.md).
Bug found + fixed this sprint: a `useFrame` that CAPTURES a module-runtime array
in render goes stale after a reset rebuilds it (civilians stepped an orphan while
the UI read a fresh unstepped array) — fetch runtime arrays fresh **inside** the
frame (see CONVENTIONS gotcha #14). Gate green: unit **799**, E2E **180/180**
(incl. new getaway 8-case spec + 180s getaway soak), visual **90/90** ×2, dist clean.
Prior sprint: **Store Robbery & Criminal Activities v1** — a reusable,
data-driven spontaneous-robbery subsystem (`src/game/criminalActivities/`) built
on the crime/wanted/police/firearm/economy/interior stacks. Two robbable locations
(Main St Convenience, Waterfront Kiosk); real threat detection; deterministic
seeded cashier + loot; unsecured proceeds secured at the fixer; and the **Corner
Take** mission that OBSERVES robbery events. Anti-exploit: wanted decay suppressed
while `location==='store'`. Prior sprint: **Mission & Activity Framework v1**
(`src/game/missions/`) — City Courier + Hot Cargo, see [`docs/MISSIONS_AND_ACTIVITIES.md`](docs/MISSIONS_AND_ACTIVITIES.md).
Earlier gate baseline: unit 744, E2E 159/159 (incl. 180s mission soak), visual 83/83 ×2,
dist clean. Repo-hardening pass (2026-07-17) since then: portable gate scripts
(repo root from `$BASH_SOURCE`, `mktemp` logs), exact stolen-vehicle identity for
Hot Cargo (a decoy can't be delivered) + a real `target_vehicle_lost`, mission
persistence hardening (persisted receipts + `attemptSeq`, re-minted attempt ids —
no reward duplication across reload), a GitHub Actions CI workflow, and a README
accuracy pass. A pre-existing sector-streaming wedge (an unload→reload could stick
a sector in `loading` forever) was found and fixed in the mission sprint. Prior:
Crime v1 + hardening —
[`docs/CRIME_LAW_ENFORCEMENT.md`](docs/CRIME_LAW_ENFORCEMENT.md).
