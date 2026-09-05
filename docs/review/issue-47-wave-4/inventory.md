# Issue #47 Wave 4 — complete visual mismatch inventory

The rule this branch follows (established by issue #46): run the **complete** visual suite with
`--no-update`, inventory **every** mismatch, build `expected | actual | diff` sheets, adjudicate
each frame individually, and only then update the images that were individually approved.

No baseline was touched before an inventory was complete. There are two of them here, because the
first one's new baselines exposed a defect in the wave (see
[`new-baselines.md`](new-baselines.md)) and everything had to be re-measured after the fix.

## How the runs are executed

A monolithic 367-test run is OOM-killed on this machine — it has ~1 GB free with the user's other
applications resident, and Playwright traces alone reached 745 MB. Every run below therefore uses a
**memory-safe batched runner**: one long-lived dev server from *this* worktree (never a shared or
inherited one — CONVENTIONS #41) plus one short-lived Playwright process per spec, `--trace=off`,
`--workers=1`, artifacts copied aside after each spec because Playwright clears `test-results/` per
run. Counts are derived from the spec files, never hardcoded, and every run reconciles
`defined == passed + failed + skipped`.

## Inventory 1 — before any baseline was touched

```
TOTALS defined=367 passed=271 failed=96 skipped=0 countsOk=1
```

| Bucket | Count | What it is |
| ------ | ----: | ---------- |
| **New Wave 4 baselines** | 75 | `wave4-asset-visuals.spec.ts` — no committed baseline exists, so these are *missing*, not *changed*. A new baseline is not an adjudicated migration and is counted separately. |
| **Existing baselines mismatching** | 21 | Real `expected` vs `actual` differences on committed images. |
| | **96** | |

### 3 of the 21 were a real determinism defect, fixed in code — not adjudicated away

Three `wave1-asset-visuals` mismatches were enter-the-car shots, and they were **not** attributable
to Wave 4 content: the shot entered a car that was still falling. `setDrivenCarPosition` seats the
car at `y = 0.8` and `VehicleController` preserves the `y` velocity, so it never settles — it
drifted 0.302 → 0.717 over 6 s, and each run screenshotted a different point of the fall (three
distinct image hashes across three identical runs).

Fixed at the cause with a shared `waitForVehicleGrounded(page)` helper (asserts `|y| <= 0.05`),
applied to every spec that drives before it shoots. All three now pass against their **untouched**
baselines, as do the four `asset-vehicle-*` shots found the same way. See CONVENTIONS #40.

**21 − 3 = 18 existing mismatches carried into adjudication:** 15 adopted, 2 refused, 1 left alone
as a pre-existing flake. See [`adjudication.md`](adjudication.md).

## Inventory 2 — after the rig-fit fix

Capturing the 75 new baselines revealed that every named resident was rendering at ~58 % of the
player's height. Fixing that changed the shipped scale of five character bodies, so the complete
inventory was re-run from scratch against the corrected build:

```
TOTALS defined=367 passed=363 failed=4 skipped=0 countsOk=1   (all 25 specs)
```

Only **four** frames mismatched, and each is accounted for:

| Image | Disposition |
| ----- | ----------- |
| `wave0-candidate-ravi-close` | **Adopted.** A Wave-0 "visual proxy only" shot of Ravi's body, which legitimately changes because that body's shipped scale changed. Inspected side-by-side: Ravi is undersized in the old frame and correctly sized against the primitive citizen beside him in the new one. |
| `painted-sports` | **Refused** — see [`flagged-customization-shots.md`](flagged-customization-shots.md). |
| `wheels-offroad` | **Refused** — same. |
| `asset-player-humanoid` | **Not attributable** — an intermittent pre-existing flake that also fails on the merge base `efda5d6` and passes on some runs of this branch. Baking one sample of a flake into a baseline would hide it. |

Every other frame that had been adopted before the fix — including all of `wave1` (17/17), `wave2`
(24/24), `wave3` (72/72), `weather` (5/5), `character-visuals`, `city-visuals` and
`mission-visuals` — still matches, so the rig fit did not silently invalidate them.

**Final tally: 16 existing baselines modified** (15 from inventory 1 + the Ravi proxy), **75 new**,
**2 refused**, **1 flake left alone**.

## How the updates were constrained

The first update attempt used one broad `-g` alternation and matched **20** tests, 3 of them
unintended — `--update-snapshots=all` rewrites every baseline it runs, including passing ones, so
that would have been a silent bulk update of 3 non-mismatching images. It was aborted and replaced
with a **per-spec, exact-title** selection verified with `--list` before running, and `git status`
was asserted to show exactly the intended count afterwards, every time.
