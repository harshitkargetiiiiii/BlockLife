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

**Verdict: not proven to be a Wave 4 regression. No code changed.**

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

## Why the evidence points away from causality

1. **The same `boot()` succeeded 13 times in the same job, on the same runner, with the same
   assets.** Playwright's progress line is `·F············` — the failure is the 2nd of 14; test 1
   booted and reported `PERF_CAPTURE`, and all 12 after it booted fine. A lifecycle or accounting
   regression would fail every boot, not one.
2. **The merge base shows the same failure class, worse.** Run
   [33898503820](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33898503820) on
   `efda5d6` — which has **none** of the Wave 4 assets — failed **7 of 8 shards** with
   `page.waitForFunction` timeouts at 12 s, 15 s, 20 s, 30 s, 120 s and 150 s (11 failures in the
   three shards sampled). `waitForFunction` timeouts are a pre-existing condition of this runner
   class, not something this branch introduced. Shard 8 happened to pass there and fail here; that
   is the difference between two samples of a flaky environment, and is not evidence either way on
   its own.
3. **CI renders at ~20 fps.** The passing test in this very shard reports
   `frameMs: 49.99, fps: 20` under software WebGL. A 45-second boot budget on a runner that slow is
   marginal for the whole suite, independent of payload.

## The honest residual risk

Wave 4 is a **resource** increase: `dist` grows +9.758 MiB and the mount graph gains ~30 landmark
instances, so boot has strictly more to fetch and commit than the base did. That can only move
state 3 — "still in flight" — and it makes a marginal 45 s budget more marginal. It is a plausible
contributing factor and is recorded as such. It is **not** a lifecycle bug, and the evidence above
is not sufficient to call it the cause.

Raising the timeout would hide exactly this distinction, so it was not touched. Nothing was re-run,
no assertion weakened, no retry added.
