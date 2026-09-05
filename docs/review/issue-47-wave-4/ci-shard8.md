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

**Verdict: not proven to be a Wave 4 regression. No production code changed.**

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

## The honest residual risk

Wave 4 is a **resource** increase: `dist` grows +9.758 MiB and the mount graph gains ~30 landmark
instances, so boot has strictly more to fetch and commit than the base did. That can only move
state 3 — "still in flight" — and it makes a marginal 45 s budget more marginal. It is a plausible
contributing factor and is recorded as such. It is **not** demonstrated to be a lifecycle bug, and
the evidence is not sufficient to call it the cause.

Raising the timeout would hide exactly this distinction, so it was not touched. Nothing was re-run,
no assertion weakened, no retry added.
