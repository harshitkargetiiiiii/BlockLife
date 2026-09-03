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
| 9 | `citizen-destinations` › 150s mixed soak: trips keep completing, nobody strands | FAIL — completed 0 (needs >= 2) | FAIL alone — completed 0 | **pre-existing** |

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
Completed 0 trips where it wants ≥ 2, identically on both trees. Same family as #5 (the yard
worker): a long commute that does not finish in the budget on this host.

## Logs
`g01/g02/g05/g06/g09.log` (+ `.json`) — the original group runs, untouched.
`CAND-diag-*.log`, `BASE-diag-*.log`, `CAND-*.json`, `BASE-*.json` — the alone runs on each tree.
