# E2E render-suppression — causal audit (durable record)

Why the `@simulation-only` partition is **29 tests, not 325**. The earlier rollout tagged whole
files/describes (325 suppressed); this document is the per-test *causal* re-derivation that replaced it
with the minimal set. Evidence sources: master normal-render run **32395852501** (336/367, 31 hard
failures), suppressed runs **32543246143**@`f0cdf36` (363/367) and **32545535805**@`6ac0553` (360/367),
and the exhaustive audit (`docs/e2e-simulation-only.md`).

## Causal eligibility rule (all must hold to tag `@simulation-only`)
1. **Render-independent verdict** — independent of visible rendering AND renderer-backed behavior (scene
   visibility, model loading, LOD, raycasting, animation presentation, renderer state, WebGL) — *not*
   merely "compares no pixels."
2. **Necessary** — requires meaningful world/simulation progress that the software renderer starves.
3. **Starvation, not a defect** — the normal-run failure is consistent with throughput starvation, not an
   unrelated product/fixture/assertion defect.
4. **Invariant-preserving** — suppression preserves the same domain invariant; it does not merely make the
   test pass differently.
5. **A/B-supported** — historical A/B evidence backs the decision; if inconclusive, default to normal.

A master failure **alone** is insufficient. The strongest positive evidence is *failed on master
(normal) + passed under suppression* (points 2+3+5 together): suppression demonstrably fixes a starvation
failure. A long **soak may stay suppressed even when it exposes a genuine product-invariant failure** —
suppression is required to reach the invariant within the wall-clock budget; suppression **exposes** the
defect, it does not fix or excuse it.

## Causal matrix — all 31 master failures
`master` = normal-render outcome on 32395852501. `f0/6a` = suppressed outcome on f0cdf36 / 6ac0553.
Partition: **SIM** = `@simulation-only`; **NORMAL** = default.

| # | test | master | f0 | 6a | needs sim progress (mechanism) | render-backed? | partition | evidence |
|---|---|:--:|:--:|:--:|---|:--:|:--:|---|
| 1 | authoring:73 routed traffic drives the compiled road | FAIL | P | P | yes — routed car must traverse the compiled road | no | **SIM** | fixed by suppression (P/P) |
| 2 | citizen-destinations:89 waits at curb, crosses, reaches dest | FAIL | P | P | yes — pedestrian walk + cross to destination | no | **SIM** | P/P |
| 3 | citizen-destinations:165 yard-worker cross-district commute | FAIL | P | **F** | yes — long cross-district commute in window | no | **SIM** | P/F run-variable; suppression can complete it (f0 P) |
| 4 | citizen-destinations:318 150s mixed soak | FAIL | P | P | yes — soak needs real trip progress | no | **SIM** | P/P |
| 5 | crime:120 police arrest a cornered, stopped suspect | FAIL | P | P | yes — pursuit + arrest sequence over time | no | **SIM** | P/P |
| 6 | crime:201 carjacked driver flees then despawns | FAIL | P | P | yes — flee + despawn over time | no | **SIM** | P/P |
| 7 | crime:429 Ravi flees gunfire then recovers | FAIL | P | P | yes — flee + recover over time | no | **SIM** | P/P |
| 8 | crime-soak:11 180s crime soak | FAIL | P | P | yes — soak asserts arrests/recoveries progress | no | **SIM** | P/P |
| 9 | districts:34 drive Central→east connector→Market | FAIL | P | P | yes — long player drive across districts | no | **SIM** | P/P |
| 10 | districts:95 ambient car residential loop + stop | FAIL | P | P | yes — car drives a loop, holds at stop | no | **SIM** | P/P |
| 11 | districts:151 Officer Kim patrols into Residential | FAIL | P | P | yes — Kim walks a patrol route | no | **SIM** | P/P |
| 12 | expansion:160 routed freight trip to Industrial Yard | FAIL | P | P | yes — long routed freight drive | no | **SIM** | P/P |
| 13 | expansion:200 routed trip to Waterfront | FAIL | P | P | yes — long routed drive | no | **SIM** | P/P |
| 14 | expansion:355 large-world soak: routed trips | FAIL | P | P | yes — soak needs routed trips completing | no | **SIM** | P/P |
| 15 | gameplay-flow:11 moves with keyboard, runs with shift | FAIL | P | P | yes — **distance/wall-clock**: hold 'w' 600ms → moved >1u | no | **SIM** | P/P; at 0.05× moves ~0.08u |
| 16 | gameplay-flow:53 gym/job/apartment interactions | FAIL | P | P | yes — **cumulative** frame-gated interaction waits < 90s | no | **SIM** | P/P; 5 sequential waitForActiveInteractable at 1 FPS blow the timeout |
| 17 | getaway-pursuit:54 containment arms and advances | FAIL | P | P | yes — pursuit phase machine over time | no | **SIM** | P/P |
| 18 | getaway-pursuit:77 breach warning fires, forces out | FAIL | P | P | yes — pursuit phases over time | no | **SIM** | P/P |
| 19 | integrity-soak:14 300s integrity soak | FAIL | **F** | **F** | yes — soak must cycle the city to reach invariants | no | **SIM** | soak needs suppression to run; **exposes a real overlap defect** (documented, not fixed) |
| 20 | intersections:55 red approach stops a routed car | FAIL | P | P | yes — car drives to the stop line under red | no | **SIM** | P/P |
| 21 | intersections:112 a routed trip TURNS through the intersection | FAIL | P | P | yes — routed drive + turn | no | **SIM** | P/P |
| 22 | phone:11 opens/switches/closes, movement resumes | FAIL | P | P | yes — **distance/wall-clock**: hold 'w' 500ms → moved >1u | no | **SIM** | P/P; DOM nav passes anyway, the move-resume assertion starves at 0.05× |
| 23 | traffic:10 ambient car brakes for the player | FAIL | **F** | **F** | yes — car must drive up to the player to brake | no | **SIM** | master fail = car never approached (starvation); suppressed reveals a **dt braking-margin** red (1.31<1.8) — product hardening follow-up |
| 24 | traffic:66 ambient car follows driven car, no overlap | FAIL | P | P | yes — both cars drive | no | **SIM** | P/P |
| 25 | traffic:120 cars stop at red and proceed on green | FAIL | P | P | yes — car drives x=−12→stop line, then clears | no | **SIM** | P/P; at 0.05× the car can't reach the stop line in the 15s wait |
| 26 | traffic:230 Officer Kim uses the west crosswalk | FAIL | P | P | yes — Kim walks to + across the crosswalk | no | **SIM** | P/P; at 0.05× she can't reach `waiting_to_cross`/finish crossing in the waits |
| 27 | traffic-routing:55 central→north freight traversal | FAIL | P | P | yes — long routed freight drive | no | **SIM** | P/P |
| 28 | traffic-routing:100 red signal stops a routed car | FAIL | P | P | yes — car drives to the stop line | no | **SIM** | P/P |
| 29 | traffic-routing:236 120s mixed-fleet soak | FAIL | P | P | yes — soak needs motion/trips | no | **SIM** | P/P |
| 30 | asset-pipeline-round2:74 player drives a Meshy humanoid, never fallback | FAIL | P(n) | **F(n)** | mixed — asserts **which model rendered** + drives a path | **YES** | **NORMAL** | render-backed (model/fallback) → NOT eligible; run-variable under SwiftShader |
| 31 | population-soak:46 rigged population LOD promote/demote | FAIL | F(n) | F(n) | mixed — asserts **LOD render presentation** over a soak | **YES** | **NORMAL** | render-backed (LOD) → NOT eligible; software renderer can't finish |

`(n)` = ran in the NORMAL partition of that suppressed run (no suppression). `P`=passed, `F`=failed.

## Extra scrutiny (could not be tagged for failing master alone)
- **phone:11 / gameplay-flow:11** — explicit *distance-over-wall-clock* assertions (`hold 'w' → moved
  > 1 unit`); at 0.05× the player moves ~0.06–0.08 u and fails. Render-independent (position via
  `getStats`, DOM clicks). Suppressed P/P. → SIM.
- **gameplay-flow:53** — five sequential `waitForActiveInteractable` + interaction steps; at 1 FPS the
  cumulative frame-gated waits exceed the 90s test timeout. Render-independent. Suppressed P/P. → SIM.
- **traffic:120 / traffic:230** — a car must drive to the stop line / Officer Kim must walk to and across
  the crosswalk within 10–15s waits; at 0.05× neither reaches its state. Render-independent (traffic
  state). Suppressed P/P. → SIM.

## Kept NORMAL despite failing master (this PR does not split/repair them)
`getaway-pursuit:196` and `pedestrian-crossings:142` **passed on master** and failed only under
suppression → not necessary, consistent with over-suppression → NORMAL. `population-soak:46` and
`asset-pipeline-round2:74` are **render-backed** (LOD / which-model) → not eligible → NORMAL; splitting
them into a short render assertion + a separate suppressible progress test is a proposed follow-up, out of
scope here.

## Final counts
**simulation-only: 29 · normal-render: 338 · total: 367** (exact-once, empty intersection, complete
union — `scripts/e2e-partition-check.mjs`). Known reds that remain under this partition are pre-existing
and out of scope: `integrity-soak:14` (real overlap, SIM), `traffic:10` (dt margin, SIM),
`population-soak:46` + `asset-pipeline-round2:74` (render, NORMAL), `citizen-destinations:165` +
`pedestrian-crossings:142` (run-variable). None is fixed here.
