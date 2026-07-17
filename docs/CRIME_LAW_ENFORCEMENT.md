# Crime & Law Enforcement Gameplay v1 — Architecture

This is the design contract for BlockLife's crime/law-enforcement vertical
slice. It is built as a set of **module-singleton runtimes** layered over
the existing simulation — never per-frame React state, never `Math.random`,
never all-pairs scans. Everything reuses the systems already proven this
year: the road graph, routed traffic, the pedestrian graph, sector
streaming, the pause-snap determinism, and the dev-only test API.

## Verified baseline (2026-07-15, before any change)

- Vite + React 19 + TS, three.js/R3F, rapier, zustand.
- 122 E2E (21 files), 63 visual baselines (10 files), ~559 unit — Node
  pinned v23.3.0; `dist/` free of `GAME_TEST_API`.
- Existing reusable systems (audited): `registry` (per-frame runtime
  singleton — player/vehicle bodies + positions, npc/ambient-car position
  maps, flags), `useGameStore` (`mode: walking|driving`, `stats`, enter/
  exitVehicle, teleport coordinator, save/load, `worldPaused`/`pauseSeq`),
  `VehicleController` (arcade physics, single driven car
  `vehicle_compact_car_01`, footprint anti-phase), `PlayerController`
  (on-foot movement + soft-wall vs cars/people), `trafficRuntime`
  (cars/pedestrians maps + global signal clock), the intersection +
  walk-crossing registries, the pedestrian graph + destination trips,
  `collectSolidFootprints`/`getRoadRects`/water rects (LOS + spawn
  validation), sector streaming + floor colliders + teleport coordinator,
  deterministic `createRng(hashString())`.
- **Net-new** (no prior module): health/damage, firearm, crime events,
  witnesses, wanted, police dispatch + AI, NPC panic reactions.

## Ownership boundaries (one connected model, separate modules)

Each system is a module with a narrow interface. No system independently
decides "the player is criminal" — they all emit into, or read from, the
central runtimes. All the GLOBAL runtimes survive sector streaming (they
hold ids + positions, never scene objects).

| Module (global runtime) | Owns | Reads |
| --- | --- | --- |
| `crime/crimeRuntime` | crime event registry (bounded ring), stable ids, dedup/cooldown, sector tagging | game clock, positions |
| `crime/witnessSystem` | per-frame-BUDGETED witness evaluation for OPEN events only; seeded NPC personality | citizen positions, building LOS, weather, time |
| `crime/reportingSystem` | report merge → incident, dispatch trigger | crime events, witness state |
| `wanted/wantedRuntime` | heat, level 0–3, status machine, last-known pos/time, active incident ids, decay | reports, police sightings |
| `police/dispatchDirector` | whether/where/how many to spawn, validated anchors, unit caps, escalation, disengage | wanted state, road graph spawn anchors, streaming |
| `police/policeRuntime` | police unit registry (ids, state, target, health), pursuit identity across streaming | wanted, suspect last-known, graphs |
| `combat/damageRuntime` | central damage events → health mutation on player/citizen/police | weapon hits, vehicle impacts |
| `combat/weaponRuntime` | equipped weapon, magazine/reserve, cooldown/reload timers, hitscan + LOS | camera aim, solid footprints |
| `combat/healthState` | authoritative health for player (store) + citizen/police (their runtimes) | damage events |
| `vehicles/vehicleCrimeState` | per-vehicle access state + stolen/owner record + vehicle health | theft actions, collisions |

Sector-OWNED (mount/unmount with their sector, never duplicated): police
visuals + colliders, muzzle-flash meshes, transient impact decals, the
local citizen actors that render witness/panic poses.

## Crime event model

```ts
type CrimeType =
  | 'vehicle_theft' | 'occupied_vehicle_theft' | 'assault'
  | 'weapon_discharge' | 'reckless_driving' | 'vehicle_collision'
  | 'hit_and_run' | 'attacking_police' | 'civilian_injury' | 'police_injury'

interface CrimeEvent {
  id: string                 // `crime_${seq}` — deterministic, monotonic
  type: CrimeType
  position: Vec3
  sectorId: SectorId
  gameTime: number
  severity: number           // table-driven per type
  noiseRadius: number        // heard-without-LOS radius (gunshots large)
  visibleRadius: number      // seen-with-LOS radius
  suspectEntityId: string
  victimEntityId?: string; vehicleId?: string; weaponId?: string
  witnessedBy: string[]; reportedBy?: string
  status: 'unseen' | 'witnessed' | 'reported' | 'expired'
}
```

Emission is **debounced**: a `(type, suspect, victim/vehicle)` key within a
cooldown window (e.g. 1.5 s for collisions, 0.4 s for gunfire) collapses to
one event — one impact/frame never spawns duplicates, and gunfire is
rate-limited so "every bullet" cannot ratchet wanted. The registry is a
bounded ring (last N events); expired events drop out. Deterministic
ordering by monotonic seq. Save policy: crime events are **transient** (not
persisted; cleared on load).

## Witness & reporting

Witness evaluation is **event-driven and budgeted**, never all-NPCs ×
all-frames. When a crime event is OPEN (`unseen`/`witnessed`), only
citizens within `max(visibleRadius, noiseRadius)` of it — resolved by a
coarse sector/cell filter — are evaluated, a few per frame round-robin.

A citizen witnesses when: within `visibleRadius`, has building-unobstructed
LOS (reuse the AABB ray test used by the visibility system), and is a
capable actor (not dormant, not incapacitated, not deep inside a building);
OR within `noiseRadius` for a `weapon_discharge` (heard, no LOS needed).
Rain/night shrink `visibleRadius`; a crime committed from *inside* a vehicle
is harder to witness.

```ts
type WitnessState = 'unaware'|'noticed'|'startled'|'fleeing'
                  | 'reporting'|'reported'|'hiding'|'resuming'
```

Reporting: after a seeded reaction delay a capable, surviving witness
reports; many flee first (and some report only after reaching safety); not
everyone reports. Personality is seeded and STABLE per npc
(`createRng(hashString(npcId+':witness'))` → courage, reportProbability,
panicThreshold, fleeDistance, curiosity). Multiple reports **merge** into
the existing incident (no dispatch explosion). A police unit that directly
sees a crime reports instantly. Named quest NPCs may panic transiently but
must return to their quest/safe state (Coffee for Ravi stays completable).

## Wanted

```ts
interface WantedState {
  heat: number; level: 0|1|2|3
  status: 'clear'|'reported'|'pursuit'|'searching'|'cooling'
  lastKnownPosition?: Vec3; lastSeenTime?: number
  activeIncidentIds: string[]
}
```

Heat rises from **reported** crimes (unseen crimes do not immediately raise
wanted); repeated minor crimes stack with diminishing returns and a cap;
attacking responding police escalates the SAME incident to level 3.
Thresholds (tunable): L1 ≥ 1 report of theft/minor assault/reckless; L2 ≥
weapon discharge / fleeing police / severe civilian injury / repeated
crime; L3 = attacking police / repeated gunfire / serious violence.
Transitions: `reported → responding → pursuit → searching → cooling →
clear`. Wanted **cannot** clear by crossing a sector boundary; the runtime
is global and survives streaming; decay only runs while no officer has LOS
and no fresh report exists, on an explicit timer that lengthens with level.
Architected for L4/L5 (not implemented).

## Police dispatch + AI

Dispatch chooses count/vehicle-vs-foot/spawn from **validated** anchors:
road-graph spawn points, sector edges, or off-camera road segments — never
beside the player, never inside a car/building/water/prop/pedestrian, never
visibly on-camera when avoidable. Caps: L1 = 1 vehicle/≤2 officers, L2 = 2/
≤4, L3 = 3/≤6. Police vehicles enter the global road graph and route with an
**emergency policy** layered over the existing router (ignore ambient
destinations, target the suspect's last-known segment); response sectors are
prewarmed; dormant units keep incident association.

```ts
type PoliceState = 'patrolling'|'responding'|'investigating'
  |'ordering_stop'|'pursuing_vehicle'|'pursuing_on_foot'|'searching'
  |'attempting_arrest'|'taking_cover_placeholder'|'combat'
  |'returning'|'despawning'
```

Vehicle pursuit follows at a safe distance through the graph (no teleport,
no constant ramming, recovers from blocks, transitions to foot when the
player exits). Foot pursuit uses the existing pedestrian graph / sidewalk
corridors / bounded direct pursuit with obstacle checks (no new navmesh),
legal crossings where practical, streaming-safe. Arrest: approach → short
surrender window → arrest in range → interrupted if the player flees/
attacks. Combat (bounded, readable, imperfect accuracy via reaction delay +
range + cooldown + LOS) triggers only when the player aims/fires at police,
causes severe violence, or L3 armed response is required.

**Implemented in v1 (M4).** `dispatchDirector` reconciles the active vehicle
fleet to the current level's cap every tick — spawning at validated,
off-camera road anchors near the suspect's last-known position and despawning
the furthest units as wanted decays (whole fleet drains when it clears).
`policeAI.stepPoliceUnit` is a pure, unit-tested state machine driving bounded
direct pursuit (`responding` → `pursuing_vehicle`/`pursuing_on_foot` →
`searching` → `attempting_arrest`/`combat` → `returning`), with a shared
`policeAvoidance` resolver that nudges cruisers out of building/prop footprints
(a light substitute for a full navmesh). `policeStep.stepPoliceDirector`
orchestrates dispatch + per-unit AI + wanted line-of-sight relay
(`policeSighting`/`policeLostSight`, feeding `hasPoliceLOS` back into the crime
director's decay) + arrest resolution (records the bust and clears wanted). The
live `PoliceUnits` driver/renderer maps active units onto a fixed pool of navy
cruisers with an animated red/blue light bar; the suspect's speed/vehicle state
comes from the registry each frame. **Deferred to later milestones:** officers
dismounting on foot as separate units, road-graph emergency routing (v1 uses
direct pursuit + solid avoidance), and the full post-arrest consequence flow
(respawn/fine) — M4's arrest clears wanted and drains the fleet.

**Road-graph pursuit (hardening sprint M3).** A pursuing cruiser now drives
ON the road network instead of straight through blocks. It reuses the ONE
global road graph and the deterministic A* planner via a new
[`planRouteToSegment`](../src/game/traffic/routing/routePlanner.ts) (route to an
arbitrary segment, not just a named destination) and a
[`nearestRoadSegment`](../src/game/traffic/routing/roadProjection.ts) projector
(find the suspect's / cruiser's live segment).
[`policeRoute`](../src/game/police/policeRoute.ts) plans an **emergency** route
(zero congestion cost) toward the suspect's road position and feeds the next
route waypoint into the AI as its steer target — so `pursuing_vehicle`,
`respond_to_incident`, `intercept_suspect` and `follow_last_known_route` modes
follow the road. Replanning is **bounded** (a 1.5 s cadence, target drift, or a
graph-version change — never per frame). Direct pursuit + solid avoidance
remains the tightly-scoped fallback for close-range containment (< 14 u) and
off-road origins/targets. Routes clear on despawn/reset (no leak). Verified by
unit tests (projection, segment planning, route follow/replan) + E2E
(`crime.spec.ts` 13 — cruisers keep `getNearestRoadDistance < 12` and plan real
routes). **Deferred:** true predicted-intercept lookahead (v1 routes to the
suspect's current segment, re-planned frequently) and signal/junction holds
(police run emergency priority).

**Dismounted officers (hardening sprint M4).** A cruiser that has closed on an
**on-foot** suspect now puts a real, separate **officer** actor on the street —
not a decal. Officers are first-class `PoliceUnit`s of `kind: 'officer'` with
their own id, position, health, weapon (return fire in combat), AI state, and a
`cruiserId` link back to the car they exited. The decision is a pure, tested
function [`planDismounts`](../src/game/police/policeDismount.ts): one officer
per cruiser, only within `POLICE_DISMOUNT_RANGE` (20 u) of an on-foot suspect,
bounded by the wanted level's officer cap (`POLICE_CAPS[level].officers`), and
never twice from the same cruiser. The live driver
([`PoliceUnits.tsx`](../src/game/police/PoliceUnits.tsx)) supplies a validated
curbside exit — `cruiserExit` (side-of-vehicle geometry) pushed out of solids by
the existing `avoidSolids` — so an officer never spawns inside a wall. Officers
always pursue **on foot** (`onFoot: true` forces foot speed/state in
[`policeAI`](../src/game/police/policeAI.ts), so a fleeing car outpaces them and
they drop to searching, as intended); road-graph routing stays vehicle-only.
**Lifecycle:** the dispatch reconcile-down counts **vehicles only** against the
cap; when a cruiser despawns (level drop or wanted clear) it takes its officers
with it (`despawnPoliceUnit` removes linked officers), so officers never
outlive their car and the fleet fully drains at level 0. Officers render from a
fixed mesh pool (navy uniform + high-vis vest + cap) mapped from unit positions,
paused-safe like the cruisers. Verified by unit tests (`policeDismount.test.ts`
decision + exit geometry; `policeStep.test.ts` director dismount/one-per-cruiser/
lifecycle), E2E (`crime.spec.ts` 14 — a closing cruiser puts a linked on-foot
officer at a road-clear exit; 15 — one officer per cruiser, capped, drained with
the fleet on wanted-clear), and a visual baseline (`crime-police-dismount.png`).
**Deferred:** officer cover/formation behaviour (`taking_cover_placeholder` is
reserved, not driven) and re-boarding a cruiser.

## Vehicle theft + driving

```ts
type VehicleAccessState =
  'public'|'owned_by_player'|'civilian_parked'|'civilian_occupied'
  |'police'|'locked'
```

Parked theft: short interaction → temporary player control → theft crime →
nearby witnesses may react; prior ownership recorded. Occupied theft:
carjack sequence (driver exits via non-graphic state) → owner reacts (flee/
shout/report) → higher severity → control only after the sequence completes;
cancels on invalid physics. Exit picks a safe point (reuse
`findClearExitPosition`, try alternate sides, deny if none) and pursuit
transitions vehicle→foot correctly; stolen state stays attached across
streaming. Driving audits/extends the existing arcade `VehicleController`
(accel/brake/reverse/speed-scaled steering/drag/collision) with vehicle
health: impact damage scales with relative speed, repeated heavy impacts
disable the car (lose accel), optional light smoke — no deformation.
Reckless-driving crimes fire only past speed/impact thresholds with
cooldowns (never tiny bumps).

**Occupied carjacking (hardening sprint M2).** Two authored `civilian_occupied`
vehicles ([`STEALABLE_VEHICLES`](../src/game/vehicles/vehicleCrimeState.ts)) sit
in traffic with a seated driver (rendered by `ParkedVehicles` with
`showDriver`). Carjacking one runs the full live sequence in `stealVehicle`: the
seated driver is **ejected exactly once** (idempotent `ejectDriver`) to a
validated safe exit (reusing `findClearExitPosition`), becomes a real fleeing
pedestrian actor ([`ejectedDriverRuntime`](../src/game/vehicles/ejectedDriverRuntime.ts)
— registered in `npcPositions`/`movingPersonIds`, flees the car avoiding solids,
despawns after ~9 s), and immediately **reports** the crime (`fileReport` → the
owner reaction that raises wanted deterministically). Only then does control
transfer (mode → driving). It emits the higher-severity `occupied_vehicle_theft`
crime, marks the occupant gone (`getVehicleOccupant` → null), and is safely
guarded: a second carjack of the same car is refused (no duplicate driver), and
it won't fire while the player is incapacitated. All runtimes are global
(streaming-safe); `resetCrimeSystems` clears ejected drivers. Verified by unit +
E2E (`crime.spec.ts` 8/8b) + two visual baselines.

## Firearm + health/damage

One handgun (`WeaponDefinition`: magazine/fireCooldown/reloadDuration/range/
damage/spreadDegrees/noiseRadius). Actions: equip/holster/aim/fire/reload/
cancel-reload. **Hitscan** with LOS: buildings and solid props block shots
and neither shots nor sightlines cross water/buildings; deterministic spread
(seeded); short-lived shared muzzle-flash effect; no projectile objects, no
per-frame scene traversal, no shared-material mutation. A discharge emits a
noise event + (rate-limited) crime event + hit event + nearby-NPC reaction.
Central `damageRuntime`: `DamageEvent{ source, target, amount, kind:
bullet|vehicle|collision, position, gameTime }` mutates shared health.
Player health in HUD, incapacitates at 0. Citizens can be incapacitated
(stop schedule, **release destination occupancy / queues / bench / route
claims** — the exact leak the destination sprint guards). Police share the
health system; officer injury escalates wanted. No gore/graphics.

**Implemented in v1 (M5).** `weaponRuntime` is a pure state machine (equip/
draw/holster/aim/reload with a fire-rate gate and reserve-fed reloads);
`hitscan` is a ray-vs-actor-circle test with `firstBlockerAlong` stopping the
shot at buildings/props; `combatSystem.firePlayerWeapon` ties them together —
deterministic seeded spread (tighter while aiming), always emits a
`weapon_discharge` crime + noise, routes hits through the `damageRuntime`
funnel, and escalates (`civilian_injury` for citizens via the witness system;
`attacking_police`/`police_injury` for officers, self-reported → immediate L3).
`healthState` holds citizen/police health (incapacitate at 0); the player's
health lives in the store (HUD-reactive) and is fed through a registered
damage sink. `panicRuntime` marks nearby citizens, and `AmbientCitizens`
sprints them away from the gunshot (nudged out of solids — no wall phasing).
The live `PlayerWeapon` driver reads edge-triggered input (**Space** fire,
**F** draw/holster, **R** reload), auto-aims the nearest actor with clear LOS,
and renders a brief muzzle flash; the HUD shows a health bar, wanted stars and
an ammo readout. **Deferred to M6:** the full incapacitation/arrest recovery
flow (respawn/fine) and citizen-claim release on downing.

## Outcomes: surrender / arrest / incapacitation

Surrender = holster + stop + stay in arrest radius + confirm prompt. Arrest:
disable controls briefly → arrest panel → bounded money penalty → reset
wanted → restore at apartment/safe point → release stolen vehicle → clear
incident → restore health → preserve quests/core save. Incapacitation
(health 0): stop movement → brief incapacitated state → respawn safe → reset
wanted → clear weapon state → bounded penalty. No graphic death.

**Implemented in v1 (M6).** The store's `respawnAfterIncident(kind)` is the one
recovery path for both outcomes: bounded money penalty (arrest $150 /
incapacitation $100, capped at cash on hand), `resetCrimeSystems()` +
`resetCombatSystems()` (clears wanted, police, incidents, stolen-vehicle state,
weapon, panic), restore full health, respawn at the safe spawn — while
inventory, quests and NPC memory are preserved. An arrest fires when the police
director resolves one (the live `PoliceUnits` driver calls it); incapacitation
fires from `RecoveryOverlay`, which watches `playerIncapacitated` and resolves
after a short down-beat. The overlay shows **BUSTED** / **WASTED** and
auto-dismisses. Police **return fire** at an armed L3 suspect they can see
(deterministic, distance-scaled accuracy) — closing the crime→wanted→police→
combat→incapacitation→recovery loop. The phone is blocked mid-pursuit.

## Streaming, save/load, performance

- **Global** (survive streaming): wanted, incident registry, crime history,
  dispatch state, police unit ids, last-known suspect info. **Sector-owned**:
  police visuals/colliders, muzzle flashes, witness/panic actors, impact
  visuals. Police never duplicate after unload/reload; incidents never
  vanish; reports already made stay valid and don't re-fire on remount;
  units keep pursuit identity; distant police use reduced/analytical
  routing but combat is NOT simulated through unloaded sectors;
  rematerialize at validated positions; active-pursuit sectors are
  pinned/prewarmed; the player's current vehicle stays the streaming avatar.
- **Save/load (v1 policy — safety over persistence):** transient =
  crime events, wanted, police units, bullets/hits, panic, active chase,
  witness state, reload timer (all reset on load). Persistent = player
  health (and later owned vehicle/weapon/ammo). **Saving is blocked during
  active wanted/pursuit/combat.** Loading an old save never restores
  transient police incidents; wanted resets on load. Old saves load
  unchanged.
  **Implemented in v1 (M6):** `saveNow` refuses while `getWantedLevel() > 0`
  (toast, no write); `SaveData.playerHealth` is additive/optional (old saves
  load at full health); `applySnapshot` runs `resetCrimeSystems()` +
  `resetCombatSystems()` before restoring, so a load never carries a chase,
  wanted, police or drawn weapon — only health persists.
- **Apartment/wanted policy (hardening sprint M5):** `enterApartment` now
  refuses while `getWantedLevel() > 0` (toast: *"Can't hide at home during a
  police pursuit!"*). The interior is a separate scene the police can't enter,
  so allowing it would trivially end a chase — the block mirrors the existing
  phone block and save block. Exiting is always allowed; wanted is never
  persisted, so a load always starts clean. Verified by E2E (`crime.spec.ts`
  17 — entry blocked at wanted 2, allowed after clear).
- **Quest-NPC panic recovery (hardening sprint M5):** the named residents
  (Ravi, Maya, Officer Kim, …) now flee a gunshot like the ambient crowd, via a
  shared, unit-tested [`panicFleeStep`](../src/game/combat/panicFlee.ts) that
  both the crowd and `NPC.tsx` call. They are added to the fire's **bystanders**
  (panic) list but are deliberately **not** hittable targets, so a crime can
  scatter them but never down them. The **recovery is implicit**: once the
  panic window expires `panicFleeStep` is a no-op and each NPC's routine walks
  it back to its anchor, so quest givers become reachable again on their own —
  **Coffee-for-Ravi stays completable across any crime state** (the quest FSM is
  never touched by a crime). Verified by unit tests (`panicFlee.test.ts` flee +
  self-recovery) and E2E (`crime.spec.ts` 16 — Ravi panics, flees, recovers
  toward his anchor, quest intact).
- **Multi-sector pursuit streaming (hardening sprint M5):** the police runtime
  is a module singleton mounted at the app root (`CanvasRoot`), so a live
  pursuit survives the player crossing sector boundaries — units and wanted
  level persist while sectors stream out/in. Verified by E2E (`crime.spec.ts`
  18 — teleport to a far district, sector changes, police count + wanted
  unchanged).
- **Performance budgets:** bounded active police + bounded crime ring;
  spatial (sector/cell) queries, never all-pairs; witness eval budgeted per
  frame; no pathfinding per frame (plan on events only); no bullet-object
  accumulation; shared weapon effects + materials; police AI tiered by
  distance; debug overlays off by default.

## Test API (dev-only, absent from production)

`emitCrime`, `getCrimeEvents`, `getWantedState`, `setWantedLevel`,
`clearWanted`, `spawnPoliceResponse`, `getPoliceUnits`,
`getPoliceUnitState`, `teleportPoliceUnit`, `setPoliceState`,
`getArrestState`, `setPoliceDebug`,
`givePlayerWeapon`, `drawPlayerWeapon`, `holsterPlayerWeapon`,
`setPlayerAmmo`, `getWeaponState`, `firePlayerWeaponAt`, `setPlayerHealth`,
`getPlayerHealth`, `respawnPlayer`, `getRecoveryState`, `getActorHealth`,
`setActorHealth`, `getDamageEvents`,
`setVehicleHealth`, `getVehicleCrimeState`, `stealVehicle`,
`forceWitnessReport`, `getWitnessState`, `setCrimeDebug`,
`getPoliceRouteState`, `getPoliceRouteMetrics`, `getNearestRoadDistance` (M3),
`getPoliceCruisers`, `getPoliceOfficers`, `getPoliceCounts`,
`forcePoliceDismount` (M4), `isNpcPanicking` (M5) — all guarded by
`import.meta.env.DEV` like the existing API, verified absent from `dist/` in
the honest gate.

## Verification status (v1 + hardening sprint — final gate)

Two honest gates, both **pipefail + count-vs-DEFINED** (expected counts derived
from the spec files, so they can never go stale) **+ a `.only`/`.skip` guard**
so neither a truncated reporter line nor a stray focus marker can hide a
failure:

- **`scripts/crime-gate.sh`** — the crime-scoped gate (tsc, unit, build+dist,
  crime E2E, crime visual ×2, 180s soak).
- **`scripts/hardening-gate.sh`** — the FINAL full-regression gate (Hard M6),
  which runs the ENTIRE BlockLife suite because the hardening work touched
  shared systems. Both are **green**; the hardening gate's confirmed result:

- **tsc --noEmit:** clean.
- **oxlint:** 0 errors, 0 warnings.
- **Unit:** **693 passed / 0 failed** (crime/police/combat add ~120:
  crimeRuntime, wantedRuntime, witnessSystem, reportingSystem, crimeStep,
  vehicleCrimeState, ejectedDriverRuntime, personSeparation, policeAI,
  policeSpawns, dispatchDirector, policeStep, policeRoute, policeDismount,
  roadProjection, weaponRuntime, hitscan, healthState/damageRuntime,
  panicRuntime, panicFlee, combatSystem, plus save health-persistence).
- **Production build:** succeeds; `GAME_TEST_API` and every test-only method
  (incl. `forcePoliceDismount`, `isNpcPanicking`, `firePlayerWeaponAt`) are
  **absent from `dist/`** (grep count 0 — the dev-only API tree-shakes out).
- **Full E2E:** `tests/e2e` — **142 passed / 0 failed / 0 skipped** across all
  23 specs (crime is 19 of them, incl. occupied carjacking, road-graph pursuit,
  dismounted officers, quest-NPC panic recovery, apartment/wanted policy, and
  multi-sector pursuit streaming), and the three long soak tests (crime 180s,
  expansion 150s, traffic-routing 120s). The historical crowd/traffic/citizen
  suites confirm the shared `panicFleeStep` refactor changed no behavior.
- **Visual:** `tests/visual` — **76 baselines passed on two consecutive runs**
  (crime is 13 of them, incl. the new dismounted-officers tableau).
- **Soak:** 180s of continuous pursuit/gunfire/arrest/recovery: police stay ≤
  the L3 cap, the crime ring stays ≤ 64, zero moving person–person overlaps,
  zero page errors, fleet drains at rest.

Real bugs found and fixed across the sprint: (1) `PoliceUnits` hardcoded its
frame delta (`1/60`) instead of the real `useFrame` delta, stalling police
timers under headless frame rates — now clamped real delta; (2) the crime
sprint's `separateWalkerFromPeople` silently deadlocked historical citizen
trips (caught only by the full-regression gate, never the crime-only one) —
fixed to a capped, advisory, moving-vs-moving nudge; (3) the dispatch
reconcile-down counted officers against the vehicle cap, which would have
churn-despawned dismounted officers — now vehicles-only.

## Known limitation — person separation (anti-phasing)

The crime sprint added `separateWalkerFromPeople` (walkers push apart so nobody
walks through anyone). A full-suite audit revealed it was pushing walkers off
their path against STATIONARY people too, which deadlocked the deterministic
waypoint trip system at chokepoints (citizen-destination trips stalled
indefinitely — invisible to the crime-only gate, which never ran those historical
suites). It is now a **capped, advisory nudge scoped to moving-vs-moving**:

- Only pushes a walker away from OTHER MOVING people — never a stationary
  blocker (queuer, sitter, idler, arrived trip citizen), because a radial push
  at a chokepoint the walker must pass fights forward motion and deadlocks
  deterministic waypoint trips indefinitely.
- The TOTAL push per frame is capped BELOW walk speed, so per-neighbour forces
  can't sum unbounded and gridlock a dense crowd — a 7-citizen soak with the
  uncapped version completed **zero** trips.

The result is best-effort visual spacing: two walkers no longer blatantly walk
through each other, while trips always complete. It is NOT a hard non-overlap
guarantee — a dense crowd can still briefly overlap, and a proper crowd-avoidance
layer (RVO/ORCA) is the correct long-term fix (a documented future extension).
Every variant that tried to hard-guarantee non-overlap was proven to either
deadlock trips (radial push vs stationary), oscillate (tangential steer between
two flanking blockers), or gridlock dense crowds (unbounded per-neighbour sum).

## Future extension points (NOT implemented in v1)

More weapons (the `WeaponDefinition` table already generalizes), melee,
stores/robbery (crime types + interaction), security guards / emergency
services (new responder agencies over the dispatch director), gang factions
(faction-tagged NPCs + rivalries), police stations / evidence / reputation,
and multiplayer/server authority (all runtimes are id-keyed and
deterministic — the server owns them per interest region, exactly like the
streaming contract already anticipates).
