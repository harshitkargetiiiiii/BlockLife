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

**Verdict: cause still not established, but it is now REPRODUCIBLE, not a one-off.** No production
behaviour changed. A DEV-only diagnostic has been added so the next CI run reports which body is
holding readiness open.

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

**What to read next.** When shard 8 next fails, the log line `ASSETS_NOT_SETTLED` gives
`unresolvedByAsset` — the ids still in flight. If it names `vehicle_parked_*` ids, Wave 4 is
implicated directly and the 4.38 MiB the spawn sector gained is the mechanism. If it is empty while
`quietMs < 400`, the graph is churning and the cause is remount behaviour, not payload. If it names
a pre-existing id, this is not Wave 4's. Each of those is a different fix, which is why guessing one
now would be wrong.
