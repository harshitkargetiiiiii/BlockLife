# E2E `@simulation-only` partition (minimal, causal)

The E2E suite (**367** tests) is split into two render-eligibility partitions, verified exact-once by
`scripts/e2e-partition-check.mjs`:

| partition | selector | rendering | count |
|---|---|---|---|
| **simulation-only** | `--grep @simulation-only` | **suppressed** after settle (draw calls → 0; useFrame/physics/directors keep running) | **29** |
| **normal-render** | `--grep-invert @simulation-only` | normal software WebGL | **338** |

`29 + 338 = 367`, empty intersection, complete union. **Default is normal rendering.** A test is
`@simulation-only` only when it is **causally validated** as (1) render-independent — including
renderer-backed behavior (scene visibility, model loading, LOD, raycasting, animation, renderer state,
WebGL), not merely pixel-free; (2) demonstrably starved by the software renderer; (3) a starvation
failure, not a product/fixture/assertion defect; (4) invariant-preserving under suppression; (5) backed
by A/B evidence. The full per-test derivation over the 31 master failures is in
[`e2e-suppression-audit.md`](e2e-suppression-audit.md). Tags are applied **per test**, never per file or
describe.

## The 29 simulation-only tests (each starves on the software renderer, all render-independent)
Mechanism in brackets. All were master-run failures **fixed by suppression** (passed suppressed) except
the three noted reds, which are pre-existing and out of scope here.

- `authoring:73` routed traffic drives the compiled road [routed traversal]
- `citizen-destinations:89` waits at curb, crosses, reaches destination [pedestrian walk+cross]
- `citizen-destinations:165` yard-worker cross-district commute [long commute] — *run-variable red*
- `citizen-destinations:318` 150s mixed soak [soak progress]
- `crime:120` police arrest a cornered suspect [pursuit+arrest]
- `crime:201` carjacked driver flees then despawns [flee over time]
- `crime:429` Ravi flees gunfire then recovers [flee+recover]
- `crime-soak:11` 180s crime soak [soak progress]
- `districts:34` drive Central→east→Market [long drive]
- `districts:95` ambient car residential loop + stop [drive loop]
- `districts:151` Officer Kim patrols into Residential [walk patrol]
- `expansion:160` routed freight trip to Industrial Yard [long routed drive]
- `expansion:200` routed trip to Waterfront [long routed drive]
- `expansion:355` large-world soak: routed trips [soak progress]
- `gameplay-flow:11` moves with keyboard, runs with shift [distance/wall-clock: >1u]
- `gameplay-flow:53` gym/job/apartment interactions [cumulative frame-gated waits < 90s]
- `getaway-pursuit:54` containment arms and advances [pursuit phases]
- `getaway-pursuit:77` breach warning fires, forces out [pursuit phases]
- `integrity-soak:14` 300s integrity soak [soak] — *exposes a real overlap defect (SIM to reach it)*
- `intersections:55` red approach stops a routed car [drive to stop line]
- `intersections:112` routed trip TURNS through the intersection [routed drive+turn]
- `phone:11` opens/switches/closes, movement resumes [distance/wall-clock: >1u]
- `traffic:10` ambient car brakes for the player [car must approach] — *dt braking-margin red*
- `traffic:66` ambient car follows the driven car, no overlap [both drive]
- `traffic:120` cars stop at red and proceed on green [drive to stop line + clear]
- `traffic:230` Officer Kim uses the west crosswalk [walk to+across crosswalk]
- `traffic-routing:55` central→north freight traversal [long routed drive]
- `traffic-routing:100` red signal stops a routed car [drive to stop line]
- `traffic-routing:236` 120s mixed-fleet soak [soak progress]

## Kept NORMAL although they failed on master
- `getaway-pursuit:196`, `pedestrian-crossings:142` — **passed on master**, failed only under suppression
  → not necessary (consistent with over-suppression). Normal.
- `population-soak:46` (LOD), `asset-pipeline-round2:74` (which-model) — **render-backed** → not eligible.
  Normal. A future split (short render assertion + separate suppressible progress test) is proposed, not
  done here.

## Workflow (single authoritative gate `e2e.yml`)
Two partitions run independently: **normal-render ×8 shards**, **simulation-only ×2 shards** (listed
16/13), `--workers=1 --retries=0 --forbid-only`, fail-fast:false, timeouts unchanged. Suppression
(`VITE_SUPPRESS_AFTER_SETTLE=1`) is set **only** in the simulation-only job. A `suppression-guard` job
runs the guard spec WITHOUT the env (proves default-off + restore). Each shard's JSON report is asserted
clean (0 failed/skipped/flaky, >0 ran) by `scripts/assert-playwright-run.mjs`; a fail-closed conclusion
requires every job green. Production-bundle exclusion of the diagnostic/suppression/test APIs is proven
by the required companion gate `ci.yml` (not duplicated here). The temporary `e2e-branch-validation.yml`
has been removed.

## Historical observations (superseded SHAs, broad 325/42 partition — NOT current)
`32543246143`@f0cdf36 = 363/367 and `32545535805`@6ac0553 = 360/367 ran the earlier **325-suppressed**
partition. They are diagnostic history, not the current 29/338 gate, and not exact-head certifications.
