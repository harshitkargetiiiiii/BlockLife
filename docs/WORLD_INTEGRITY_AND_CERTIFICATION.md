# World Integrity & City Certification Platform v1

A reliability platform that gives every runtime world entity ONE explicit
integrity contract, so BlockLife stops re-shipping the same classes of city bugs
as new districts, actors, props and systems are added. It is a **staged
migration** (issue #6) layered on top of the existing streaming, occlusion,
citizen, traffic and world stacks — reimplementing none of them.

**Status:** foundational phases shipped and gated (Phase 0–3 + occlusion parity).
Later phases (streaming safety ring, prop/anchor 3D validation, per-district
certification compiler, generated full-city traversal + soak) are scoped and
partially scaffolded — see [§8 Deferred](#8-deferred-work-honest-scope).

Home of the module: [`src/game/world/integrity/`](../src/game/world/integrity/).

---

## 1. Semantic entity contract (Phase 1)

[`entityTypes.ts`](../src/game/world/integrity/entityTypes.ts) defines one typed,
serializable descriptor every runtime actor/solid is mirrored into
(`EntityDescriptor`: id, `kind`, sector/interior ownership, position/heading,
occupancy radius, AABB/oriented footprint, visual bounds, vertical interval,
`moving`, declared `capabilities`, source ref, generation). Kinds cover player,
ambient citizen, named NPC, police officer, ejected driver, interior civilian,
driven/ambient/parked/police vehicle, building, prop, anchor and world-UI.

**This is not an ECS.** The registry
([`entityRegistry.ts`](../src/game/world/integrity/entityRegistry.ts)) stores
IDs/scalars/footprints/capabilities ONLY — never React components, refs,
Three.js objects, Rapier bodies, materials or scene nodes. Two tiers behind one
`listEntities()` surface:

- **Static** (buildings/props/anchors) — registered by React, **generation-guarded**
  so a StrictMode double-mount or sector remount can't let a stale unmount delete
  the newer instance (CONVENTIONS gotchas #2/#14).
- **Dynamic** (people/vehicles) — mirrored wholesale each integrity tick from the
  existing runtimes via [`entityAdapters.ts`](../src/game/world/integrity/entityAdapters.ts),
  so the runtimes stay the lifecycle + mutation authority (no second authority,
  no per-frame churn).

Deterministic (`listEntities` id-sorted), bounded (`MAX_ENTITIES`), duplicate/stale
counters exposed for parity tests.

## 2. Capability model & automatic parity

Capabilities (`renderable`, `solid`, `occupancy`, `navObstacle`, `occluder`,
`streamed`, `lit`, `interactable`, `worldUi`, `certifiable`) are declared per
entity, with `defaultCapabilitiesForKind` giving a solid building collision +
occlusion + occupancy-obstacle + streaming + certification **automatically**.

## 3. Universal person occupancy (Phase 3) — fixes crowd phasing (bug #1)

[`occupancy.ts`](../src/game/world/integrity/occupancy.ts) is the pure, ordered,
deterministic resolver: accept intended move → moving↔moving spacing →
moving↔stationary → stationary↔stationary repair → vehicle push-out → **static-solid
final clamp** → validate finite. Person spacing (2–4) is a capped SOFT nudge;
vehicle/solid exclusion (5–6) are HARD clamps.

Wired live at the citizen post-movement point via
[`personSeparation.ts`](../src/game/world/personSeparation.ts) `resolvePersonSpacing`,
which runs for **every** citizen — walking, idle, queueing, waiting-to-cross —
replacing the legacy moving-only separator that skipped idle actors entirely.

**Deadlock safety (critical).** The live path uses `yieldAroundStationary:false`
because BlockLife uses WAYPOINT trips: a destination can legitimately sit beside
an idler, so shoving a walker off its path would strand the trip. Result: movers
separate from movers, idlers repair overlaps among themselves, transient
mover-through-idler contact is tolerated (only SUSTAINED overlap is corruption).
This preserves the hard-won moving-only trip guarantee (CONVENTIONS gotcha #16).

**Authored-lockstep defects** (two citizens sharing a start + waypoints + speed)
can't be fixed by runtime nudging — they were de-conflicted in the data (the
Harbor Cross shuttle lanes). See CONVENTIONS gotcha #17.

Result, live-measured: the 4 sustained `person_person_overlap`s the detector
found at Harbor Cross → **0**, with no trip-completion regression (full E2E green).

## 4. Runtime anomaly detection (Phase 0) — the observability backbone

[`anomalyDetector.ts`](../src/game/world/integrity/anomalyDetector.ts) is
OBSERVE-ONLY (occupancy/streaming own correction — no hidden second authority).
Pure overlap scans (person↔person / person↔vehicle / person↔solid via the
occupancy push math, vehicle↔vehicle via SAT) over a registry snapshot, spatially
indexed by [`spatialHash.ts`](../src/game/world/integrity/spatialHash.ts) (never an
all-pairs city scan), plus a pure **traffic stall / honk-loop scan**
(`scanTrafficAnomalies`) over the live car runtime: a car whose `blockedTime`
(seconds obstructed by a road-blocker — a person or the driven car, which
**resets** on signal/queue/crosswalk waits so a red light never counts) outlives
the staged traffic recovery reads as `traffic_blocked`, escalating to `honk_loop`
once it has been stuck long enough to have cycled its honk several times — the
"intersection pileup / endless blocked-honk" diagnosis. A stateful
`AnomalyTracker` separates **transient contact** (tolerated) from **sustained
corruption** (reported past ~8 ticks / 2s), dedupes, bounds its record set.

Driven by [`integrityRuntime.ts`](../src/game/world/integrity/integrityRuntime.ts)
+ the DEV-only [`IntegritySystem`](../src/game/world/integrity/IntegritySystem.tsx)
at ~4 Hz on the real clamped delta, never throwing out of `useFrame`. Produces the
"anomalies before/after fixes" metrics.

## 5. Viewport-clamped world UI (Phase 2) — fixes off-screen labels (bug #4)

[`viewportClamp.ts`](../src/game/world/integrity/viewportClamp.ts) is the pure
projection-clamp (keeps an element inside a safe margin, reports a tail direction
back to the true anchor, hides behind-camera anchors, flips alignment near edges).
[`WorldAnchoredHtml`](../src/game/ui3d/WorldAnchoredHtml.tsx) routes drei `<Html>`
through it via `calculatePosition`; `SpeechBubble` and `WorldLabel` now go through
`WorldAnchoredHtml`, so bubbles/labels stay on-screen near every edge.

## 6. Occlusion parity certification (Phase 2) — fixes/certifies bug #5

[`occlusionParity.ts`](../src/game/world/integrity/occlusionParity.ts).
**Audit correction to finding #11:** on current master every building render path
(central `CityBlock`, `GatewaySector`, shelves, all compiled Kit sectors) funnels
through the same `<Buildings>` → `BuildingMesh` → `<Occludable>`, and `BUILDINGS`
aggregates the compiled sectors — so parity is already structurally satisfied.
This module CERTIFIES it: `certifyOcclusionParity()` proves from authored data
that every qualifying building (height ≥ 3.5) is occludable-by-default (explicit
manifest opt-outs listed, silent gaps fail); `checkLiveOcclusionParity()` cross-checks
the live registered occluder set for missing / phantom ids (a future render path
bypassing `<Occludable>` fails the gate). Live-verified across central + gateway.

## 7. Debug / test API (DEV-only)

On `window.GAME_TEST_API` (all `import.meta.env.DEV`-guarded, **0** strings in
`dist/`): `getWorldEntities`, `getIntegritySnapshot`, `getIntegrityAnomalies`,
`runIntegrityScan`, `assertNoPersonVehicleOverlaps`, `assertNoPersonSolidOverlaps`,
`getOcclusionParity`, `getLiveOcclusionParity`.

## 7b. Live spatial integrity — person↔vehicle + person↔solid (Slice 2)

[`personOccupancy.ts`](../src/game/world/integrity/personOccupancy.ts) composes the
FULL live contract per actor: person spacing → on-foot player push → **hard
oriented vehicle push-out** → **mandatory static-solid clamp**. Obstacles come
from the repo's existing oriented-rectangle sources via
[`liveObstacles.ts`](../src/game/world/integrity/liveObstacles.ts) — vehicles from
`trafficRuntime.cars` + `getDrivenCarFootprint()` (rebuilt once per frame),
buildings/props/water from `collectSolidFootprints()` (indexed once in a spatial
hash). Wired into **every ambient citizen AND named NPC**, in every state. Runs
only on live frames (after the pause-snap early-return → no visual-determinism
impact).

**On-path vs off-path (the key scoping).** Person spacing + the player push apply
to every actor. The **hard oriented vehicle push-out** applies to **off-path**
actors only — idle, queueing, sitting, frozen, panicking or displaced people,
which have no per-frame avoidance and are the actual source of the "person on a
car" bug (#2). An actor actively walking an **authored path leg** (`onPath`) skips
the vehicle clamp: it already gap-crosses roads via `decidePedestrian` and steps
out of cars via `CAR_CLEARANCE`, so a per-frame push-out of a car it is passing
between would only fight its crossings and add whole-fleet CPU drag that slows the
headless E2E (a cross-district commute regressed to a timeout under the always-on
clamp; scoping it to off-path restored a ~3.3min trip). The **mandatory
static-solid clamp**, by contrast, is **universal** — a solid never lies on a
validated route, so a walker moving under its own steam is never inside one, but
once some OTHER force (person spacing, the player push, an un-clamped police shove)
drives an on-path walker's **centre into a building** it is clamped straight back
out, so the "no person ever embedded in a solid" contract (#3) holds for on-path
and off-path alike. To keep the commute perf, an on-path walker that was **not
displaced this frame** skips even the (cheap, spatial-hash) solid query — its
centre cannot have entered a solid on its own. See CONVENTIONS #18. Where a clamp
does fire, it fires only when the person's **centre is inside** the solid/car
(genuine embedding); a body merely grazing an edge is tolerated, kept consistent
with the detector's `embedTolerance` (so the clamp's tangent ejection always
clears the anomaly it would raise). The 300 s integrity soak (§14) caught the
on-path gap: police pathing through a plaza stroller / window shopper pinned them
into `building_apartment_01` / `building_shop_01` — now clamped out.

`findClearPlayerSpawn()` clears a vehicle-exit / respawn point of nearby solids,
vehicles AND people (wired into `exitVehicle`) — the player never exits onto a
body (bug: invalid vehicle-exit positions). Dismounted **police officers** are
mirrored into the registry so the detector surfaces police↔civilian / police↔solid
overlaps; the ambient-vehicle mirror now carries **real headings** so the
vehicle↔vehicle oriented-SAT overlap check catches genuine pileups. Complementing
the geometric pileup check, the **traffic stall / honk-loop scan** (§4) flags a
car wedged behind a road-blocker past the recovery window — the "endless
blocked/honking" failure mode — without misfiring on normal signal/crosswalk stops
(live-verified zero at the signalized Harbor Cross crossing).

## 7c. Streaming safety ring — free-locomotion coverage (Slice 3, issue §6)

[`sectorSafetyRing.ts`](../src/game/world/sectors/sectorSafetyRing.ts) extends the
transactional streaming guarantee — previously teleport-only — to ORDINARY
walking/driving, so the active subject never reaches an area whose
floor/colliders/visuals aren't ready ("blank city on a boundary crossing", bug #6).
Built on the existing lifecycle + generation-safe readiness (the missions-sprint
wedge fix), reimplementing none of it.

- **Coverage invariant, every frame**: `evaluatePlayerSafetyRing` computes the
  REQUIRED sectors — the one under the subject + the velocity-projected sector
  being entered — and checks each `isSectorReadyForGameplay`. The `SectorDirector`
  runs it after the streaming tick (`stepPlayerSafetyRing`).
- **Soft boundary backstop** (`clampVelocityToCoverage`): the rare last-resort. If
  the sector across the boundary the subject is about to cross isn't ready, the
  crossing velocity component is softly zeroed (the subject slides the edge until
  it commits, then proceeds) — wired into BOTH the on-foot player and the driven
  car. Speed-aware prewarm (velocity-lead, already in `computeDesiredLifecycles`)
  means a subject at speed almost never feels it; when it fires it auto-releases
  on load. Never freezes the game, never teleports the subject back.
- **Bounded watchdog self-heal** (`healStuckRequiredSectors` +
  `forceSectorReload`): a required sector wedged in `loading` past a bounded
  timeout is force-reloaded (generation bumped → stale callbacks rejected → React
  remounts fresh). It only touches `loading` sectors, so it never unloads the
  active ground under the player.
- **Typed anomalies**: the observe-only scan (`scanStreamingAnomalies`, §4) now
  produces the previously-declared `player_outside_coverage` (coverage gap /
  backstop clamping) and `sector_stuck_loading` (watchdog self-heal) records.
- **DEV controls + test API**: `holdSectorReadiness`/`releaseSectorReadiness`
  inject delayed readiness (suppress a `ready:true` report), and `getSafetyRing` /
  `isSectorReady` expose coverage — so the required streaming tests exercise the
  real runtime, not test-only state jumps.

## 7d. 3D placement & authoring integrity (Slice 4, issue §7/§8)

Floating props, geometry clipping through facades, citizens authored inside
walls/poles and duplicated routes become authoring FAILURES (bug #7). A canonical
placement model + pure validators + a whole-city gate, reimplementing no renderer.

- **Canonical visual bounds, separate from collision**
  ([`propPlacement.ts`](../src/game/world/propPlacement.ts), a LEAF like
  `propSolidity`): per prop type the full VISUAL envelope (foliage/canopy/overhang)
  + `[minY,maxY]` + support mode, transcribed from the `Props.tsx` meshes. Encodes
  the one intentional `wall` mount (`porch_light`), and — as narrow PER-TYPE intents
  (never per-coordinate) — `canopy` (tree foliage legitimately overhangs a roof, so
  the facade check uses the TRUNK) and `abutsBuilding` (a ground AC condenser sits
  flush against its host wall).
- **Pure validators**
  ([`placementValidation.ts`](../src/game/world/integrity/placementValidation.ts)):
  base-contact (float/sink vs the support surface), visual-clip (penetration, not
  adjacency) vs facades, anchor clearance (actual body radius) for every authored
  person/marker position, near-duplicate citizen start+route (the lockstep class),
  route-corridor vs solids, and GLB↔fallback ground-contact drift.
- **Whole-city gate**
  ([`sectorPlacementReport.ts`](../src/game/world/integrity/sectorPlacementReport.ts)
  + [`cityPlacement.test.ts`](../src/game/world/integrity/cityPlacement.test.ts)):
  the validators run over EVERY district's real authored data — one unit test per
  district, all zero defects. A regression names the exact entity + reason. The
  authored city was already clean (no data moved, no baseline churn); the 4
  apparent overlaps were foliage-overhang + a wall-abutting AC, both modelled.
- **Runtime anomalies + test API**
  ([`placementIntegrity.ts`](../src/game/world/integrity/placementIntegrity.ts)):
  the memoized city failures fold into the observe-only integrity scan, producing
  the now-wired `prop_floating` / `prop_clipping` / `anchor_invalid` types; a future
  authored defect surfaces live, not only in the unit gate. `getPlacementReport`
  exposes the per-district report.

## 7e. District certification + Automated City Sweeper (Slice 5, issue §11–14)

The capstone: every authored district gets a deterministic **certificate**, and a
GENERATED suite explores + photographs + soaks the whole city so a new district is
covered automatically.

- **Certification compiler**
  ([`districtCertification.ts`](../src/game/world/integrity/districtCertification.ts)):
  `certifyDistrict` produces a machine-readable certificate per district over the
  §11 matrix (identity, bounds, floor/visual, building bounds/colliders/occlusion,
  prop visual/base, anchors, duplicate routes, road-graph, streaming ownership,
  labels, anomaly coverage…) by AGGREGATING the validators already shipped
  (occlusion parity, placement report, graph validation) + presence checks — no
  new authority. A district FAILS on any error-severity check; warnings (a backdrop
  legitimately lacking streets) never fail the verdict. `certifyCity` runs every
  `SECTOR_DEFINITIONS` entry (central adapter + kit sectors + backdrops); ALL 9
  certify. Surfaced in the **debug panel**, `getCityCertification` test API, and a
  Vitest gate — visible, testable, generated for every district + future ones (§11).
- **Automated City Sweeper**
  ([`citySweep.ts`](../src/game/world/integrity/citySweep.ts)) generates traversal
  targets + visual-sweep frames from the compiled sector + anchor data (framed at
  the district's CONTENT centroid, not the empty sector centre). The generated E2E
  ([`tests/e2e/city-sweep.spec.ts`](../tests/e2e/city-sweep.spec.ts)) visits every
  district asserting coverage + zero sustained corruption + no page errors +
  bounded self-heal; the generated visual sweep
  ([`tests/visual/city-sweep-visuals.spec.ts`](../tests/visual/city-sweep-visuals.spec.ts))
  captures one deterministic overview per map-visible district. **The sweeper found
  a real lockstep bug** (`s1_-1_walkers_0/1` permanently overlapped) that no
  hand-authored test covered — fixed at the compiler with parallel walker lanes
  (CONVENTIONS #21).
- **300-second integrity soak**
  ([`tests/e2e/integrity-soak.spec.ts`](../tests/e2e/integrity-soak.spec.ts))
  cycles every district + time/weather + police-panic + interiors + unload/reload
  for 300s (§14), sampling the observe-only scan: zero sustained corruption, no
  registry duplicate IDs, bounded entity/self-heal growth, no page errors. It
  earned its keep, driving out several latent defects no hand-authored test hit —
  on-path citizens walking their own centre into a building (→ the solid clamp is
  now unconditional, §7b), and three opposite-direction lockstep pairs
  de-conflicted in the data/compiler (`cit_hc_loop_cw/ccw`, `cit_w_lane_walker`/
  `cit_w_jogger`, count-2 `visit_spot` freight/dock workers — CONVENTIONS #17/#21).
  It asserts zero sustained corruption only among the actors the platform CLAMPS
  (citizens / named NPCs / ambient vehicles vs each other + solids); police and the
  user-controlled `player` are out-of-scope participants it filters (see §8).

## 8. Status + remaining scope (honest)

All six phases of issue #6 are now SHIPPED + gated: Phase 0–3 (foundation, #7),
Live Spatial Integrity (#8), Streaming Safety Ring (#9), 3D Placement & Authoring
Integrity (#10), and the District Certification compiler + Automated City Sweeper
+ 300s soak (Slice 5). Every authored district certifies; the whole-city gate,
generated traversal, generated visual sweep and integrity soak are green.

One item stays intentionally DEFERRED (detected, not yet hard-clamped):

- **Police / interior-civilian / ejected-driver movement CLAMPS**: these actors
  are DETECTED (police mirrored into the registry + surfaced by the anomaly scan),
  and citizens/NPCs — the bulk — are fully clamped. Hard-clamping the AI-driven
  police pursuit + the off-grid interior-civilian scenes is left out to avoid
  fighting their bespoke logic (they already dismount at validated points / use an
  interior-aware avoid). This is a narrow, documented gap, not a missing phase.

And one participant is out of scope BY DESIGN, not deferred:

- **The `player`**: the platform makes citizens/NPCs YIELD to the on-foot player
  (a soft push) but never repositions the player itself — that's the player
  controller's domain, and walking onto an NPC to interact is normal gameplay. So
  the contract is "NPCs yield to the player", not "the player never overlaps an
  NPC". The soak (which teleports the player around aggressively) filters overlaps
  where `player` is a participant; NPC↔citizen / NPC↔NPC overlaps stay in scope.

## 9. Coverage

- Unit: [`spatialHash`](../src/game/world/integrity/spatialHash.test.ts) (6),
  [`entityRegistry`](../src/game/world/integrity/entityRegistry.test.ts) (8),
  [`occupancy`](../src/game/world/integrity/occupancy.test.ts) (15),
  [`viewportClamp`](../src/game/world/integrity/viewportClamp.test.ts) (7),
  [`anomalyDetector`](../src/game/world/integrity/anomalyDetector.test.ts) (20 —
  incl. **police officer overlapping a civilian** since `police_officer` is a
  person kind, and the **traffic stall / honk-loop** scan: stall past threshold,
  honk-loop escalation alongside the stall, mixed-fleet isolation, custom
  thresholds, and no-flag below threshold),
  [`integrityRuntime`](../src/game/world/integrity/integrityRuntime.test.ts) (3),
  [`occlusionParity`](../src/game/world/integrity/occlusionParity.test.ts) (6),
  [`personOccupancy`](../src/game/world/integrity/personOccupancy.test.ts) (9 —
  mandatory solid clamp ejects an OFF-path person from a building, hard vehicle
  clamp off a car, on-foot player push, an **UNDISTURBED on-path walker skips the
  clamp** (trusts its validated route) while a **DISPLACED on-path walker is still
  clamped out** of a solid, `findClearPlayerSpawn` clears solids/vehicles/people
  incl. the coincident case), + `personSeparation` universal-spacing cases (3),
  [`sectorSafetyRing`](../src/game/world/sectors/sectorSafetyRing.test.ts) (13 —
  required sectors from velocity, coverage gap on an un-ready entering sector,
  soft backstop zeroes only the crossing component into an un-ready neighbour
  within the band + slides along the edge, watchdog self-heals a wedged loading
  sector with a generation bump),
  [`placementValidation`](../src/game/world/integrity/placementValidation.test.ts)
  (13 — geometry helpers + one fixture per **regression proof #1–7**:
  rooftop-float, awning-clip, citizen-in-wall, duplicate route, crosswalk-in-furniture,
  doorway-too-close, GLB/fallback drift),
  [`cityPlacement`](../src/game/world/integrity/cityPlacement.test.ts) (7 — every
  district's real authored data validated, all zero defects),
  [`placementIntegrity`](../src/game/world/integrity/placementIntegrity.test.ts)
  (3 — failure→anomaly mapping, report-only kinds skipped, live city clean),
  [`districtCertification`](../src/game/world/integrity/districtCertification.test.ts)
  (8 — whole city certifies 9/9 with 0 errors, deterministic, §11 matrix present;
  fail paths: degenerate building, occlusion miss, prop clip/float, graph errors),
  [`citySweep`](../src/game/world/integrity/citySweep.test.ts) (4 — every district
  covered, targets in-bounds, deterministic, one visual frame per map-visible
  district).
- E2E: [`tests/e2e/world-integrity.spec.ts`](../tests/e2e/world-integrity.spec.ts)
  (5) — registry mirrors live actors, idle+moving crowd never sustains overlap,
  every district certifies occlusion parity live, **no sustained person↔vehicle
  / person↔solid / vehicle↔vehicle overlap** in a busy crossing (crowds + traffic),
  and every district is **placement-clean** live (no float/clip/anchor defects,
  no runtime placement anomaly),
  with **zero false traffic-stall diagnostics** at the signalized Harbor Cross
  (proving `blockedTime` excludes signal/crosswalk stops). Plus the existing
  `citizen-destinations` trip soak proves no occupancy-induced deadlock from the
  solid/vehicle clamps.
  [`tests/e2e/streaming-safety-ring.spec.ts`](../tests/e2e/streaming-safety-ring.spec.ts)
  (2) — the coverage invariant holds at spawn AND after a cross-district teleport
  (backstop inert in normal play), and delayed readiness opens a coverage gap +
  `player_outside_coverage` anomaly that auto-recovers once readiness commits.

## 10. Invariants held

Observe-only detector (correction stays with occupancy/streaming); IDs/scalars
only in the registry; deterministic + bounded + generation-safe; spatial index,
no all-pairs per-frame scan; real clamped delta; never throws from `useFrame`;
no per-frame Zustand writes; DEV-only test API with **0** `dist/` leak; waypoint
trips never stranded (deadlock-safe occupancy).
