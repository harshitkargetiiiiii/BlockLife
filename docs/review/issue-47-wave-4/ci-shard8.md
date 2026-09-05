# CI shard 8/8 on `d1e831c` — `assetsSettled()` boot timeout

Run [33979652484](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33979652484), job
101342508960, `E2E shard 8/8`.

```
1) tests/e2e/visual-upgrade-perf.spec.ts:55:3 ›
   issue #25 Stage A — GLB integration › the enabled GLBs survive a sector unload→reload without errors
   TimeoutError: page.waitForFunction: Timeout 45000ms exceeded.
   > 18 | await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, ...)
        at boot (tests/e2e/visual-upgrade-perf.spec.ts:18:14)
1 failed, 13 passed (6.6m)
```

**Verdict: the stalled body is identified and is NOT a Wave 4 asset. The failure is INTERMITTENT at
high frequency — 4 of 5 observed runs — not deterministic.** No production behaviour changed. A
DEV-only diagnostic is armed and captures the culprit whenever it recurs.

### Shard 8 history

| Head | Run | shard 8/8 |
| ---- | --- | --------- |
| `d1e831c` | 33979652484 | ❌ fail |
| `490b0ae` | 33981345067 | ❌ fail |
| `0934bd2` | 33982913648 | ❌ fail (first `ASSETS_NOT_SETTLED`) |
| `2ca9c43` | 33983640488 | ❌ fail (second `ASSETS_NOT_SETTLED`, null timing probe) |
| `6f74d43` | 33984155689 | ✅ **pass — 14/14** |

**The pass is not evidence of a fix.** The only changes between `2ca9c43` and `6f74d43` were the
test-only network instrument and documentation; Playwright's network events are passive observers
and cannot make a stalled GLB commit. The honest reading is that the failure is intermittent at
roughly 4-in-5, and this run drew the other side. An earlier revision of this document called it
"reproducible, not a one-off" — that overstated it and is corrected here.

Because that run passed, no `GLB_NET` line was emitted, so the three remaining causes are still
unseparated. The instrument stays in place and will report on the next failure.

## Update — second consecutive identical failure

Run [33981345067](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33981345067), job
101347042123, `E2E shard 8/8`, on head `490b0ae` — **the same `visual-upgrade-perf`
`assetsSettled()` boot timeout, on production code identical to the previous run** (the only commits
between the two heads were documentation).

This materially weakens the "unlucky sample of a flaky runner" reading. Two for two on the same
test, the same shard and the same predicate is a reproducible failure, and the honest position is
now: **something specific is holding this boot open, and the existing logs cannot say what.** The
structural analysis below still stands (the named character bodies are absent from the settle graph;
the parked bodies add no new mount/unmount shape; no new counters exist to leak), and the merge base
still times out on the same predicate — so Wave 4 is not *demonstrated* to be the cause. But
"not demonstrated" is no longer the same as "probably environmental", and it should not be read that
way.

> **Correction (Codex review, second pass).** An earlier version of this document overstated the
> evidence in two ways and mis-cited the base comparison. All three are fixed below: the shard's
> `13 passed` is **not** 13 successful runs of this boot path; "a lifecycle regression would fail
> every boot" is false for an intermittent race; and the merge-base citation now names the exact
> directly-comparable failure instead of grouping unrelated timeouts.

## Which asset states can hold `assetsSettled()` false

`isAssetGraphSettled` (`src/game/assets/assetSettle.ts`) returns false in exactly five states:

| # | State | Can Wave 4 cause it? |
| - | ----- | -------------------- |
| 1 | `expected <= 0` — no landmark instance mounted right now | No. Wave 4 only ADDS instances. |
| 2 | `epoch <= 0` — none has ever mounted | No. Same. |
| 3 | `unresolved > 0` — an id with `failed === 0` has instances neither committed nor failed | Only as *more bytes to fetch*; see below. |
| 4 | `assetGraphPending < 0` — corrupt accounting (a leaked `active`/`failed`) | No new bookkeeping; Wave 4 adds no error boundary or counter. |
| 5 | `now - changedAt < quietMs` — the mount graph is still churning | No new churn shape; see below. |

## What Wave 4 actually contributes to that graph

- **The five named character bodies contribute nothing at all.** Only `LandmarkAsset` and
  `VehicleAsset` call `noteGlbExpected`/`markGlbBranch`; `AnimatedCharacter` has **zero**
  occurrences of either. A named body can therefore never hold this predicate false.
- **The parked bodies add instances of an existing shape, not a new one.** `ParkedBody` is a pure
  pass-through — `<LandmarkAsset assetId={…}>{children}</LandmarkAsset>` — with no state, no `key`,
  and no per-render object identity, and `parkedBodyAssetId()` is a lookup into `ASSIGNMENT`, a
  `ReadonlyMap` **built once at module load**. It returns a stable string for a given placement, so
  it cannot remount the subtree and cannot move `changedAt` (state 5).
- State 3 stalls *permanently* only when a file is unreachable and no instance of that id throws
  (the documented drei-suspension case). More instances per id makes "at least one throws" more
  likely, and Wave 4's parked ids back 5–9 placements each. The one genuinely new single-instance
  landmark id is `building_gate_tower_02` — but that path would log
  `[assets] GLB for "…" failed to load`, and **the job log contains no `[assets]` warning and no
  `pageerror`**.

## What the shard's "13 passed" does and does not say

`visual-upgrade-perf.spec.ts` defines **exactly two tests**, and both call the same local `boot()`.
Shard 8's 14 tests are:

| Spec | Tests | Readiness path |
| ---- | ----: | -------------- |
| `visual-upgrade-perf.spec.ts` | 2 | this `boot()` → `ready()` then `assetsSettled()` |
| `weather.spec.ts` | 6 | its own helpers |
| `world-integrity.spec.ts` | 6 | its own helpers |

So the log supports **1 success and 1 failure of this exact boot path** — not 13 of 14. The other
12 tests are weather and world-integrity tests that do not wait on `assetsSettled()` at boot, so
they are not evidence about it in either direction. The one genuine same-path data point is that
`visual-upgrade-perf`'s first test booted and reported `PERF_CAPTURE` in this same job, on this same
runner, minutes before the second test's boot timed out.

**Retracted:** the earlier claim that "a lifecycle or accounting regression would fail every boot,
not one". That does not hold. An intermittent race — a remount landing inside the quiet window, or
a load that resolves in a different order under different timing — can fail one boot and not the
next, so a 1-of-2 result does not by itself exclude a real lifecycle defect. The reason to doubt
causality here is the structural analysis above (characters absent from the graph; no new churn
shape; no leaked counters), not the pass/fail ratio.

## Merge-base evidence: the same predicate, same budget, without any Wave 4 asset

The directly comparable data point is on `efda5d6`, the exact merge base, which contains **none** of
the Wave 4 assets — run
[33898503820](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33898503820),
`E2E shard 2/8` (job 101106761375):

```
1) tests/e2e/character-identity-v1.spec.ts:48:3 ›
   character identity & population (issue #23) › every named NPC renders the model with a distinct registry identity
   TimeoutError: page.waitForFunction: Timeout 45000ms exceeded.
   > 20 | await page.waitForFunction(() => window.GAME_TEST_API?.assetsSettled() === true, undefined, {
        at bootSettled (tests/e2e/character-identity-v1.spec.ts:20:14)
10 failed, 39 passed (42.0m)
```

That is the **same predicate** (`assetsSettled()`), at the **same 45-second budget**, timing out at
boot, on a commit with none of this branch's assets. It establishes that an `assetsSettled()` boot
timeout on this runner class pre-dates Wave 4.

Earlier revisions of this document instead cited "7 of 8 shards failed with `waitForFunction`
timeouts at 12 s–150 s". That grouping is withdrawn: those other timeouts wait on different
predicates with different budgets and are not evidence about `assetsSettled()`.

## Why the evidence still points away from causality

1. The structural analysis: the named character bodies are absent from the settle graph entirely,
   the parked bodies introduce no new mount/unmount shape, and no new counters exist to leak.
2. The same predicate times out at boot on the merge base, without any Wave 4 asset (above).
3. No `[assets]` load-failure warning and no `pageerror` in the failing job, so the "unreachable
   file leaves instances suspended" stall — the one permanent form of state 3 — is not what
   happened.
4. CI renders at ~20 fps: the passing test in this very shard reports `frameMs: 49.99, fps: 20`
   under software WebGL, so a 45-second boot budget is marginal there for the whole suite.

## The honest residual risk, quantified

The failing spec boots into the **default spawn sector `s0_0`** (stated in its own header comment),
which spans x, z ∈ [−72, 72) at `SECTOR_SIZE = 144`, `GRID_ORIGIN = −72`. Measured statically from
`cityLayout.ts` and the shipped `parkedBodyAssignment()`:

| | |
| - | - |
| parked placements declared in `cityLayout.ts` | 17 — **all 17 inside `s0_0`** |
| Wave 4 bodies they resolve to | **all four**: hatchback ×7, pickup ×8, box-truck ×1, delivery-van ×1 |
| new GLB bytes that sector must now fetch | **4.38 MiB** (0.86 + 1.14 + 1.13 + 1.25) |
| `building_gate_tower_02` | at `[34, −94]` → sector `s0_-1`, **not** in this boot |
| the four new character bodies (4.03 MiB) | outside the settle graph entirely (see above) |

So this is sharper than "the branch got bigger": **the exact sector this test boots into gained four
GLB ids and 4.38 MiB it did not have on the merge base**, and all of them are `LandmarkAsset`
instances that `assetsSettled()` genuinely waits on. That is a real, quantified increase in the work
the 45-second boot budget has to cover, and it can only move state 3, "still in flight".

It remains a **contributing factor, not a demonstrated cause**: the same predicate times out at boot
on the merge base with none of these assets (above), and no permanent-stall state is reachable here
(no `[assets]` failure, no `pageerror`, no new churn shape, no new counters). Nothing in the
existing evidence distinguishes "Wave 4 pushed a marginal budget over" from "this runner class
misses that budget anyway", and that distinction cannot be settled without a run — which is out of
scope here.

Raising the timeout would hide exactly this distinction, so it was not touched. Nothing was re-run,
no assertion weakened, no retry added.

## RESULT — the diagnostic fired, and the stalled body is NOT a Wave 4 asset

Run [33982913648](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33982913648), job
101351269316, shard 8/8, on head `0934bd2` — and again on `2ca9c43` (run 33983640488, `quietMs`
21,357). **Both failures reported an identical culprit:**

```
ASSETS_NOT_SETTLED {
  "expected":320, "active":319, "failed":0, "pending":1,
  "epoch":1917, "quietMs":19839.2,
  "glbFailed":[],
  "unresolvedByAsset":[
    {"id":"vehicle_compact_car_01","unresolved":1,"expected":1,"active":0,"failed":0}
  ]
}
```

**Exactly one instance of one id is holding readiness open: `vehicle_compact_car_01`** — the
drivable player car shell (`compact_sedan_01.glb`), committed in **Wave 0** (`5f42392`, issue #38)
and **untouched by this branch**.

What the snapshot rules out:

| Hypothesis | Verdict from the snapshot |
| ---------- | ------------------------- |
| A Wave 4 body failed to load | **No.** All four parked bodies AND `building_gate_tower_02` are in `glbActive`; `glbFailed` is empty. |
| Mount-graph churn (state 5) | **No.** `quietMs = 19,839` — the graph sat perfectly still for ~20 s against a 400 ms window. |
| A load error / unreachable file | **No.** `failed: 0`, no `[assets]` warning, no `pageerror`. |
| Corrupt accounting (state 4) | **No.** `pending: 1` is a clean, positive census. |
| Payload volume alone | **Not directly.** 319 of 320 instances committed, including every Wave 4 body. |

So the shape is the permanent single-instance suspension the module already documents: an instance
that never commits and never throws. The skip rule in `unresolvedInstances` cannot rescue it,
because that rule keys off *the same id* having a failed sibling — and the player car shell is a
**single-instance id**, so there is never a sibling to fail. That is a real blind spot, but
"resolving" a lone suspended instance is exactly the leaked-failure hole the module refuses to
reopen, so it must not be patched there.

**This is not a Wave 4 asset regression.** Wave 4 may still be a *contributing* factor — it adds
4.38 MiB across 4 GLB ids to this very sector, which changes load ordering and concurrency — but the
body that stalls is unchanged pre-existing code, and the evidence does not establish that Wave 4
causes it.

### Why no fix is being committed yet

Three distinct causes remain, and they need different fixes:

1. the request for `compact_sedan_01.glb` was **never issued** (the component suspended before the
   fetch, or the loader never started it);
2. it was **issued and never completed** (starved or hung — plausible under HTTP/1.1 per-origin
   connection limits once Wave 4 adds four more GLB requests to the same sector);
3. it **completed** and the suspended component was never re-rendered to resume.

Guessing between them would mean speculative production code in the vehicle asset path — the one
place this wave has been most careful not to touch. So the next measurement is shipped instead.

## The diagnostic added to settle it

Two identical failures with no usable evidence is the actual blocker: a bare timeout reports only
THAT the graph never settled. So this branch now adds, **DEV-only and behaviour-free**:

- `unresolvedByAsset(perAsset)` in `src/game/assets/assetSettle.ts` — the per-id breakdown of
  `unresolvedInstances`, i.e. of the exact number readiness blocks on. It is a **separate** function
  from `unresolvedInstances` on purpose: that one is on the live readiness path and a diagnostic
  must not risk changing what it returns. A unit test asserts the two **always** agree, across eight
  censuses including a corrupt one, so they cannot drift.
- `getAssetReadiness().unresolvedByAsset` on the DEV test API. The pre-existing `glbPending` field
  answers a different question — it is the RAW `expected − active − failed`, so it also lists ids
  that do **not** block readiness (an id with a failure is deliberately treated as resolved) — which
  is precisely why it could not have answered this.
- `visual-upgrade-perf.spec.ts`'s `boot()` now logs `ASSETS_NOT_SETTLED <snapshot>` **on timeout and
  rethrows the original error**. The predicate, the timeout and the failure are unchanged; the report
  runs strictly after the wait has already lost, so it cannot turn a red run green.

Verified without a browser: `tsc -b --force` clean, `oxlint` clean, the settle/contract/clearance
unit files pass 67/67, and `dist` contains **neither** `GAME_TEST_API` **nor** `unresolvedByAsset`
(0 matches each), so none of this reaches production.

**Outcome: it named a pre-existing id** (`vehicle_compact_car_01`), so by the criterion set out
before the run, this is not Wave 4's asset regression. See the RESULT section above.

## RESULT 2 — the network question is closed: the bytes arrive, the instance never commits

Run [33984584811](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33984584811), job
101355702332, shard 8/8, head `9ac1d76`. **All eight shards failed** in this run.

```
GLB_NET  requested: 32   finished: 32   failed: []   outstanding: []
ASSETS_NOT_SETTLED  expected:320 active:319 failed:0 pending:1  quietMs:16374
  unresolvedByAsset:[{"id":"vehicle_compact_car_01","unresolved":1,"expected":1,"active":0,"failed":0}]
```

Every GLB — `compact_sedan_01.glb` included — completed its HTTP response, and nothing was
outstanding or failed. Of the three causes, two are eliminated:

| Cause | Status |
| ----- | ------ |
| request never issued | **ruled out** — it is in `requested` |
| issued, never completed (starvation / hung connection) | **ruled out** — it is in `finished`, `outstanding` is empty |
| arrived, but the instance never committed | **the remaining case** |

**This also eliminates the one mechanism by which Wave 4 could plausibly have contributed.** The
concurrency hypothesis — that Wave 4's four extra GLB requests to this sector starve an older one
under HTTP/1.1 per-origin limits — required an unfinished request. There are none.

Read narrowly: `requestfinished` means the response body completed, and nothing more. It does **not**
establish that the GLTF parsed, that drei's cached promise resolved, or that the suspended component
re-rendered. Those three remain, all in unchanged pre-existing `VehicleAsset`/drei code, and the
snapshot is consistent with all of them (`active: 0`, `failed: 0`, graph still for 16.4 s).

**Two limits of this instrument, stated so the next reader does not over-trust it.** It keys on
filename in a `Set`, so a *second* request for the same file is invisible — a remount re-fetch would
not show — and it records no counts or timings. The failing test also moved from the 2nd in the spec
to the 1st, so this is the boot path, not one test.

## Base vs candidate, and why the diff cannot attribute anything

| | base `efda5d6` (33898503820) | candidate `9ac1d76` (33984584811) |
| - | - | - |
| shards failing | 7 of 8 | **8 of 8** |
| distinct failing tests | 35 | 48 |

- **33 fail on both** — pre-existing.
- **2 fail only on base**: `crime` "8b — the carjacked driver flees the scene then despawns";
  `density` "traffic keeps flowing with citizens registered as pedestrians".
- **14 fail only on the candidate**, including `careers` café shift, `missions` save/load ×2,
  `save-load` HUD buttons, `sectors` boundary crossing, `expansion` streaming cycles, `vehicles`
  §34 Give a Ride, `traffic` Officer Kim crosswalk, and Wave 4's own
  "a streaming unload → reload leaves no stale active/failed state".

**That 14 is not a regression count, and this branch can now prove why rather than assert it.**
Shard 8 **passed 14/14** on run 33984155689 (head `6f74d43`) and **failed** on run 33984584811 (head
`9ac1d76`) — and those two heads differ **only by a documentation commit**. Same effective code,
opposite outcomes on consecutive runs. With one sample per side, a base-vs-candidate diff of a suite
that behaves like this cannot attribute individual tests in either direction; the two "fixed" tests
are equally meaningless as evidence.

### Bounded conclusion

Supported by the evidence: the stall is real; the body holding readiness open is
`vehicle_compact_car_01`, **Wave 0 code untouched by this branch**; every Wave 4 body is in
`glbActive`; `glbFailed` is empty; and the bytes arrive over the network. Not supported: any
attribution of the 14 candidate-only failures, in either direction, from single samples.

The one Wave-4-authored new failure — "a streaming unload → reload leaves no stale active/failed
state" — is worth a closer look precisely because it is thematically adjacent to a
never-committed branch. On one sample it is not yet evidence.

### Proposed next step (NOT implemented)

Separating "Wave 4 contributes" from "this suite is intermittent" needs repeated sampling, which is
out of scope here. The cheapest non-rerun step that would still advance it: log the request **count**
per GLB filename and whether a second `compact_sedan_01.glb` request occurred, which distinguishes a
remount re-fetch from a single never-resumed load and closes the instrument gap noted above.
Test-only, ~5 lines. No production change is proposed until that ambiguity is resolved.

### The first timing probe returned a NULL result — my instrument was wrong

Run 33983640488 (job 101353197531, shard 8/8, head `2ca9c43`) reproduced the stall a **fourth**
time, with an identical `unresolvedByAsset` naming `vehicle_compact_car_01` (`quietMs` 21,357).
The new probe reported:

```
GLB_TIMING {"requested":0,"neverFinished":[],"slowest":[]}
```

**That is an artifact, not a finding.** Zero `.glb` resource entries while 319 GLB instances are
active is self-contradictory. The cause is `resourceTimingBufferSize`, which defaults to **250**
entries: under the Vite dev server hundreds of ES modules are requested before the first GLB, the
buffer fills, and every later entry — including all the GLBs — is silently dropped.
`performance.getEntriesByType('resource')` was the wrong instrument for this page.

It is replaced with Playwright-side network events (`request` / `requestfinished` /
`requestfailed`), attached before navigation, which have no buffer limit. On timeout `boot()` now
logs `GLB_NET` with `requested`, `finished`, `failed`, and — the field that answers the question —
`outstanding`: requested but never finished.

### The diagnostic, now shipped

`boot()` logs `GLB_NET` on timeout, from Playwright's own network events. That separates the three
remaining causes directly:

| `GLB_NET` shows for `compact_sedan_01.glb` | Cause | Fix belongs to |
| ------------------ | ----- | -------------- |
| absent from `requested` | the request was never issued | the loader / suspense path |
| in `outstanding` (requested, never finished) | issued, never completed — starvation or a hung connection | request concurrency; Wave 4's +4 requests to this sector are then a real contributing factor |
| in `finished` | the file arrived and the component never resumed | React/drei resume in `VehicleAsset` |

Test-only, in the same already-failed catch block, original error still rethrown. No production
code, no predicate, timeout, retry, asset, mapping, wardrobe or baseline change.
