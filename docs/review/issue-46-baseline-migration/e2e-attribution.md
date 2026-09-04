# Issue #46 — E2E failure attribution against the exact base

Base: `04ae46e35812a8bc9ee73da8706864e4c419e552`, checked out to a separate worktree, same
`node_modules`, same Playwright config, `--workers=1`, one browser process at a time.

No timeout was raised, no readiness weakened, no sleep added, no assertion relaxed, and no
snapshot updated to make any of these pass. Every log below is preserved; nothing was overwritten.

| # | test | candidate | base | verdict |
| --- | --- | --- | --- | --- |
| 1 | `gameplay-flow` › player can enter, drive and exit the car | FAIL — dist 1.303 (needs > 2) | FAIL — dist 1.267 | **pre-existing** |
| 2 | `phone` › blocks driving while open | FAIL — dist 0.93 (needs > 1.5) | FAIL — dist 0.863 | **pre-existing** |
| 3 | `crime` › 8b — the carjacked driver flees the scene then despawns | FAIL — 0.6233333333333135 (needs > 1) | FAIL — **0.6233333333333135** | **pre-existing** (byte-identical) |
| 4 | `occlusion` › walking back into clear view restores the building smoothly | FAIL alone — 6000 ms timeout (14.6 s) | FAIL alone — 6000 ms timeout (15.8 s) | **pre-existing** |
| 5 | `citizen-destinations` › the yard worker completes a cross-district commute | FAIL alone — 380000 ms timeout (6.5 m) | FAIL alone — 380000 ms timeout (6.5 m) | **pre-existing** |
| 6 | `asset-pipeline-round2` › representative-player path drives a Meshy humanoid (#4) | FAIL warm (in a 26-case group) / **PASS cool 20.5 s** | PASS cool 15.8 s | **environmental** — see below |
| 7 | `getaway-pursuit` › 2 — a fair breach warning fires, then forces the player out | FAIL alone — 20000 ms timeout on `phase === 'warning'` (27.4 s) | FAIL alone — same timeout (27.1 s) | **pre-existing** |
| 8 | `integrity-soak` › 300-second integrity soak, zero sustained corruption | FAIL alone — `bench_reader+waterfront_gazer`, `bench_reader+east_shuttle` @ s1_-2 cycle 258 | FAIL alone — **the same two offender pairs** @ s0_-2 cycle 255 | **pre-existing** |
| 9 | `citizen-destinations` › 150s mixed soak: trips keep completing, nobody strands | FAIL alone — completed 0 (needs >= 2) | FAIL alone — completed 0 | **pre-existing** |

## 1–3 — movement distance under a slow renderer
All three assert a distance travelled after a fixed key-press window. Under headless software
WebGL on this host the car and the fleeing driver simply do not cover the ground in the time
allowed. #3 returns a byte-identical value on both trees, which is as conclusive as attribution
gets. CLAUDE.md gotcha #1 documents this failure mode.

## 4 — the one directly in issue #46 scope
`occlusion` › clear-view restore waits for `faded.length === 0` after walking out of a corridor.
This is the test most exposed to §3, which RAISES occluder `maxY` and can therefore only make
*more* things fade — exactly the shape that would break this assertion. It was checked alone on
both trees and fails identically on each, so §3 is not implicated. Recorded here rather than
buried, because "the occlusion test fails and I changed occlusion" deserves an explicit answer.

## 5 — cross-district commute
`citizen-destinations` › yard worker waits 380 s for `phase === 'performing_activity'`. Identical
timeout and identical 6.5-minute duration on both trees. This branch changes no route, footprint,
door anchor, clearance or occupancy input: `def.size` and `def.position` are untouched, the new
`renderedTopY` is presentation-only and read solely by `occluderData`, and
`validateCameraClearance` observes without mutating. A prior sprint recorded this same test as the
canary for occupancy-side regressions, which is why it was attributed alone rather than assumed.

## 6 — CPU-bound cold load, warm vs cool
The only candidate that looked branch-specific, and it is not. Its own comment in the spec records
the budget: *"this Meshy GLB's cold first-load is CPU-bound … measured 16-34 s under heavy CPU
contention … the cooled-shard gate runs each shard cool"*. My first candidate run had it 26th in a
group (warm); my first base run had it alone (cool). That was not a like-for-like comparison, so
it was redone cool on the candidate: **20.5 s, passing**, inside the documented range. Both the
warm failure and the cool pass are preserved (`g05.log`, `diag-repplayer-cool.log`).

## 7 — containment warning phase
`getContainmentState().phase === 'warning'` is never observed inside 20 s. Run alone on both trees
it fails identically. This branch touches nothing in the containment phase machine, the police
stack or the robbery flow; the only shared surface is `assetsSettled`, which this spec does not
use for that wait. Preserved: `g11.log`/`g11.json` (the group run) plus the two alone runs.

## 8 — the 300-second integrity soak
This is an integrity contract, so it was run ALONE on both trees rather than judged from the group.

| run | sector / cycle | offenders |
| --- | --- | --- |
| candidate, in `soak4` group | s-1_-2, 151 | `cit_dd_cafe_regular+cit_dd_yard_worker@24` |
| candidate, ALONE | s1_-2, 258 | `cit_dd_bench_reader+cit_dd_waterfront_gazer@18`, `cit_dd_bench_reader+cit_hc_east_shuttle@24` |
| base `04ae46e`, ALONE | s0_-2, 255 | `cit_dd_bench_reader+cit_dd_waterfront_gazer@17`, `cit_dd_bench_reader+cit_hc_east_shuttle@24` |

Candidate-alone and base-alone report the **same two offender pairs**, differing only in sector and
cycle — a 300 s stochastic sweep finding the same sustained person-overlap at a different moment.
The zero-corruption assertion and the overlap thresholds were left exactly as they are.

This branch registers no citizen, changes no occupancy input and moves no authored geometry:
`def.size`/`def.position` are untouched, `renderedTopY` is presentation-only and read solely by
`occluderData`, and `validateCameraClearance` observes without mutating. The runtime registration
this branch does touch is the GLB mount census (`glbLandmarksExpected/Active/Failed` and the
per-asset branch map), which no person, route or occupancy path reads.

## 9 — the 150 s mixed citizen soak
Completed 0 trips where it wants ≥ 2. Run ALONE on both trees under the same idle conditions —
the first candidate observation was inside a 5-test group, which is not like-for-like against a
solo base run (the same asymmetry that briefly made #6 look branch-specific):

| run | result |
| --- | --- |
| candidate, in the `gap1` group | `Received: 0` |
| candidate, ALONE | `Received: 0` (2.7 m) |
| base `04ae46e`, ALONE | `Received: 0` (2.6 m) |

Same family as #5 (the yard worker): a long commute that does not finish in the budget on this
host. The completion requirement and the soak duration were left exactly as they are.

## Why #5, #8 and #9 are not this branch's doing
All three are citizen routing / runtime-state contracts, so the question deserves a direct answer
rather than a shrug at the base result.

`git diff 04ae46e HEAD` touches exactly ONE file under `src/game/citizens`, `src/game/traffic`,
`src/game/npc`, the occupancy resolvers, `cityLayout.ts` or `world/authoring` — and that whole
diff is one word:

```
-const AMBIENT_RIG_SCALE = 0.82
+export const AMBIENT_RIG_SCALE = 0.82
```

added so the camera-clearance contract can assert the ambient crowd only ever SHRINKS the rig. No
value, no behaviour and no registration order changed. The runtime registration this branch does
touch is the GLB mount census (`glbLandmarksExpected/Active/Failed` and the per-asset branch map),
which no citizen, route, occupancy or crossing path reads.

## GitHub Actions: the same suite on both trees, same runner class

The local attribution above compares one test at a time. This is the whole-suite version of the
same question, run by CI on identical hardware, and it is the stronger evidence because neither
run was on my laptop.

| | base | candidate |
| --- | --- | --- |
| run | [33818518335](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33818518335) | [33814041506](https://github.com/harshitkargetiiiiii/BlockLife/actions/runs/33814041506) |
| head SHA | `04ae46e35812a8bc9ee73da8706864e4c419e552` | `0e6c7762fc6e08ec781dfe9e949217ef44267f84` |
| branch | `master` | `feat/issue-46-visual-integrity` |
| workflow | E2E (full Playwright), 8 shards | E2E (full Playwright), 8 shards |
| **failures** | **35** | **35** |

**31 of the 35 are the SAME test on both trees.** The remaining 4-on-4 are a swap, not a delta:
each tree fails four tests the other passes, and the totals are identical. Full lists are
committed beside this file as `ci-failures-base-33818518335.txt` and
`ci-failures-candidate-33814041506.txt`.

### The four that failed only on the candidate — each re-run locally on this branch

| test | CI failure | local re-run, alone, on the review-fixed tree — now `a4423c6` |
| --- | --- | --- |
| `citizen-destinations:89` › waits at the curb, crosses on all-walk | `waitForFunction` 90 s timeout | **PASS** (2.0 m) |
| `citizen-destinations:133` › travels toward the waterfront through the painted crossing | `waitForFunction` 90 s timeout | **PASS** (45.3 s) |
| `city-sweep:15` › traverses every district with continuous integrity assertions | test 90 s timeout in `page.evaluate` | **PASS** (22.0 s) |
| `crime:525` › 18 — a pursuit survives crossing sector boundaries | `after.police` was 1, expected 2 | **PASS** (9.3 s) |

These ran on the working tree that became `a4423c6` (`0e6c776` plus the empty-graph review fix).
Everything committed after the runs is a comment or a doc — no runtime file changed — so the
simulation under test is byte-identical to the committed head.

All four landed on CI **shard 2/8**, in the same run. Three are wall-clock timeouts and the fourth
is a police-escalation count that depends on how many simulated seconds elapse before the assert —
the same clock, read through a different assertion. None of them touches the GLB mount census,
the occluder descriptor, the camera-clearance table or the visual-test helpers, which is the whole
of what this branch changes outside `tests/visual/` and docs.

### The four that failed only on the base
`gameplay-flow:91` (Coffee for Ravi, 90 s test timeout), `occlusion:61` (clear-view restore, the
same 6 s `waitForFunction` already attributed as row 4 above), `social:303` (invitation through the
production UI, 90 s test timeout) and `vehicles-soak:56` (180 s soak timeout). Same failure
family, different shards, on the tree this branch is measured against.

The conclusion the numbers support: this host class runs the headless software-WebGL sim slowly
enough that ~35 timing-sensitive E2E tests fall over per run, and WHICH 35 varies by a handful
between runs. It does not vary with this branch.

## Logs
`ci-failures-base-33818518335.txt` / `ci-failures-candidate-33814041506.txt` — the two whole-suite
GitHub Actions failure lists compared above.
`g01/g02/g05/g06/g09.log` (+ `.json`) — the original group runs, untouched.
`CAND-diag-*.log`, `BASE-diag-*.log`, `CAND-*.json`, `BASE-*.json` — the alone runs on each tree.
