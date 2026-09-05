# BlockLife — Systems Reference (deep dives)

Per-subsystem reference for the systems that don't have a dedicated feature doc.
Read [ARCHITECTURE.md](ARCHITECTURE.md) first for the big picture (two-tier
state, the frame loop, streaming, determinism). The three big feature areas
have their own docs and are only summarized here:

- **World grid + streaming** → [LARGE_CITY_FOUNDATION.md](LARGE_CITY_FOUNDATION.md)
- **Authoring sectors / signals / crossings / destinations / art** → [DISTRICT_AUTHORING_KIT.md](DISTRICT_AUTHORING_KIT.md)
- **Crime / police / combat** → [CRIME_LAW_ENFORCEMENT.md](CRIME_LAW_ENFORCEMENT.md)
- **Missions / jobs / activities** → [MISSIONS_AND_ACTIVITIES.md](MISSIONS_AND_ACTIVITIES.md)

Contents: [Player, Vehicles & Camera](#player-vehicles--camera) ·
[Controls & Input](#controls--input) · [Traffic & Routing](#traffic--routing) ·
[Citizens & Destinations](#citizens--destinations) ·
[NPCs, Dialogue & Quests](#npcs-dialogue--quests) · [Characters](#characters) ·
[Visibility & Occlusion](#visibility--occlusion) · [Weather](#weather) ·
[Simulation](#simulation-time-needs-economy-mood) ·
[Interaction, Quests & Economy](#interaction-quests--economy) ·
[Apartment & Interiors](#apartment--interiors) · [Assets & GLB](#assets--glb-loading) ·
[Save / Load](#save--load) · [Audio](#audio) · [UI Layer](#ui-layer-hud-phone-panels)

---

## Player, Vehicles & Camera

**On foot.** [`player/PlayerController.tsx`](../src/game/player/PlayerController.tsx)
owns a rapier rigid body for the player. Keyboard movement flags
(`registry.flags.running`) drive screen-relative motion at `WALK_SPEED = 4.2` /
`RUN_SPEED = 7.2` ([`player/playerTypes.ts`](../src/game/player/playerTypes.ts));
spawn is `[-11, 1.2, -7]`). The controller writes the authoritative
`registry.playerPosition` and `registry.playerHeading` every frame, applies soft
push-out from ambient cars, and is **disabled** (`body.setEnabled(false)`) while
driving so the car is the follow target.

**Driving.** [`vehicles/Vehicle.tsx`](../src/game/vehicles/Vehicle.tsx) is the
one drivable car (`vehicle_compact_car_01`). `store.enterVehicle()` disables the
player body and sets `mode: 'driving'`; `exitVehicle()` finds a clear exit
position ([`findClearExitPosition`]) beside the car, re-enables the player body,
and hands control back. Speed lives in `registry.flags.drivingSpeed`; the follow
target switches via `getFollowTargetPosition(mode)`.

**Ambient & parked cars.** [`world/AmbientCars.tsx`](../src/game/world/AmbientCars.tsx)
and [`vehicles/ParkedVehicles.tsx`](../src/game/vehicles/ParkedVehicles.tsx)
render decorative/routed traffic and static parked cars; live ambient positions
are published to `registry.ambientCarPositions` for avoidance. Some parked cars
are stealable (`vehicleCrimeState.ts` — see [CRIME](CRIME_LAW_ENFORCEMENT.md)).

**Camera.** [`camera/FollowCamera.tsx`](../src/game/camera/FollowCamera.tsx) — a
fixed-angle **orthographic** camera that smoothly lerps to the follow target
(player or car). Mouse-wheel zoom within clamped limits. The fixed isometric
angle is what makes the analytic occlusion math tractable (see below).

---

## Controls & Input

[`controls/useKeyboardControls.ts`](../src/game/controls/useKeyboardControls.ts)
+ [`app/useActionKeys.ts`](../src/app/useActionKeys.ts). Two hooks, split by
frequency:

- **Movement / driving** — WASD or arrows set `MovementKeys` flags; `Shift`
  runs; `Space` is handbrake; `F` fires / `R` reloads (combat edges). Input is
  swallowed while the phone covers the screen (`isGameplayInputBlocked`).
- **Combat edges** — fire / draw-holster / reload are **edge-triggered**
  (`CombatInput` queue, consumed once by [`PlayerWeapon`](../src/game/combat/PlayerWeapon.tsx)
  then `clearCombatEdges()`), so a held key fires once per press, deterministically.
- **Action keys** — `E` interact, `Esc` close panel, `Tab`/`P` phone,
  `` ` `` (Backquote) toggle debug.

| Input | Action |
| --- | --- |
| WASD / arrows | Walk / drive (screen-relative) |
| Shift | Run |
| E | Interact with nearest interactable |
| F / R | Fire / reload (armed) |
| Space | Handbrake (driving) |
| Tab or P | Phone |
| `` ` `` | Debug panel |
| Esc | Close panel |

---

## Traffic & Routing

The most intricate subsystem after `world`. It moves a mixed fleet of cars and
a crowd of pedestrians over a **global, immutable road graph** with A* routing,
signals, and crossing etiquette. Directory: [`traffic/`](../src/game/traffic/).

**Road graph** ([`traffic/routing/roadGraph*.ts`](../src/game/traffic/routing/)).
Authored lane data (`roadGraphData.ts`) is compiled by `roadGraphBuilder.ts`
into a graph of **lane segments** (each has a `points: Vec2[]` polyline,
`length`, `speedLimit`, connectivity) and validated (`roadGraphValidation.ts`).
`getRoadGraph()` returns the one shared instance; `segmentSectors.ts` maps
segments to sectors for streaming; `roadProjection.ts` finds the nearest segment
to any world point (used by police pursuit and spawn placement).

**Planning** ([`routing/routePlanner.ts`](../src/game/traffic/routing/routePlanner.ts)).
Deterministic **A***: cost = travel time (`length / speedLimit`) + movement
penalties + optional per-segment extra cost (congestion snapshot, blockage
bias). **Runs only on spawn / destination change / replan — never per frame.**
Ties break on segment id → identical inputs give identical routes. Failures are
**typed return values, never throws**. `planRoute(graph, seg, progress, destId)`
routes to a named destination; `planRouteToSegment(...)` (added for police)
routes to an arbitrary segment+progress.

**Runtime & recovery** (`routeRuntime.ts`, `routeProgress.ts`, `routeFollow.ts`,
`routeLifecycle.ts`, `routeRecovery.ts`, `routeSelection.ts`, `congestionSnapshot.ts`).
A car holds a `RoutePlan` (ordered `segmentIds`), tracks progress along the
current segment's polyline, and a **lane-follow adapter** converts that to
steering. Blockages are **classified** (car ahead, occupied crosswalk, red
light, dead end) and drive a **staged recovery** (wait → nudge → replan →
re-select destination), all bounded so nothing thrashes per frame.

**Signals & intersections** (`signalRules.ts`, `intersections/*`). A shared
signal clock plus per-intersection cross-street plans on the **same global
clock** (`trafficRuntime.signal.elapsed`). Vehicles yield on red; the phase is
also read by pedestrian crossings.

**Pedestrian crossings** (`pedestrianRules.ts`, `walkCrossings.ts`,
`crosswalkUtils.ts`). A crossing state machine (`walking_sidewalk` →
`waiting_to_cross` → `crossing`) reads the pedestrian signal, waits for a clear
road, and has a jaywalk failsafe scaled to each intersection's cycle. Cars treat
an occupied crosswalk as a blockage.

**Avoidance** (`trafficAvoidance.ts`, `vehicleObstacles.ts`, `trafficAwareness.ts`,
plus `world/personSeparation.ts`). Best-effort, capped nudges — **not** a full
navmesh (repository policy: don't add one without proven need). See the person-
separation gotcha in [CONVENTIONS.md](CONVENTIONS.md).

Authoring roads/signals/crossings for a new sector: [DISTRICT_AUTHORING_KIT.md](DISTRICT_AUTHORING_KIT.md).

---

## Citizens & Destinations

[`citizens/`](../src/game/citizens/). The ambient crowd — background residents
who live a plausible day. Data-driven (`ambientCitizenData.ts`): each has a body/
head color, walk speed, and a routine. [`AmbientCitizens.tsx`](../src/game/citizens/AmbientCitizens.tsx)
is one big `useFrame` driver over a `Map<id, CitizenRuntime>` module singleton.

- **Destinations & trips** ([`citizens/destinations/`](../src/game/citizens/destinations/))
  — a pedestrian graph + authored anchors (lots, benches, plazas) compiled to
  destinations; citizens run deterministic trips with a trip state machine,
  preserved across streaming/LOD with bounded recovery.
- **Crossing etiquette** — citizens obey the same crossing rules as NPCs (signal
  + clear road + jaywalk failsafe), for both painted central crosswalks and
  signalized-intersection crossings on the one global clock.
- **Panic** — a gunshot marks nearby people; they flee via the shared
  [`combat/panicFlee.ts`](../src/game/combat/panicFlee.ts) `panicFleeStep` and
  **recover on their own** when the window expires (routine resumes). Named
  quest NPCs use the same helper (see [CRIME](CRIME_LAW_ENFORCEMENT.md) M5).
- **Person separation** — moving-vs-moving only, capped below walk speed, so a
  walker is never shoved backward by a stationary blocker. This is a subtle,
  bug-prone area — read the gotcha in [CONVENTIONS.md](CONVENTIONS.md).

`registry.npcPositions` (all live people) and `registry.movingPersonIds` (who's
walking) are the cross-system contract other subsystems read.

---

## NPCs, Dialogue & Quests

**Named residents.** [`npc/`](../src/game/npc/) + data in
[`src/data/npcs.ts`](../src/data/npcs.ts): six named residents (Ravi, Maya,
Coach Bruno, Leo, Officer Kim, Nisha) with hour-based routines (`idle` anchors /
`patrol` loops), ambient lines, and per-NPC memory.
[`NPC.tsx`](../src/game/npc/NPC.tsx) drives each one (routine movement, crossing
etiquette, car/player push-out, person separation, panic-flee, speech bubbles);
[`NPCManager.tsx`](../src/game/npc/NPCManager.tsx) mounts them. Named NPCs are
**not hittable** — a crime scatters them but can't down a quest giver.

**Dialogue.** [`npc/DialogueSystem.ts`](../src/game/npc/DialogueSystem.ts) — a
pure `getDialogue(npc, questStates, …)` + `applyDialogueAction(...)` pair that
returns the right lines and options from quest + memory state (greet, offer
quest, accept, deliver). Driven by the DOM [`DialoguePanel`](../src/app/DialoguePanel.tsx).

**Quests.** [`quests/questMachine.ts`](../src/game/quests/questMachine.ts) — a
tiny FSM: `not_started → active → has_coffee → completed`. The one shipped quest
is **Coffee for Ravi** ([`src/data/quests.ts`](../src/data/quests.ts)): talk to
Ravi → buy coffee from Maya's truck → deliver. Quest states persist in the store
and the save. Invalid transitions return the current state unchanged.

---

## Characters

[`characters/`](../src/game/characters/). The rigged-model pipeline that lets a
player or NPC render as an animated GLB instead of primitive geometry, with a
clean fallback.

- **Manifest** ([`characterManifest.ts`](../src/game/characters/characterManifest.ts))
  — data-driven asset contract. Gameplay refers to **semantic roles**; every
  asset quirk (clip names, forward axis, scale, attachment slots) lives in the
  manifest + adapter, **never in components**.
- **Motion state** ([`characterAnimationState.ts`](../src/game/characters/characterAnimationState.ts))
  — normalizes **intent** from authoritative movement (physics velocity, driving
  flag), never raw keys: a player sliding from physics still animates by real
  speed, and a teleport (position jump, no velocity) never bursts into a run.
- **Runtime** ([`characterRuntime.ts`](../src/game/characters/characterRuntime.ts))
  — module singleton of per-instance state for the debug panel / test API;
  `npcMotion` is published here by NPC/citizen drivers.
- **Render** ([`AnimatedCharacter.tsx`](../src/game/characters/AnimatedCharacter.tsx),
  [`CharacterControllerView.tsx`](../src/game/characters/CharacterControllerView.tsx),
  [`NpcCharacter.tsx`](../src/game/characters/NpcCharacter.tsx)) — loads the GLB,
  drives the animation controller from motion state, and falls back to
  primitives if the asset is missing (`store.characterRenderMode:
  'auto' | 'model' | 'primitive'`).
- **Identity** ([`populationAppearance.ts`](../src/game/characters/populationAppearance.ts))
  — the ONE registry turning a stable id into a multi-axis appearance. It drives
  the wardrobe-capable `blocklife_person` rig, which the PLAYER always uses:
  the save-backed wardrobe needs recolorable material slots, so a single-baked-
  material body may never occupy the player slot (gated in `wave0Contract.test.ts`).
- **Named-resident bodies** (issue #47 Wave 4,
  `WAVE4_NAMED_BODIES`) — a named NPC may instead ride the ONE owner-approved
  body that depicts that exact character. The mapping is a strict 1:1: total,
  injective, absent from the player slot, and cross-checked against the intake
  config's own per-character sources, so a body cannot be renamed onto another
  NPC. Baked clothing is immutable, and the FALLBACK CHAIN is explicit and
  three-deep — `approved body → blocklife_person + that NPC's registry identity →
  the authored capsule` — because the pre-wave visual for these NPCs was the rig,
  not the capsule. Each step is the same `AnimatedCharacter` acting as the
  previous step's fallback (no second renderer or loader), the middle step mounts
  ONLY on failure, and it is observable as `<npcId>#identity`. An NPC with no
  approved body (Leo) keeps the two-step chain it already had.
  See [WAVE 4](ASSET_INTEGRATION_WAVE_4.md).

---

## Visibility & Occlusion

[`visibility/`](../src/game/visibility/). Cutaway: when a building would hide the
player from the fixed camera, that building's materials fade out.

- **Two-phase detection.** A cheap **broad phase**
  ([`occlusionBroadPhase.ts`](../src/game/visibility/occlusionBroadPhase.ts))
  pads a corridor from subject to camera; a **precise phase**
  ([`occlusionDetection.ts`](../src/game/visibility/occlusionDetection.ts)) does
  exact analytic occlusion — for each subject sample it traces the 3D segment
  toward the camera and the occluder blocks it **iff** the segment's ground
  projection crosses the footprint **and** its height inside the footprint dips
  into the occluder's `[minY, maxY]`. Height along the segment is linear → two
  endpoint evaluations, **no raycasting, no mesh access, fully deterministic.**
- **Fade engine** ([`materialFade.ts`](../src/game/visibility/materialFade.ts))
  smoothly ramps opacity; [`Occludable.tsx`](../src/game/visibility/Occludable.tsx)
  marks a mesh occludable; [`OcclusionManager.tsx`](../src/game/visibility/OcclusionManager.tsx)
  runs the per-frame pass over `visibilityRuntime` (module singleton).
- Occluder footprints come from `occluderData.ts` / manifest overrides.

---

## Weather

[`weather/`](../src/game/weather/). Four kinds: `clear | cloudy | rain | foggy`
([`weatherTypes.ts`](../src/game/weather/weatherTypes.ts)).

- **State** — [`weatherSystem.ts`](../src/game/weather/weatherSystem.ts) exports
  the `weatherRuntime` module singleton (smooth blend + `wetness`), mutated by
  the director each frame; **the store mirrors only the discrete `kind`** for
  UI/save. `store.setWeather(kind, { instant })` — instant for tests/loads,
  faded otherwise.
- **Effects** — `RainEffect.tsx`, `FogEffect.tsx`, `Puddles.tsx`,
  `WetSurfaceController.tsx`, composed by
  [`WeatherEffects.tsx`](../src/game/weather/WeatherEffects.tsx). Weather also
  feeds lighting and traffic modifiers (`WEATHER_MODIFIERS`).
- Persisted (kind + wetness) and optional in old saves.

---

## Simulation (time, needs, economy, mood)

[`simulation/`](../src/game/simulation/). Small pure systems the WorldDirector
drives.

- **Time** ([`timeSystem.ts`](../src/game/simulation/timeSystem.ts)) — 1 real
  minute ≈ 1 in-game hour (`HOURS_PER_REAL_SECOND = 1/60`), scaled by
  `store.timeScale`. Advanced via **batched** store commits (not per frame).
- **Needs** ([`needsSystem.ts`](../src/game/simulation/needsSystem.ts)) —
  passive hunger growth + energy drain (faster while running/driving);
  `tickNeeds(stats, dtHours, flags)`.
- **Economy** ([`economySystem.ts`](../src/game/simulation/economySystem.ts)) —
  money math for activities (jobs pay, food/coffee costs, affordability checks).
- **World mood** ([`worldMoodSystem.ts`](../src/game/simulation/worldMoodSystem.ts))
  — `0` = day (lamps/windows off) → `1` = night (fully glowing), smooth dusk/dawn
  ramps; drives the night-glow emissive materials.

Initial stats: `INITIAL_STATS` in [`player/playerTypes.ts`](../src/game/player/playerTypes.ts).

---

## Interaction, Quests & Economy

[`interactables/`](../src/game/interactables/) + data in
[`src/data/interactables.ts`](../src/data/interactables.ts).

- **Nearby detection** ([`useNearbyInteractable.ts`](../src/game/interactables/useNearbyInteractable.ts))
  — finds the closest interactable in range each frame; the HUD shows a prompt;
  `E` fires `store.interact()`.
- **Kinds** — `apartment`, `apartment_exit`, `bed`, `food_truck`, `gym`,
  `job_board`, `npc`, `shelf_depot`, `steal_vehicle`, `storage`, `store_register`,
  `vehicle`, `wardrobe`. Each routes in `store.interact()` to a dialogue, an
  activity panel, a shop, vehicle entry, theft, apartment entry, etc.
- **Activities & inventory** ([`interactionHandlers.ts`](../src/game/interactables/interactionHandlers.ts))
  — `Inventory = Record<itemId, qty>`; `ActivityAction`s bake in affordability
  (e.g. buy coffee $5) and produce an `ActionOutcome` (stat/inventory/money
  changes, optional panel close). Quests advance through the dialogue/economy
  (buy coffee → `has_coffee` → deliver → `completed`).
- **Personal Economy v1** ([`items/`](../src/game/items/) + [`commerce/`](../src/game/commerce/))
  — the same `Record<itemId, qty>` bag is now the typed **backpack** (10 occupied
  slots) fed by one pure inventory service; a reusable **commerce** engine turns
  the two robbery stores into real shops with deterministic game-hour restock;
  item **effects** are typed data applied as a store patch; an apartment **storage**
  chest (40 slots) deposits/withdraws; the phone **Bag** uses items; and the lawful
  **Shelf Run** mission observes a legitimate restock. The legacy `buy_coffee`
  activity now resolves `coffee` through the same catalog behind a shared capacity
  guard. Full design in [PERSONAL_ECONOMY_INVENTORY](PERSONAL_ECONOMY_INVENTORY.md).

---

## Apartment & Interiors

[`interiors/`](../src/game/interiors/). A separate interior scene the police
can't enter.

- **Location flag** — `store.location: 'city' | 'apartment'`. `enterApartment()`
  (on foot, in the city, **and not while wanted** — see [CRIME](CRIME_LAW_ENFORCEMENT.md) M5)
  teleports to `APARTMENT_SPAWN`; `exitApartment()` returns to
  `APARTMENT_STREET_EXIT`.
- **Scene** ([`ApartmentInterior.tsx`](../src/game/interiors/ApartmentInterior.tsx))
  — interior visuals + colliders + camera framing, plus interior interactions
  (bed = sleep/skip time, wardrobe = outfit, storage). Layout in
  `apartmentLayout.ts`.
- **Appearance** ([`interiorTypes.ts`](../src/game/interiors/interiorTypes.ts))
  — `PlayerAppearance` (shirt/pants/accent colors), set at the wardrobe,
  rendered on the player mesh, persisted in the save.
- Saving inside the apartment rewrites the saved position to the street entrance
  (documented v1 limitation), so every load starts safely in the city.

---

## Vehicle Ownership, Parking & Customization

[`vehicles/`](../src/game/vehicles/). ONE deterministic vehicle-ownership platform layered on
the economy/commerce/crime/mission/inventory/housing/social/save/streaming stacks (owning none),
preserving the one-shell driving model — there is still ONE physical car; `vehicleProjection.ts`
answers "which owned vehicle does the shell embody?" and DEFAULTS to the legacy Compact when there
is none, so unowned/stolen/pre-migration driving is unchanged. 4 classes, a validated registry, a
module-singleton owned-asset runtime (`ov_<n>`, cap 4, one-active/one-per-anchor, exact-once), a
`vehicle_dealership` retail store + trade-in through **commerce**, 11 authored parking anchors,
condition/repair/impound + crash wear, per-asset cargo over the **inventory service**'s atomic
`transferItem`, customization (upgrades + palette paint), the Garage phone app, additive fail-safe
save + legacy→Compact migration, and the strict owned-vs-stolen id-namespace separation. Full design
in [VEHICLE_OWNERSHIP_PARKING_CUSTOMIZATION](VEHICLE_OWNERSHIP_PARKING_CUSTOMIZATION.md).

## Housing, Furniture & Property Progression

[`housing/`](../src/game/housing/). ONE deterministic housing platform layered on
the interior/economy/inventory-storage/wardrobe/career/social stacks (owning none
of them). The Starter Studio **is** the legacy apartment interior above, migrated
in place; the City Loft and Premium Apartment add two more interiors. Full design
in [HOUSING_FURNITURE_AND_PROPERTY](HOUSING_FURNITURE_AND_PROPERTY.md).

- **Registry + lease** — 3 tiers (`propertyRegistry.ts`, stable ids) with distinct
  entrances/interiors/safe-spawns/costs/eligibility; a PURE lease model
  (`leaseModel.ts`): one held deposit, 7-day game-time rent, lazy exact-once auto/
  manual pay, 2-day grace + one late fee, debt settlement, no eviction.
- **Runtime + save** — a module-singleton `housingRuntime` (ids/scalars only,
  bridged to zustand via a `housingVersion` counter) with the ONE exact-once txn
  funnel (stable keys + bounded FIFO ledgers, reload-safe `assetSeq`); additive
  fail-safe persistence (`housingPersistence.ts`) migrates an old apartment save
  into the Starter Studio with a grace period.
- **Furniture + Furnish mode** — a 19-def catalog (`furnitureCatalog.ts`); each
  bought piece is a unique reload-safe **asset** living outside the backpack;
  production **Furnish mode** (`FurnishPanel.tsx`) places/rotates/moves/replaces/
  stores assets over authored per-property slots via a PURE placement validator
  (`placement.ts`).
- **Metrics + effects** — ONE bounded pure calculator (`homeMetrics.ts`:
  Comfort/Style/Storage/Sleep/Hosting, anti-inflation coverage/duplicate multipliers)
  driving real effects: beds → sleep energy/health, storage furniture → capacity,
  a placed wardrobe → 3 outfit presets, seating/table/TV → hosting + home activities.
- **Integration** — typed read-only Career reads (`housingCareer.ts`) gate tier
  eligibility; the Social stack hosts **Coffee at Home / Movie Night / Dinner at
  Home** through the existing invitation/activity pipeline (`housingSocial.ts` +
  new `*_home` kinds + a home venue + an interior-rendered guest); a canonical
  **Home** phone app (`PhoneHousing.tsx`) surfaces lease/listings/metrics/hosting.

---

## Assets & GLB loading

[`assets/`](../src/game/assets/). Optional GLB landmarks with a hard guarantee
of never blocking the scene.

- **Manifest** ([`assetManifest.ts`](../src/game/assets/assetManifest.ts)) — maps
  semantic ids → GLB paths + transforms.
- **Loader** ([`LandmarkAsset.tsx`](../src/game/assets/LandmarkAsset.tsx)) — loads
  a GLB by id and **falls back to primitive geometry** on failure. The registry
  counts `glbLandmarksExpected / Active / Failed`; the test API's
  `assetsSettled()` waits until `Active + Failed >= Expected` so E2E only shoots
  after every landmark has committed or fallen back.
- **Intake** ([`scripts/asset-intake/`](../scripts/asset-intake/)) — one shared,
  deterministic pipeline (`lib.mjs`) behind a per-wave declarative config. It
  opens every pristine source READ-ONLY, asserts its SHA-256 before reading,
  normalizes material names and texture size, and proves the mesh digest, the
  bounding box, the skeleton signature and the runtime-safety invariants
  (no camera / light / unlit / draco / meshopt / KTX2, `metallic 0`,
  `emissive [0,0,0]`, embedded textures only) survive the transform. `--check`
  rebuilds into a temp directory outside the worktree and fails if a committed
  byte differs, so `docs/asset-provenance/*.json` is independently verifiable.
- **Projection is measured, not authored.** A body is fitted INSIDE the authored
  envelope it lands in — `def.size` for a building, the prop type's
  `propPlacement` visual box for a prop — and every scale is recomputed from the
  committed bytes by that wave's contract test, so a hand-edited constant cannot
  pass silently. See [WAVE 4](ASSET_INTEGRATION_WAVE_4.md) and CONVENTIONS #36.

---

## Save / Load

[`save/`](../src/game/save/). One IndexedDB slot via `idb-keyval`.

- **Snapshot** ([`saveGame.ts`](../src/game/save/saveGame.ts) `createSnapshot`)
  captures **persistent** state only: stats, inventory, quest states, NPC memory,
  player position, weather (kind + wetness), appearance, health — via
  `structuredClone` (no shared refs with live state).
- **Validation** (`isValidSave`) — strict on core fields; **newer fields
  (weather, appearance, health) are optional**, so pre-feature saves still load
  at sane defaults.
- **Policy: safety over persistence.** `saveNow()` refuses while
  `getWantedLevel() > 0`. `applySnapshot()` runs `resetCrimeSystems()` +
  `resetCombatSystems()` before restoring, so **a load never restores a chase,
  wanted, police, or drawn weapon** — only durable life state persists. Loads
  always land in the city.

---

## Audio

[`audio/audioManager.ts`](../src/game/audio/audioManager.ts). Minimal
**procedural** Web Audio — no external files. Browsers block autoplay, so nothing
plays until the user presses the Audio button (a user-gesture `enable()`).
Provides click SFX and a continuous engine tone whose pitch tracks driving speed
(`setEngine(speed)`), fed by the WorldDirector. Robbery Pursuit & Getaway Polish
v1 adds one-shot cues driven from the HUD on state transitions: `playSiren()`
(police responding to a contained robbery), `playAlert()` (breach warning), and
`playChime(ok)` (job secured / lost) — all self-guarded until audio is enabled.

---

## UI Layer (HUD, phone, panels)

DOM React outside the Canvas, in [`src/app/`](../src/app/), all driven by the
zustand store:

- **HUD** ([`HUD.tsx`](../src/app/HUD.tsx)) — money/hunger/energy/health bars,
  reputation, district label, weapon/ammo, wanted stars, interaction prompt.
- **Phone** ([`app/phone/`](../src/app/phone/)) — home, map (fast-travel between
  streamed districts — **blocked mid-pursuit**), quests, contacts/messages, jobs,
  settings. Opened with Tab/P.
- **Panels** — `DialoguePanel`, `ActivityPanel`, `WardrobePanel`, `StoragePanel`
  (one `ui.panel` at a time; movement input blocked while the phone is open).
- **Recovery overlay** ([`RecoveryOverlay.tsx`](../src/app/RecoveryOverlay.tsx))
  — **BUSTED** / **WASTED** after arrest / incapacitation, then respawn safe.
- **Debug panel** ([`DebugPanel.tsx`](../src/app/DebugPanel.tsx)) — dev overlays
  for traffic, sectors, occlusion, police, etc. (`` ` `` to toggle).

---

See [CONVENTIONS.md](CONVENTIONS.md) for the cross-cutting patterns every one of
these systems follows, and the gotchas that have bitten past sprints.
