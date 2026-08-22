# E2E `@simulation-only` classification (render-suppression rollout)

Branch `e2e-ci-telemetry-probe`. The E2E suite (**367** tests) is partitioned **exactly once** into two
CI partitions (verified deterministically by `scripts/e2e-partition-check.mjs`):

| partition | selector | rendering | count |
|---|---|---|---|
| **simulation-only** | `--grep @simulation-only` | **suppressed** (scene made non-visible after settle; loop/physics/directors preserved) | **325** |
| **normal-render** | `--grep-invert @simulation-only` | normal WebGL | **42** |

`325 + 42 = 367`, empty intersection, complete union, no test in both partitions (also verified at the
file level: 40 spec files → simulation-only, 7 spec files → normal-render, disjoint).

## What render suppression is (and is not)
Suppression makes the R3F **root scene non-visible** — Three skips drawing (≈0 draw calls) but R3F keeps
ticking the single `useFrame` authority and calling `gl.render`, so **physics colliders, authored
routes, traffic/citizen/police directors, streaming lifecycle (`visualsReady`/`collidersReady`),
occupancy/crossings and animation-independent movement all keep running unchanged** (proven: the
yard-worker cross-district commute passes under suppression by *real arrival*, not by a relaxed
assertion). On the software-rendered CI runner this lifts the frame-driven sim from ≈0.05× to ≈1.0×
real time, so timing/commute/soak tests reach their terminal state within the **unchanged** 90 s test
timeout.

### Precise-claim boundaries (do not overstate)
- Suppression fixes **throughput only for tests whose verdict is pixel-independent**. It does not make
  either visual PR (#26/#28) defect-free, and it is not applied to render-dependent tests.
- `clampedSimRate` describes the **clamped frame-driven systems** (`dt = Math.min(raw, 0.05)`), not
  necessarily every subsystem.
- Person-movement telemetry is **aggregate start-to-end displacement**, not path length.
- A **hardware-accelerated (GPU) runner remains untested** here; both the CI runner and the local M2
  reference use SwiftShader (software WebGL). Numbers are software-renderer numbers.
- **Render-sensitive coverage stays under normal rendering** (the 42-test normal partition) — never
  suppressed. The partition boundary is **eligibility, not pass/fail**.

## Eligibility rule for `@simulation-only`
A test is tagged **only if its verdict is independent of rendered pixels** — ALL must hold: it waits
for / asserts gameplay state and asserts a real domain invariant; rendering is not part of its expected
behavior; **no** screenshot/pixel compare; **no** camera/framing assertion; **no** material / lighting
/ shadow / visibility assertion; **no** which-model / variant / fallback (GLB) assertion; **no**
occlusion / `.fade` / opacity assertion; **no** canvas pointer-position dependency (all E2E clicks are
DOM `getByTestId`, never canvas coordinates); and it is **not** a test whose purpose is asset-loading /
render-settlement itself. DOM `toBeVisible` on HUD/phone/panel elements is **not** a 3D-render assertion
(React DOM renders regardless of scene suppression), so it does not disqualify a test. **A test is never
tagged merely because it fails on CI.**

## NOT tagged — the 42 normal-render tests (must keep normal rendering)
These 7 specs assert rendered/model/occlusion state and stay in the normal partition (verified: none of
their test ids carry `@simulation-only`; they are exactly the normal partition):

| spec | tests | why it must render | failed on master run 32395852501? |
|---|---|---|---|
| asset-pipeline-round2 | 11 | GLB fetch/lifecycle, `activeVisual`/`modelLoaded`/fallback, render stats | **yes (1)** — blocker below |
| characters | 10 | rigged model, wardrobe-on-model, occlusion fade (`activeVisual`/`.fade`/`opacity`) | no |
| occlusion | 7 | building fade / opacity / window-overlay carry | no |
| world-integrity | 6 | includes **occlusion-parity** certification (a render assertion) | no |
| character-identity-v1 | 5 | named cast render the model, distinct identity (`activeVisual`/`modelLoaded`) | no |
| asset-perf-round2 | 2 | draw calls / triangles / GLB scene budget | no |
| population-soak | 1 | rigged-population LOD promote/demote + appearance rehydration over a 300 s soak | **yes (1)** — blocker below |

**Known normal-render BLOCKERS (this rollout does NOT fix them — reported, not worked around).** Two
normal-render tests failed on the red master run and are held OUT of suppression because their verdict
depends on which visual rendered / on render-LOD:

- `asset-pipeline-round2.spec.ts:74` — *"representative-player path drives a Meshy humanoid, never the
  fallback (#4)"*: asserts the player's **active visual is the GLB, not the fallback** (a which-model
  assertion) AND drives a path (sim-progress). NOT suppression-eligible (model assertion). The failure
  signature reads as sim-progress starvation, so it is a candidate for a *future* refactor that splits
  the load-state check from the drive — but tagging it now would violate the eligibility rule.
- `population-soak.spec.ts:46` — a render-dependent 300 s LOD soak; not eligible, and at the clamped
  ~1 FPS it may not finish.

Consequence: the **normal-render partition may be RED on the software renderer** until a
GPU-accelerated runner (or a targeted refactor) exists. That is a pre-existing environment limitation
this PR *exposes and isolates*, not one it claims to solve. The **simulation-only partition is the
shippable win** (the 29 recurring starvation failures from run 32395852501 that live there).

## Tagged `@simulation-only` — per-spec rationale
Counts are the **actual** per-spec `@simulation-only` totals from Playwright `--list` (they sum to 325,
re-verified by `scripts/e2e-partition-check.mjs`). **Recurring = observed failing in the red master E2E
run 32395852501** (the pre-suppression 8-shard gate; every failure there was timeout/stale-progress, no
crashes). Tagging is by **eligibility**, never because a test failed — the recurring column is
informational.

| spec | tests | recurring | terminal domain invariant (real progress) | deps preserved under suppression |
|---|---|---|---|---|
| citizen-destinations | 10 | yes | trip `phase`, `crossingIds`, `tripsCompleted`, destination reached | routes, crossings, streaming, occupancy |
| crime | 19 | yes | wanted level, arrest state, suspect/officer positions | police director, pursuit, colliders |
| crime-soak | 1 | yes | 180 s bounded: no error, arrests/recoveries progress | crime + police directors |
| traffic | 5 | yes | cars stop at red / proceed on green, no overlap, follow gaps | traffic runtime, signals, colliders |
| traffic-routing | 8 | yes | routed car connectivity, red-signal stop, freight soak | road graph, routing, signals |
| intersections | 5 | yes | routed trip through signalized crossing, red-approach stop | signals, routing |
| districts | 6 | yes | player drive Central→east, Officer Kim patrol, ambient loop | streaming, patrol director |
| density | 5 | no | traffic keeps flowing with citizens re-pathing | traffic + citizen directors |
| expansion | 10 | yes | expansion-sector connectivity, commute completion | streaming, routing |
| gameplay-flow | 6 | yes | keyboard move/run, gym/job/apartment interactions | interactables, quest, interiors |
| getaway-pursuit | 8 | yes | containment arm/advance, breach warning, escape state | pursuit + containment directors |
| getaway-soak | 1 | no | 180 s bounded getaway pursuit, no error | pursuit director |
| pedestrian-crossings | 7 | no | pedestrians yield/cross on signal, no deadlock | crossings, occupancy |
| integrity-soak | 1 | yes | 300 s: zero sustained corruption, bounded entities | occupancy resolver, streaming |
| city-sweep | 1 | no | traverse every district, sustained/placement anomalies = 0 | streaming, occupancy, placement |
| vehicles | 46 | no | ownership/parking/retrieve/cargo/give-a-ride state | vehicle runtime, colliders |
| vehicles-soak | 1 | no | 180 s bounded vehicle lifecycle, no error | vehicle runtime |
| careers | 35 | no | shift start/complete, pay, skill XP, promotion state | career runtime, workplaces |
| careers-soak | 1 | no | bounded career lifecycle over days | career runtime |
| social | 15 | no | relationship/memory deltas, invitation/activity state | social runtime |
| social-soak | 1 | no | 200-day social lifecycle, all bounds hold | social runtime |
| authoring | 4 | yes | routed traffic drives compiled road to kit destination | authoring compiler, routing |
| missions | 16 | no | mission objective/receipt/reward state | mission director |
| mission-soak | 1 | no | 180 s mission soak, no error | mission director |
| store-robbery | 11 | no | robbery threat/loot/proceeds, containment | robbery director, interiors |
| robbery-soak | 1 | no | 180 s robbery soak, no error | robbery director |
| economy | 13 | no | inventory/commerce/restock state, backpack caps | commerce runtime |
| economy-soak | 1 | no | 180 s economy soak, bounded | commerce runtime |
| housing | 44 | no | lease/rent/furnish/comfort/hosting state | housing runtime, interiors |
| housing-soak | 1 | no | housing lifecycle bounded | housing runtime |
| crosswalk-art | 6 | no | painted-crossing pedestrian behavior | crossings |
| sectors | 6 | no | streaming lifecycle, ownership, graph, save/load | streaming, road graph |
| streaming-safety-ring | 2 | no | coverage invariant, boundary backstop, self-heal | streaming |
| city-expansion | 3 | no | expansion authoring/connectivity | streaming, routing |
| save-load | 4 | no | save→load state fidelity | persistence |
| game-load | 3 | no | boot/load state, overlay lifts | boot |
| apartment | 5 | no | apartment interior state + interactions | interiors |
| phone | 4 | yes | phone app pages/state (DOM) | phone UI |
| polish | 2 | no | HUD/audio/consequence polish (DOM/state) | HUD |
| weather | 6 | no | weather STATE (kind/wetness) + DOM HUD text | weather runtime |

**Total: 325** across 40 specs; 13 recurring on run 32395852501, the rest tagged purely for
pixel-independent eligibility. `no` does not mean "safe to skip" — every tagged test asserts a real
terminal domain invariant above; the boundary is **eligibility, not pass/fail**.

The exact per-test list (325 titles) is generated below and re-verified by `e2e-partition-check.mjs`.

### Generated `@simulation-only` test list (325)
```
  [chromium] › e2e/apartment.spec.ts:118:3 › apartment home base › phone works inside: At home flavor, closes, movement resumes
  [chromium] › e2e/apartment.spec.ts:34:3 › apartment home base › sleeping in the bed restores energy and advances to next morning
  [chromium] › e2e/apartment.spec.ts:60:3 › apartment home base › wardrobe changes the outfit and it survives save/load
  [chromium] › e2e/apartment.spec.ts:6:3 › apartment home base › player enters from the street door and exits back to the city
  [chromium] › e2e/apartment.spec.ts:92:3 › apartment home base › storage shows the bag without touching quest inventory
  [chromium] › e2e/authoring.spec.ts:113:3 › district authoring kit › streaming cycle: unload/reload twice with no duplicate resources
  [chromium] › e2e/authoring.spec.ts:11:3 › district authoring kit › kit validates live: templates, compiled counts, source refs, zero errors
  [chromium] › e2e/authoring.spec.ts:42:3 › district authoring kit › teleport to Main Street East: sector ready, colliders present, citizens alive
  [chromium] › e2e/authoring.spec.ts:73:3 › district authoring kit › routed traffic drives the compiled road to the kit destination
  [chromium] › e2e/careers-soak.spec.ts:17:3 › career lifecycle soak › cycles all four careers without duplication, leaks, or integrity damage
  [chromium] › e2e/careers.spec.ts:105:3 › careers platform › 4. start is refused before the window and away from the workplace
  [chromium] › e2e/careers.spec.ts:124:3 › careers platform › 5. complete a delivery shift through real stops; pay + skill XP apply once
  [chromium] › e2e/careers.spec.ts:147:3 › careers platform › 6. start + complete a café shift through the production UI + HUD tracker
  [chromium] › e2e/careers.spec.ts:176:3 › careers platform › 7. a gym trainer shift improves Fitness
  [chromium] › e2e/careers.spec.ts:187:3 › careers platform › 8. a trade shift finalizes + cleans up (no leaked active shift/objectives)
  [chromium] › e2e/careers.spec.ts:196:3 › careers platform › 9. missing a shift by advancing real time costs an employer consequence
  [chromium] › e2e/careers.spec.ts:210:3 › careers platform › 10. an active wanted pursuit blocks shift start
  [chromium] › e2e/careers.spec.ts:225:3 › careers platform › 11. a completed shift cannot be replayed for duplicate pay/XP
  [chromium] › e2e/careers.spec.ts:238:3 › careers platform › 12. promotion progress is gated and visible; a fresh trainee is not promotable
  [chromium] › e2e/careers.spec.ts:249:3 › careers platform › 13. save/load preserves job, skills, rank, and history
  [chromium] › e2e/careers.spec.ts:266:3 › careers platform › 14. a cross-district work route preserves streaming + occupancy integrity
  [chromium] › e2e/careers.spec.ts:280:3 › careers platform › 15. reset clears progression to canonical defaults
  [chromium] › e2e/careers.spec.ts:295:3 › careers platform › 16. switching primary jobs drops the old job’s shifts and blocks starting them (F1)
  [chromium] › e2e/careers.spec.ts:318:3 › careers platform › 17. arrest mid-shift fails it, fires the employer follow-up, and schedules the next (F2)
  [chromium] › e2e/careers.spec.ts:345:3 › careers platform › 17b. cancelling a shift also schedules the next (no dead-end) (F2)
  [chromium] › e2e/careers.spec.ts:356:3 › careers platform › 18. a full page reload from a mid-shift save discards the shift, cleans cargo, schedules the next, never double-pays (F3)
  [chromium] › e2e/careers.spec.ts:393:3 › careers platform › 19. three good shifts earn a promotion; the next shift pays the higher rank rate (F5/§8)
  [chromium] › e2e/careers.spec.ts:411:3 › careers platform › 20. an accepted social plan overlapping the next shift shows a conflict warning (F4)
  [chromium] › e2e/careers.spec.ts:430:3 › careers platform › 21. shift objectives cannot be cheesed: a full bag blocks collect; a stop needs the cargo (F8)
  [chromium] › e2e/careers.spec.ts:460:3 › careers platform › 22. the thermal-bag unlock lets a full bag still carry cargo (F6)
  [chromium] › e2e/careers.spec.ts:491:3 › careers platform › 23. completing a social activity raises Social through the production path (F7)
  [chromium] › e2e/careers.spec.ts:513:3 › careers platform › 23b. a gym workout raises Fitness through the production path (F7)
  [chromium] › e2e/careers.spec.ts:523:3 › careers platform › 24. the shift results screen shows the pay decomposition + score breakdown (F5)
  [chromium] › e2e/careers.spec.ts:539:3 › careers platform › 25. arrest mid-shift settles partial pay + penalty in one exact balance (R3-1)
  [chromium] › e2e/careers.spec.ts:578:3 › careers platform › 26. incapacitation mid-shift also settles the exact balance (R3-1)
  [chromium] › e2e/careers.spec.ts:614:3 › careers platform › 27. a job cannot be replaced or left while a shift is active (R3-2)
  [chromium] › e2e/careers.spec.ts:636:3 › careers platform › 28. a social activity cannot start while a career shift is active (R3-3)
  [chromium] › e2e/careers.spec.ts:656:3 › careers platform › 29. the world Job Board opens Careers v1, not a money vendor (R4)
  [chromium] › e2e/careers.spec.ts:669:3 › careers platform › 30. the Café staff discount displays the same price it charges (R4)
  [chromium] › e2e/careers.spec.ts:685:3 › careers platform › 31. a mission cannot be accepted while a career shift is active (R4)
  [chromium] › e2e/careers.spec.ts:697:3 › careers platform › 32. Sleep and Train are blocked while on a shift; the shift still advances (R4)
  [chromium] › e2e/careers.spec.ts:717:3 › careers platform › 33. a mission RETRY is also refused while a career shift is active (R5)
  [chromium] › e2e/careers.spec.ts:77:3 › careers platform › 1. discover, apply, and get hired through the production UI
  [chromium] › e2e/careers.spec.ts:87:3 › careers platform › 2. an ineligible application shows a readable unmet requirement
  [chromium] › e2e/careers.spec.ts:92:3 › careers platform › 3. a social recommendation relaxes a career requirement
  [chromium] › e2e/citizen-destinations.spec.ts:133:3 › crossing-aware citizen destinations › a citizen travels toward the waterfront through the painted drive crossing
  [chromium] › e2e/citizen-destinations.spec.ts:165:3 › crossing-aware citizen destinations › the yard worker completes a cross-district commute to the warehouse door
  [chromium] › e2e/citizen-destinations.spec.ts:197:3 › crossing-aware citizen destinations › destination capacity prevents overcrowding
  [chromium] › e2e/citizen-destinations.spec.ts:213:3 › crossing-aware citizen destinations › rain steers the next selection to an indoor destination
  [chromium] › e2e/citizen-destinations.spec.ts:243:3 › crossing-aware citizen destinations › sector unload/reload preserves the trip system: no duplicates, no leaked occupancy
  [chromium] › e2e/citizen-destinations.spec.ts:284:3 › crossing-aware citizen destinations › two citizens use different crossings simultaneously without deadlock
  [chromium] › e2e/citizen-destinations.spec.ts:318:3 › crossing-aware citizen destinations › 150s mixed soak: trips keep completing, nobody strands, occupancy never leaks
  [chromium] › e2e/citizen-destinations.spec.ts:40:3 › crossing-aware citizen destinations › boot: graph summary, destination catalog, deterministic trip states
  [chromium] › e2e/citizen-destinations.spec.ts:61:3 › crossing-aware citizen destinations › a shopper is routed across Harbor Cross to a shop and makes progress
  [chromium] › e2e/citizen-destinations.spec.ts:89:3 › crossing-aware citizen destinations › waits at the curb, crosses on all-walk, reaches the destination
  [chromium] › e2e/city-expansion.spec.ts:40:3 › city expansion v2 › traffic flows in every block with zero vehicle overlaps over 30s
  [chromium] › e2e/city-expansion.spec.ts:70:3 › city expansion v2 › player walks the west block and stays solid against its citizens
  [chromium] › e2e/city-expansion.spec.ts:9:3 › city expansion v2 › 50 citizens live across all six blocks
  [chromium] › e2e/city-sweep.spec.ts:15:3 › automated city sweeper › traverses every district with continuous integrity assertions
  [chromium] › e2e/crime-soak.spec.ts:11:1 › 180-second crime soak: pursuits, arrests, recoveries — bounded + no errors
  [chromium] › e2e/crime.spec.ts:101:3 › crime & law enforcement › 5 — dispatch spawns a capped, off-camera response and drains when cleared
  [chromium] › e2e/crime.spec.ts:120:3 › crime & law enforcement › 6 — police arrest a cornered, stopped suspect
  [chromium] › e2e/crime.spec.ts:147:3 › crime & law enforcement › 7 — parked vehicle theft enters driving with a theft crime
  [chromium] › e2e/crime.spec.ts:166:3 › crime & law enforcement › 8 — carjacking an occupied vehicle ejects the driver and is higher severity
  [chromium] › e2e/crime.spec.ts:201:3 › crime & law enforcement › 8b — the carjacked driver flees the scene then despawns
  [chromium] › e2e/crime.spec.ts:226:3 › crime & law enforcement › 9 — a wrecked vehicle is disabled
  [chromium] › e2e/crime.spec.ts:236:3 › crime & law enforcement › 10 — the phone is blocked during an active pursuit
  [chromium] › e2e/crime.spec.ts:245:3 › crime & law enforcement › 11 — health persists across save/load while wanted + weapon reset
  [chromium] › e2e/crime.spec.ts:275:3 › crime & law enforcement › 12 — arrest & incapacitation recovery restore a safe, full-health player
  [chromium] › e2e/crime.spec.ts:28:3 › crime & law enforcement › 1 — the handgun equips full and drawn
  [chromium] › e2e/crime.spec.ts:310:3 › crime & law enforcement › 13 — police pursue a driving suspect over the road graph, not through blocks
  [chromium] › e2e/crime.spec.ts:344:3 › crime & law enforcement › 14 — a cruiser that reaches an on-foot suspect puts an officer on the street
  [chromium] › e2e/crime.spec.ts:386:3 › crime & law enforcement › 15 — officers are one-per-cruiser, capped, and ride down when wanted clears
  [chromium] › e2e/crime.spec.ts:40:3 › crime & law enforcement › 2 — firing emits a weapon_discharge crime and spends a round
  [chromium] › e2e/crime.spec.ts:429:3 › crime & law enforcement › 16 — a quest NPC (Ravi) flees gunfire then recovers toward his anchor
  [chromium] › e2e/crime.spec.ts:509:3 › crime & law enforcement › 17 — you cannot duck into your apartment during a pursuit
  [chromium] › e2e/crime.spec.ts:525:3 › crime & law enforcement › 18 — a pursuit survives crossing sector boundaries (streaming)
  [chromium] › e2e/crime.spec.ts:55:3 › crime & law enforcement › 3 — shooting an officer escalates to wanted level 3
  [chromium] › e2e/crime.spec.ts:81:3 › crime & law enforcement › 4 — downing an officer files a police_injury crime
  [chromium] › e2e/crosswalk-art.spec.ts:102:3 › crosswalk surface art › a crossing citizen stays inside the painted band
  [chromium] › e2e/crosswalk-art.spec.ts:121:3 › crosswalk surface art › a red-holding car stops BEHIND the zebra band, never on it
  [chromium] › e2e/crosswalk-art.spec.ts:149:3 › crosswalk surface art › painted crossings render specs and stay functional
  [chromium] › e2e/crosswalk-art.spec.ts:164:3 › crosswalk surface art › unload/reload keeps art valid with no duplicates and live signal heads
  [chromium] › e2e/crosswalk-art.spec.ts:38:3 › crosswalk surface art › every registered crossing has validated art: 4 signalized + 3 painted
  [chromium] › e2e/crosswalk-art.spec.ts:65:3 › crosswalk surface art › curb furniture never blocks queued citizens
  [chromium] › e2e/density.spec.ts:25:3 › city life density › activeHours citizens go home at night
  [chromium] › e2e/density.spec.ts:40:3 › city life density › the player can walk through the dense residential street without getting stuck
  [chromium] › e2e/density.spec.ts:60:3 › city life density › core interactions still resolve amid the new clutter
  [chromium] › e2e/density.spec.ts:6:3 › city life density › every district has background citizens and they stay off the roads
  [chromium] › e2e/density.spec.ts:80:3 › city life density › traffic keeps flowing with citizens registered as pedestrians
  [chromium] › e2e/districts.spec.ts:151:3 › districts › Officer Kim patrols into Residential Street
  [chromium] › e2e/districts.spec.ts:184:3 › districts › named test locations all teleport correctly
  [chromium] › e2e/districts.spec.ts:34:3 › districts › player can drive from Central through the east connector into the Market Strip
  [chromium] › e2e/districts.spec.ts:67:3 › districts › phone map tracks the player into a new district and shows district labels
  [chromium] › e2e/districts.spec.ts:95:3 › districts › an ambient car works the residential loop and holds at the stop sign
  [chromium] › e2e/districts.spec.ts:9:3 › districts › player can walk from Central up the connector into Residential Street
  [chromium] › e2e/economy-soak.spec.ts:73:1 › economy soak — shopping/inventory/restock stay clean under streaming
  [chromium] › e2e/economy.spec.ts:127:3 › personal economy › 7 — a full-health player cannot waste a first-aid kit
  [chromium] › e2e/economy.spec.ts:138:3 › personal economy › 8 — apartment storage deposit/withdraw survives save/load
  [chromium] › e2e/economy.spec.ts:161:3 › personal economy › 9 — a robbed/recovering store refuses commerce, then reopens
  [chromium] › e2e/economy.spec.ts:181:3 › personal economy › 10 — the Waterfront kiosk reuses the same commerce engine
  [chromium] › e2e/economy.spec.ts:192:3 › personal economy › 11 — a wardrobe unlock is bought, used, and then selectable
  [chromium] › e2e/economy.spec.ts:204:3 › personal economy › 12 — Shelf Run: collect the crate, deliver it, get paid once
  [chromium] › e2e/economy.spec.ts:231:3 › personal economy › 13 — an old save (plain inventory record) migrates without loss
  [chromium] › e2e/economy.spec.ts:38:3 › personal economy › 1 — catalog + stores validate against the live world
  [chromium] › e2e/economy.spec.ts:48:3 › personal economy › 2 — buy at Main St via the real Shop UI: money, stock, bag change once
  [chromium] › e2e/economy.spec.ts:59:3 › personal economy › 3 — an unaffordable item is disabled in the real Shop UI
  [chromium] › e2e/economy.spec.ts:66:3 › personal economy › 4 — a store sells out and the Buy button disables
  [chromium] › e2e/economy.spec.ts:79:3 › personal economy › 5 — a sold-out store restocks after game time passes
  [chromium] › e2e/economy.spec.ts:96:3 › personal economy › 6 — first-aid heals and an ammo box adds reserve, each consumed once
  [chromium] › e2e/expansion.spec.ts:104:3 › city expansion content pack › driving east along Main Street into Residential East
  [chromium] › e2e/expansion.spec.ts:160:3 › city expansion content pack › routed freight trip completes to the Industrial Yard loading dock
  [chromium] › e2e/expansion.spec.ts:200:3 › city expansion content pack › routed trip completes to the Waterfront promenade
  [chromium] › e2e/expansion.spec.ts:232:3 › city expansion content pack › phone map shows the expanded city: new labels + water band
  [chromium] › e2e/expansion.spec.ts:250:3 › city expansion content pack › save/load round-trips inside a new sector
  [chromium] › e2e/expansion.spec.ts:274:3 › city expansion content pack › streaming cycles on two new sectors: no duplicate resources
  [chromium] › e2e/expansion.spec.ts:31:3 › city expansion content pack › boot: expanded graph, all four sectors validate, ownership clean
  [chromium] › e2e/expansion.spec.ts:331:3 › city expansion content pack › rainy night on the waterfront: weather applies, no errors
  [chromium] › e2e/expansion.spec.ts:355:3 › city expansion content pack › large-world soak: routed trips to every new sector while streaming churns
  [chromium] › e2e/expansion.spec.ts:60:3 › city expansion content pack › walking north across the s0_-1 → s0_-2 boundary: ground holds, sector activates
  [chromium] › e2e/game-load.spec.ts:24:3 › game load › starts with the documented initial stats
  [chromium] › e2e/game-load.spec.ts:36:3 › game load › day/night can be changed through the test API and the mood updates
  [chromium] › e2e/game-load.spec.ts:5:3 › game load › loads without console errors and shows the HUD
  [chromium] › e2e/gameplay-flow.spec.ts:11:3 › gameplay flow › player moves with the keyboard and runs with shift
  [chromium] › e2e/gameplay-flow.spec.ts:138:3 › gameplay flow › player can enter, drive and exit the car
  [chromium] › e2e/gameplay-flow.spec.ts:160:3 › gameplay flow › the car cannot drive through buildings
  [chromium] › e2e/gameplay-flow.spec.ts:33:3 › gameplay flow › food truck: buying a meal updates money and hunger
  [chromium] › e2e/gameplay-flow.spec.ts:53:3 › gameplay flow › gym, job board and apartment interactions work
  [chromium] › e2e/gameplay-flow.spec.ts:91:3 › gameplay flow › Coffee for Ravi quest completes end to end
  [chromium] › e2e/getaway-pursuit.spec.ts:103:3 › robbery pursuit & getaway › 3 — store civilians route/react (freeze crouches, flee flees) — no floor sink
  [chromium] › e2e/getaway-pursuit.spec.ts:121:3 › robbery pursuit & getaway › 4 — a fled civilian raises the alarm even at the no-alarm kiosk (report after safety)
  [chromium] › e2e/getaway-pursuit.spec.ts:146:3 › robbery pursuit & getaway › 5 — Fast Exit runs end to end and pays the bonus once
  [chromium] › e2e/getaway-pursuit.spec.ts:196:3 › robbery pursuit & getaway › 6 — only the EXACT getaway car satisfies the re-entry leg
  [chromium] › e2e/getaway-pursuit.spec.ts:242:3 › robbery pursuit & getaway › 7 — saving is blocked while contained inside a robbed store
  [chromium] › e2e/getaway-pursuit.spec.ts:253:3 › robbery pursuit & getaway › 8 — the getaway target is a validly-parked, non-owned civilian car
  [chromium] › e2e/getaway-pursuit.spec.ts:54:3 › robbery pursuit & getaway › 1 — containment arms and advances while wanted inside a robbed store
  [chromium] › e2e/getaway-pursuit.spec.ts:77:3 › robbery pursuit & getaway › 2 — a fair breach warning fires, then forces the player out to the street
  [chromium] › e2e/getaway-soak.spec.ts:102:1 › getaway soak — containment + civilians + Fast Exit stay clean under streaming
  [chromium] › e2e/housing-soak.spec.ts:12:1 › housing lifecycle soak — bounded, no duplication or loss over many game-weeks
  [chromium] › e2e/housing.spec.ts:1007:3 › housing — rent, lifecycle & integrity › a malformed or unknown placement recovers the asset into furniture inventory
  [chromium] › e2e/housing.spec.ts:1021:3 › housing — rent, lifecycle & integrity › a malformed placement + over-capacity load preserves every stored item (review #4)
  [chromium] › e2e/housing.spec.ts:1053:3 › housing — rent, lifecycle & integrity › save, load, and reset during Furnish mode leave no ghost panel or stranded state
  [chromium] › e2e/housing.spec.ts:1074:3 › housing — rent, lifecycle & integrity › a trusted friend recommends a property through the phone and relaxes only the tour (review #1)
  [chromium] › e2e/housing.spec.ts:1103:3 › housing — rent, lifecycle & integrity › reset returns the canonical Starter Studio state safely
  [chromium] › e2e/housing.spec.ts:116:3 › housing — properties & moving › insufficient funds leave lease, balance, deposit, furniture, and storage unchanged
  [chromium] › e2e/housing.spec.ts:139:3 › housing — properties & moving › cross-district move to the far-east Premium tours via the door + moves in (review #6, scenario #22)
  [chromium] › e2e/housing.spec.ts:207:3 › housing — furnishing › buy a furniture piece — displayed price equals charged price, one asset minted
  [chromium] › e2e/housing.spec.ts:219:3 › housing — furnishing › the showroom refuses a purchase when a piece is out of stock (review #2)
  [chromium] › e2e/housing.spec.ts:234:3 › housing — furnishing › the showroom refuses a purchase the player cannot afford (review #2)
  [chromium] › e2e/housing.spec.ts:249:3 › housing — furnishing › a furniture purchase decrements real showroom stock + is exact-once across a reload (review #2)
  [chromium] › e2e/housing.spec.ts:272:3 › housing — furnishing › place, rotate, move, and store furniture through the Furnish UI
  [chromium] › e2e/housing.spec.ts:303:3 › housing — furnishing › an incompatible piece is refused without loss or duplication
  [chromium] › e2e/housing.spec.ts:318:3 › housing — furnishing › a full page reload preserves owned furniture + placements with no duplication
  [chromium] › e2e/housing.spec.ts:336:3 › housing — furnishing › furniture mutation is a no-op once Furnish mode closes or you leave the residence (review #2)
  [chromium] › e2e/housing.spec.ts:375:3 › housing — furnishing › a sold-out showroom item restocks when Furnish reopens after the cadence (review #3)
  [chromium] › e2e/housing.spec.ts:398:3 › housing — furnishing › Furnish selection clears on Escape and never survives a reload (round-3 review #3)
  [chromium] › e2e/housing.spec.ts:457:3 › housing — benefits › the Home app shows the derived metric breakdown
  [chromium] › e2e/housing.spec.ts:45:3 › housing — properties & moving › a new game starts in the Starter Studio
  [chromium] › e2e/housing.spec.ts:465:3 › housing — benefits › a better bed changes the displayed and applied sleep result
  [chromium] › e2e/housing.spec.ts:493:3 › housing — benefits › storage furniture expands enforced capacity; removal blocked while overflow exists
  [chromium] › e2e/housing.spec.ts:518:3 › housing — benefits › a placed wardrobe unlocks a persistent outfit preset
  [chromium] › e2e/housing.spec.ts:54:3 › housing — properties & moving › browse all three listings through the Home app
  [chromium] › e2e/housing.spec.ts:580:3 › housing — hosting › the Home app shows readable hosting refusals in the starter studio
  [chromium] › e2e/housing.spec.ts:586:3 › housing — hosting › one shared gate refuses hosting for a pursuit, an active shift, and delinquency (review #3, scenario #18)
  [chromium] › e2e/housing.spec.ts:623:3 › housing — hosting › the shared gate blocks hosting during an active mission and an active social activity (review #1)
  [chromium] › e2e/housing.spec.ts:62:3 › housing — properties & moving › ineligible properties show the exact rank/income refusal
  [chromium] › e2e/housing.spec.ts:661:3 › housing — hosting › hosting refuses a low-trust guest and a scheduled-shift conflict at the invite entry (review #1)
  [chromium] › e2e/housing.spec.ts:695:3 › housing — hosting › an accepted home plan survives a full save/reload (round-3 review #1)
  [chromium] › e2e/housing.spec.ts:70:3 › housing — properties & moving › the Home app Tour button guides to the entrance; the real tour happens there (review #6)
  [chromium] › e2e/housing.spec.ts:714:3 › housing — hosting › an active home visit is restored coherently across a reload (round-3 review #1)
  [chromium] › e2e/housing.spec.ts:740:3 › housing — hosting › moving homes is refused while a home visit is active — nothing changes (round-3 review #2)
  [chromium] › e2e/housing.spec.ts:769:3 › housing — hosting › invite a guest to Coffee at Home through the Home app
  [chromium] › e2e/housing.spec.ts:778:3 › housing — hosting › host a guest at home — the guest appears inside and the visit cleans up
  [chromium] › e2e/housing.spec.ts:824:3 › housing — rent, lifecycle & integrity › an old apartment save with no housing slice migrates to the Starter Studio with no immediate rent
  [chromium] › e2e/housing.spec.ts:846:3 › housing — rent, lifecycle & integrity › due rent auto-pays exactly once when funds exist
  [chromium] › e2e/housing.spec.ts:862:3 › housing — rent, lifecycle & integrity › insufficient funds create an overdue state and grace expiry adds exactly one late fee
  [chromium] › e2e/housing.spec.ts:879:3 › housing — rent, lifecycle & integrity › manual payment clears delinquency and does not duplicate on reopen or reload
  [chromium] › e2e/housing.spec.ts:899:3 › housing — rent, lifecycle & integrity › hosting is refused with a readable reason while rent is delinquent
  [chromium] › e2e/housing.spec.ts:908:3 › housing — rent, lifecycle & integrity › replace a placed piece through the Furnish UI moves the old asset to storage
  [chromium] › e2e/housing.spec.ts:925:3 › housing — rent, lifecycle & integrity › a TV plus seating unlocks Movie Night; without them the reason is readable
  [chromium] › e2e/housing.spec.ts:947:3 › housing — rent, lifecycle & integrity › moving to a new home packs placed furniture safely and preserves storage + wardrobe data
  [chromium] › e2e/housing.spec.ts:94:3 › housing — properties & moving › lease/move atomically charges the displayed deposit + rent and updates the home
  [chromium] › e2e/housing.spec.ts:978:3 › housing — rent, lifecycle & integrity › a full reload preserves lease, rent period, assets, placements, and presets with no duplicate money or assets
  [chromium] › e2e/integrity-soak.spec.ts:14:1 › 300-second integrity soak: cycle the whole city, zero sustained corruption
  [chromium] › e2e/intersections.spec.ts:112:3 › signalized cross-street intersection › a routed trip TURNS through the intersection to a harbor arm
  [chromium] › e2e/intersections.spec.ts:149:3 › signalized cross-street intersection › sector unload/reload never resets the signal phase
  [chromium] › e2e/intersections.spec.ts:183:3 › signalized cross-street intersection › mixed-traffic soak through the intersection: no overlaps, no deadlock, no replan storm
  [chromium] › e2e/intersections.spec.ts:23:3 › signalized cross-street intersection › boot: intersection registered, plan valid, movements permitted per phase
  [chromium] › e2e/intersections.spec.ts:55:3 › signalized cross-street intersection › red approach stops a routed car at the stop line without replanning; green resumes
  [chromium] › e2e/mission-soak.spec.ts:28:1 › mission soak — repeated attempts stay clean under streaming
  [chromium] › e2e/missions.spec.ts:113:3 › missions & activities › 4 — a delivered courier mission is on cooldown, not re-acceptable
  [chromium] › e2e/missions.spec.ts:124:3 › missions & activities › 5 — City Courier survives save/load mid-run and still completes
  [chromium] › e2e/missions.spec.ts:151:3 › missions & activities › 6 — Hot Cargo: real theft raises wanted, delivery gated on losing it, pays once
  [chromium] › e2e/missions.spec.ts:208:3 › missions & activities › 7 — stealing the WRONG vehicle does not advance Hot Cargo
  [chromium] › e2e/missions.spec.ts:223:3 › missions & activities › 8 — arrest fails Hot Cargo; retry starts a clean new attempt
  [chromium] › e2e/missions.spec.ts:242:3 › missions & activities › 9 — cancelling a mission cleans up with no reward and no wanted reset
  [chromium] › e2e/missions.spec.ts:267:3 › missions & activities › 10 — Coffee for Ravi still works alongside the mission framework
  [chromium] › e2e/missions.spec.ts:279:3 › missions & activities › 11 — mission test API is dev-only (sanity: methods exist in dev)
  [chromium] › e2e/missions.spec.ts:285:3 › missions & activities › 12 — an objective survives a destination sector unload/reload cycle
  [chromium] › e2e/missions.spec.ts:334:3 › missions & activities › 13 — saving is blocked during Hot Cargo but allowed during City Courier
  [chromium] › e2e/missions.spec.ts:351:3 › missions & activities › 14 — entering the apartment during City Courier keeps the job alive
  [chromium] › e2e/missions.spec.ts:369:3 › missions & activities › 15 — a replacement stolen car cannot complete Hot Cargo (target lost)
  [chromium] › e2e/missions.spec.ts:396:3 › missions & activities › 16 — save/load never duplicates a reward or reuses an attempt id
  [chromium] › e2e/missions.spec.ts:54:3 › missions & activities › 1 — mission definitions validate against the live world
  [chromium] › e2e/missions.spec.ts:60:3 › missions & activities › 2 — missions are defined; criminal jobs are locked until discovered
  [chromium] › e2e/missions.spec.ts:80:3 › missions & activities › 3 — City Courier completes end-to-end and pays exactly once
  [chromium] › e2e/pedestrian-crossings.spec.ts:101:3 › live pedestrian crossings at Harbor Cross › all-walk releases the curbs: citizens cross while every approach holds red
  [chromium] › e2e/pedestrian-crossings.spec.ts:142:3 › live pedestrian crossings at Harbor Cross › a green-approach car holds for an occupied crossing, then proceeds once it clears
  [chromium] › e2e/pedestrian-crossings.spec.ts:205:3 › live pedestrian crossings at Harbor Cross › two crossings operate simultaneously without conflicts
  [chromium] › e2e/pedestrian-crossings.spec.ts:233:3 › live pedestrian crossings at Harbor Cross › the on-foot player inside a crossing gets the same vehicle yield
  [chromium] › e2e/pedestrian-crossings.spec.ts:273:3 › live pedestrian crossings at Harbor Cross › sector unload/reload never duplicates, loses, or strands the crossing crowd
  [chromium] › e2e/pedestrian-crossings.spec.ts:312:3 › live pedestrian crossings at Harbor Cross › 130s mixed soak: overlaps zero, nobody stranded, no deadlock, no replan storm
  [chromium] › e2e/pedestrian-crossings.spec.ts:48:3 › live pedestrian crossings at Harbor Cross › citizens queue at the curb through the vehicle phases and never enter on dont_walk
  [chromium] › e2e/phone.spec.ts:11:3 › phone › opens with Tab, switches apps, closes, and movement resumes
  [chromium] › e2e/phone.spec.ts:41:3 › phone › blocks walking while open and Tab toggles it closed
  [chromium] › e2e/phone.spec.ts:60:3 › phone › blocks driving while open
  [chromium] › e2e/phone.spec.ts:87:3 › phone › quest app reflects live quest state
  [chromium] › e2e/polish.spec.ts:11:3 › city polish & density › density lands validated: fixed props, queues/sitters, service vehicles
  [chromium] › e2e/polish.spec.ts:52:3 › city polish & density › phone map shows kit landmarks alongside district labels
  [chromium] › e2e/robbery-soak.spec.ts:63:1 › robbery soak — repeated cycles stay clean under streaming
  [chromium] › e2e/save-load.spec.ts:38:3 › save / load › the save survives a full page reload
  [chromium] › e2e/save-load.spec.ts:55:3 › save / load › the HUD save buttons work
  [chromium] › e2e/save-load.spec.ts:5:3 › save / load › persists stats, quest state, inventory and position
  [chromium] › e2e/save-load.spec.ts:65:3 › save / load › reset clears the save and restores initial stats
  [chromium] › e2e/sectors.spec.ts:104:3 › sector streaming foundation › routed car crosses the sector boundary without route reset
  [chromium] › e2e/sectors.spec.ts:143:3 › sector streaming foundation › forced unload/reload cycle: clean lifecycle, identity preserved, graph untouched
  [chromium] › e2e/sectors.spec.ts:204:3 › sector streaming foundation › phone map shows the gateway; save/load stays compatible
  [chromium] › e2e/sectors.spec.ts:20:3 › sector streaming foundation › boot: player in s0_0 active, neighbors mounted, ownership valid
  [chromium] › e2e/sectors.spec.ts:56:3 › sector streaming foundation › walking across the boundary into the gateway: ground ready, no void
  [chromium] › e2e/sectors.spec.ts:81:3 › sector streaming foundation › teleport to the gateway waits for readiness and lands safely
  [chromium] › e2e/social-soak.spec.ts:22:3 › social lifecycle soak › cycles the whole cast without duplication, leaks, or integrity damage
  [chromium] › e2e/social.spec.ts:111:3 › social platform › 5. a phone invitation → activity completes at the venue and persists
  [chromium] › e2e/social.spec.ts:135:3 › social platform › 6. an accepted invitation ignored past its window becomes a no-show (real clock)
  [chromium] › e2e/social.spec.ts:161:3 › social platform › 7. a crime witnessed by a named NPC hits fear/trust (real consequence)
  [chromium] › e2e/social.spec.ts:175:3 › social platform › 8. save/load preserves relationships, memories, contacts, messages, invitations
  [chromium] › e2e/social.spec.ts:212:3 › social platform › 9. reset clears social state to canonical defaults
  [chromium] › e2e/social.spec.ts:228:3 › social platform › 10. Coffee for Ravi still completes and feeds the social system
  [chromium] › e2e/social.spec.ts:245:3 › social platform › 11. an activity crossing districts to the venue preserves streaming + occupancy
  [chromium] › e2e/social.spec.ts:24:3 › social platform › 1. first meeting unlocks a contact and it persists
  [chromium] › e2e/social.spec.ts:287:3 › social platform › 12. repeated event delivery never duplicates rewards, memories, or deltas
  [chromium] › e2e/social.spec.ts:303:3 › social platform › 13. accept + start + complete an invitation entirely through the production UI
  [chromium] › e2e/social.spec.ts:351:3 › social platform › 14. a completed invitation cannot be restarted through the production path
  [chromium] › e2e/social.spec.ts:370:3 › social platform › 15. a full page reload preserves messages without minting duplicate ids
  [chromium] › e2e/social.spec.ts:40:3 › social platform › 2. a completed favor writes memory, trust, a follow-up message
  [chromium] › e2e/social.spec.ts:67:3 › social platform › 3. an abandoned favor is a no-show (negative memory) + low tiers are refused
  [chromium] › e2e/social.spec.ts:93:3 › social platform › 4. a preferred gift lifts affinity; a repeat same-day gift is anti-farmed
  [chromium] › e2e/store-robbery.spec.ts:108:3 › store robbery › 2 — a holstered weapon never starts a robbery
  [chromium] › e2e/store-robbery.spec.ts:125:3 › store robbery › 3 — aiming from outside the store never starts a robbery
  [chromium] › e2e/store-robbery.spec.ts:140:3 › store robbery › 4 — blocked line of sight (behind a shelf) never starts a robbery
  [chromium] › e2e/store-robbery.spec.ts:147:3 › store robbery › 5 — the register pays exactly once
  [chromium] › e2e/store-robbery.spec.ts:165:3 › store robbery › 6 — arrest loses unsecured proceeds
  [chromium] › e2e/store-robbery.spec.ts:183:3 › store robbery › 7 — a robbed store goes on cooldown (register stays empty)
  [chromium] › e2e/store-robbery.spec.ts:203:3 › store robbery › 8 — the store interior is not a wanted-clear exploit
  [chromium] › e2e/store-robbery.spec.ts:218:3 › store robbery › 9 — the Waterfront kiosk reuses the same framework
  [chromium] › e2e/store-robbery.spec.ts:237:3 › store robbery › 10 — Corner Take wraps the robbery via observed events + pays a bonus
  [chromium] › e2e/store-robbery.spec.ts:273:3 › store robbery › 11 — saving is blocked while carrying unsecured proceeds
  [chromium] › e2e/store-robbery.spec.ts:71:3 › store robbery › 1 — convenience-store robbery end to end (threat → loot → secure)
  [chromium] › e2e/streaming-safety-ring.spec.ts:18:3 › streaming safety ring › coverage invariant holds around the active subject (spawn + a district)
  [chromium] › e2e/streaming-safety-ring.spec.ts:35:3 › streaming safety ring › delayed readiness opens a coverage gap + typed anomaly, then recovers
  [chromium] › e2e/traffic-routing.spec.ts:100:3 › cross-district traffic routing › red signal stops a routed car at the line without replanning; green resumes it
  [chromium] › e2e/traffic-routing.spec.ts:155:3 › cross-district traffic routing › a pedestrian in the connector crossing stops routed traffic and never causes a replan
  [chromium] › e2e/traffic-routing.spec.ts:189:3 › cross-district traffic routing › a blocked segment diverts new plans while the alternative exists
  [chromium] › e2e/traffic-routing.spec.ts:212:3 › cross-district traffic routing › missed turn: a teleported car re-anchors onto the graph and keeps a valid route
  [chromium] › e2e/traffic-routing.spec.ts:236:3 › cross-district traffic routing › 120-second mixed-fleet soak: motion, trips, zero overlaps, stable registries
  [chromium] › e2e/traffic-routing.spec.ts:30:3 › cross-district traffic routing › boots a mixed fleet: routed cars with plans, loop cars untouched
  [chromium] › e2e/traffic-routing.spec.ts:362:3 › cross-district traffic routing › apartment transition and rain leave routing intact
  [chromium] › e2e/traffic-routing.spec.ts:55:3 › cross-district traffic routing › central → north freight: connector + arterial T traversal completes a trip
  [chromium] › e2e/traffic.spec.ts:10:3 › traffic › an ambient car brakes for the player instead of driving through them
  [chromium] › e2e/traffic.spec.ts:120:3 › traffic › cars stop at red and proceed on green
  [chromium] › e2e/traffic.spec.ts:162:3 › traffic › signalled crossing: NPC waits on dont-walk, crosses on walk, car holds, then resumes
  [chromium] › e2e/traffic.spec.ts:230:3 › traffic › Officer Kim uses the west crosswalk with signal etiquette
  [chromium] › e2e/traffic.spec.ts:66:3 › traffic › ambient car follows the driven car without ever overlapping it
  [chromium] › e2e/vehicles-soak.spec.ts:56:1 › vehicle lifecycle soak — invariants hold over 200 game-days
  [chromium] › e2e/vehicles.spec.ts:105:3 › Vehicle Ownership v1 › §7 buying refuses when the model is out of stock
  [chromium] › e2e/vehicles.spec.ts:111:3 › Vehicle Ownership v1 › §4 buying away from a dealership bay is refused (no remote phone commerce)
  [chromium] › e2e/vehicles.spec.ts:118:3 › Vehicle Ownership v1 › §8 reloading after a purchase cannot double-charge or duplicate the asset
  [chromium] › e2e/vehicles.spec.ts:130:3 › Vehicle Ownership v1 › §9 the owned-vehicle cap of four is enforced readably
  [chromium] › e2e/vehicles.spec.ts:143:3 › Vehicle Ownership v1 › §31 trade-in swaps one vehicle for another atomically — count unchanged, net price charged
  [chromium] › e2e/vehicles.spec.ts:155:3 › Vehicle Ownership v1 › §32 a trade reload cannot double-credit or resurrect the old asset
  [chromium] › e2e/vehicles.spec.ts:173:3 › Vehicle Ownership v1 › §10 an unowned shell drives exactly the legacy Compact baseline
  [chromium] › e2e/vehicles.spec.ts:182:5 › Vehicle Ownership v1 › §10 driving an owned veh_scooter projects distinct class tuning + footprint (maxSpeed 11)
  [chromium] › e2e/vehicles.spec.ts:182:5 › Vehicle Ownership v1 › §10 driving an owned veh_sports projects distinct class tuning + footprint (maxSpeed 16)
  [chromium] › e2e/vehicles.spec.ts:182:5 › Vehicle Ownership v1 › §10 driving an owned veh_van projects distinct class tuning + footprint (maxSpeed 12)
  [chromium] › e2e/vehicles.spec.ts:196:5 › Vehicle Ownership v1 › §11 enter, drive and exit an owned veh_compact through production world actions
  [chromium] › e2e/vehicles.spec.ts:196:5 › Vehicle Ownership v1 › §11 enter, drive and exit an owned veh_scooter through production world actions
  [chromium] › e2e/vehicles.spec.ts:196:5 › Vehicle Ownership v1 › §11 enter, drive and exit an owned veh_sports through production world actions
  [chromium] › e2e/vehicles.spec.ts:196:5 › Vehicle Ownership v1 › §11 enter, drive and exit an owned veh_van through production world actions
  [chromium] › e2e/vehicles.spec.ts:208:3 › Vehicle Ownership v1 › §12 switching active vehicles is allowed only through a stopped park/retrieve flow
  [chromium] › e2e/vehicles.spec.ts:223:3 › Vehicle Ownership v1 › §13 only one physical shell is active after repeated switching
  [chromium] › e2e/vehicles.spec.ts:243:3 › Vehicle Ownership v1 › §14 home parking works at a residence anchor
  [chromium] › e2e/vehicles.spec.ts:252:3 › Vehicle Ownership v1 › §15 public parking across districts persists through reload
  [chromium] › e2e/vehicles.spec.ts:264:3 › Vehicle Ownership v1 › §16 an occupied parking anchor refuses a second car without state loss
  [chromium] › e2e/vehicles.spec.ts:279:3 › Vehicle Ownership v1 › §17 retrieval is refused away from the vehicle — the phone never free-teleports it
  [chromium] › e2e/vehicles.spec.ts:287:3 › Vehicle Ownership v1 › §18 a parked car with an unknown anchor recovers safely and exactly once
  [chromium] › e2e/vehicles.spec.ts:299:3 › Vehicle Ownership v1 › §19 condition damage applies to the correct owned asset and persists
  [chromium] › e2e/vehicles.spec.ts:313:3 › Vehicle Ownership v1 › §20 a disabled vehicle cannot be retrieved until repaired at the service location
  [chromium] › e2e/vehicles.spec.ts:330:3 › Vehicle Ownership v1 › §21 repair restores condition, charges the quote, and cannot duplicate across reload
  [chromium] › e2e/vehicles.spec.ts:347:3 › Vehicle Ownership v1 › §22 an arrest while driving impounds only the involved owned vehicle, exactly once
  [chromium] › e2e/vehicles.spec.ts:362:3 › Vehicle Ownership v1 › §23 impound release requires the displayed fee and restores the car safely
  [chromium] › e2e/vehicles.spec.ts:376:3 › Vehicle Ownership v1 › §24 an owned vehicle is never a stealable identity and cannot be traded once stolen
  [chromium] › e2e/vehicles.spec.ts:385:3 › Vehicle Ownership v1 › §26 switching owned → stolen → owned preserves both identities and all property
  [chromium] › e2e/vehicles.spec.ts:401:3 › Vehicle Ownership v1 › §27 cargo transfer uses real stack/capacity rules and persists with no loss
  [chromium] › e2e/vehicles.spec.ts:412:3 › Vehicle Ownership v1 › §28 the Van carries far more cargo than a Scooter, and overflow past the Scooter cap is refused
  [chromium] › e2e/vehicles.spec.ts:429:3 › Vehicle Ownership v1 › §29 paint and wheel changes render and persist
  [chromium] › e2e/vehicles.spec.ts:447:3 › Vehicle Ownership v1 › §30 upgrades apply exact effects, are one-per-category, and carry no duplicate charge
  [chromium] › e2e/vehicles.spec.ts:464:3 › Vehicle Ownership v1 › §30 a Sport Tune is refused on the Van (class disallows it)
  [chromium] › e2e/vehicles.spec.ts:471:3 › Vehicle Ownership v1 › §30 a cargo-rack upgrade raises cargo capacity
  [chromium] › e2e/vehicles.spec.ts:480:3 › Vehicle Ownership v1 › §35 customizing is refused during a pursuit (transition/activity conflict)
  [chromium] › e2e/vehicles.spec.ts:492:3 › Vehicle Ownership v1 › §33 the delivery-vehicle pay advantage is visible, deterministic, and capped
  [chromium] › e2e/vehicles.spec.ts:532:3 › Vehicle Ownership v1 › §34 Give a Ride is invited, started, and completed entirely through the social UI
  [chromium] › e2e/vehicles.spec.ts:549:3 › Vehicle Ownership v1 › §34 an arrest during a UI-started ride cleanly removes the passenger
  [chromium] › e2e/vehicles.spec.ts:558:3 › Vehicle Ownership v1 › §36 save/load while parked and impounded leaves no duplicate shell or asset
  [chromium] › e2e/vehicles.spec.ts:576:3 › Vehicle Ownership v1 › §37 the DEV report exposes no duplicate parking anchors across the fleet
  [chromium] › e2e/vehicles.spec.ts:586:3 › Vehicle Ownership v1 › §5 the Garage phone app lists the dealership and owned vehicles
  [chromium] › e2e/vehicles.spec.ts:59:3 › Vehicle Ownership v1 › §1 a new game owns no vehicles, the registry is valid, and the loop is on foot
  [chromium] › e2e/vehicles.spec.ts:68:3 › Vehicle Ownership v1 › §5 the dealership listing shows real price, and the premium Sports car is locked with a reason
  [chromium] › e2e/vehicles.spec.ts:77:3 › Vehicle Ownership v1 › §6 buying a Compact charges exactly its price, mints one asset with a receipt, and parks it at a dealer bay
  [chromium] › e2e/vehicles.spec.ts:91:3 › Vehicle Ownership v1 › §6 buying decrements real dealership stock
  [chromium] › e2e/vehicles.spec.ts:97:3 › Vehicle Ownership v1 › §7 buying refuses on insufficient funds — no vehicle, no money moved
  [chromium] › e2e/weather.spec.ts:102:3 › weather system › weather survives save/load and old saves default to clear
  [chromium] › e2e/weather.spec.ts:117:3 › weather system › smooth transitions crossfade instead of snapping
  [chromium] › e2e/weather.spec.ts:24:3 › weather system › forcing rain updates state, UI, wetness and traffic modifiers
  [chromium] › e2e/weather.spec.ts:44:3 › weather system › rain sends avoid_rain citizens indoors and clear brings them back
  [chromium] › e2e/weather.spec.ts:6:3 › weather system › day 1 starts clear and the HUD/phone show the weather
  [chromium] › e2e/weather.spec.ts:87:3 › weather system › wetness drains gradually after the rain stops
```
