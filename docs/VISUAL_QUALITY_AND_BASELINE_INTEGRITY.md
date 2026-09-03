# Holistic Visual Quality & Baseline Integrity Pass v1 (issue #46)

One pass over the whole city rather than another per-asset wave. Waves 0–3 shipped real bodies
and, along the way, showed that **the per-image visual gate is the only thing catching a class of
defect every static gate misses**: Wave 3 (#44) found a building tall enough to put the game
camera inside itself while `tsc`, lint, 1,563 unit tests, the asset report, the placement
validators, district certification and 365 E2E tests were all green on it. This issue turns each
of those one-off findings into standing coverage, and migrates the baseline debt Wave 3 left.

Five deliverables, in the order they build on each other.

---

## 1. The camera-clearance invariant is now structural

**Before.** `MAX_RENDERED_HEIGHT = 15.0` lived as a literal in
`scripts/asset-intake/wave3.config.mjs` and was enforced for Wave 3's six bodies. The camera
height it protects against (`18`) was retyped by hand inside `wave3Contract.test.ts`, and
`CAMERA_OFFSET` was a private constant inside `FollowCamera.tsx`. Three copies of one fact, one of
them enforced on a sixth of the manifest.

**Now.** [`src/game/camera/cameraGeometry.ts`](../src/game/camera/cameraGeometry.ts) owns the
camera's fixed diorama offset and **derives** everything else from it:

| Constant | Value | Derivation |
| --- | --- | --- |
| `CAMERA_OFFSET` | `[12, 18, 12]` | the one declaration; `FollowCamera` imports it |
| `CAMERA_EYE_HEIGHT` | `18` | `CAMERA_OFFSET[1]` |
| `CAMERA_HORIZONTAL_REACH` | `16.9706` | `hypot(CAMERA_OFFSET[0], CAMERA_OFFSET[2])` |
| `CAMERA_CLEARANCE` | `3` | declared policy — the 0.5 m roof slab plus the 6 m camera look-ahead |
| `MAX_WORLD_RENDER_HEIGHT` | `15` | `CAMERA_EYE_HEIGHT − CAMERA_CLEARANCE` |

Two gates enforce it, at the two different thresholds that actually matter:

- **Everything that renders** — [`assets/cameraClearance.test.ts`](../src/game/assets/cameraClearance.test.ts)
  re-reads every enabled manifest GLB's bounding box **from the shipped bytes** (scene-graph aware,
  from the POSITION accessor extrema the glTF spec requires), puts it through the exact
  `rotation → scale → positionOffset` chain the renderer applies, and asserts the result stays at
  or below `MAX_WORLD_RENDER_HEIGHT`. It then does the same **per placement**, composing the
  archetype projection's own Y scale and offset — the composition an entry-only check misses. It
  also pins `wave3.config.mjs`'s literal to the derived constant, so the intake tooling (plain
  node, which cannot import TypeScript) can never drift from the camera.
- **Everything authored** — `validateCameraClearance` in
  [`world/integrity/placementValidation.ts`](../src/game/world/integrity/placementValidation.ts)
  makes a `def.size` whose massing reaches the camera eye a placement FAILURE, exactly as a
  floating prop is. It runs for every building of every district through
  `validateSectorPlacement`, so `cityPlacement.test.ts` already gates the whole city.

The authored rule uses the **hard** threshold (`containsCameraEye`, 18 m) rather than the 15 m
projection ceiling, because the two are different things: an authored box is gameplay massing a
district may legitimately push tall, while a projected GLB is presentation and has no reason to
spend the clearance. The tallest authored body in the city, `building_tower_04`, massed at 17.5 m,
clears the eye by 0.5 m and passes; the tallest rendered body, the apartment at 14.9996 m, clears
the ceiling by 0.0004 m. Neither gate is passing vacuously, and both tests assert that.

**Deliberately outside the massing rule** (documented in
[`world/buildingMassing.ts`](../src/game/world/buildingMassing.ts)): the thin decorative rooftop
fittings `RooftopExtras` adds — the apartment's water tank and the towers' 2 m antenna mast with
its 0.12 m sphere. `building_tower_04`'s mast tip does reach 19.62 m, above the camera plane. It is
a few centimetres of geometry on a backdrop tower 80 m outside the play area, the orthographic
`near: -200` renders it without a cutaway, and it cannot fill the frame or hide the subject —
which is what both consumers of the constant are about. Recorded here rather than silently
excluded by a formula.

---

## 2. The occluder-height gap is closed

**The defect.** `getBuildingOccluderDescriptor` derived an occluder's `maxY` from
`def.size[1] + 0.5`. A placement whose GLB renders taller than its authored box therefore carried
mass the visibility system could not see: the sight line passed OVER the descriptor's roof while
the real facade stood in front of the player, no fade fired, and the player sat hidden behind an
opaque wall. Five shipped placements had that gap:

| Placement | Authored box top | Rendered body top | Gap |
| --- | --- | --- | --- |
| `building_apartment_01` | 8.00 | 14.9996 | **+7.00** |
| `building_gym_01` | 7.00 | 10.5587 | +3.56 |
| `building_gate_hotel_01` | 13.50 | 14.9994 | +1.50 |
| `building_townhomes_01` | 6.50 | 7.9515 | +1.45 |
| `building_house_r1` | 4.50 | 5.6214 | +1.12 |

**The decision.** Issue #46 §3 asked for an explicit choice: drive `maxY` from the projected
visual height, or prohibit a projection from exceeding its authored box. **Drive it from the
render.** Capping would re-scale six approved bodies to work around what the visibility system
measures — changing what the city looks like to fix a detection bug.

**What changed, precisely.**

- The occluder **footprint** is still `def.size` — it is the collider, the routing obstacle and
  the anchor authority, and nothing here touches it.
- `maxY` is now `max(def.size[1] + BUILDING_ROOF_EXTRA, projectedBodyTop(def))`, so it always
  covers both the GLB body and the procedural fallback that stands there when a file is missing.
- **Participation** (`enabled`) stays keyed to the authored box height. Whether a placement takes
  part in occlusion is a layout decision district certification already certifies; a taller visual
  must not silently enrol a building the city calls scenery. The occludable-id set is unchanged.
- The descriptor now resolves its manifest row through `BuildingDef.visual`, so a projected
  placement reaches its ARCHETYPE entry. A lookup on `def.id` returned `undefined` for every
  archetype placement and silently dropped any override it declared.

**Where the number comes from.** The runtime cannot measure a GLB synchronously, so each world
body's rendered top is declared as `AssetManifestEntry.renderedTopY` and **recomputed from the
shipped bytes** by `cameraClearance.test.ts`. It is not the same number as `bounds.height`:
`bounds` is a size, and a body whose pivot is off its base (`arch_residential_house_01`, lifted
2.81 m by its `positionOffset`) reaches a different height than its size suggests.

**Gates.**
[`visibility/__tests__/projectedOccluderHeight.test.ts`](../src/game/visibility/__tests__/projectedOccluderHeight.test.ts)
re-derives every projected placement's rendered top, asserts the descriptor covers it, asserts the
footprint / participation / ids are untouched, and reproduces the defect concretely: a subject
standing 15 m behind the apartment has all three of its sample heights blocked by the real body
and **zero** blocked by the old box-derived descriptor. `wave3Contract.test.ts`'s occluder clause
was restated (not relaxed) — it still recomputes the height from the committed bytes and the
derived fit, and still pins the footprint exactly.

### The evidence, and what it can and cannot show

The Wave 3 fade block now covers **all six** projected bodies, as an **A/B pair per body taken
from ONE PAUSED INSTANT** — same world clock, same HUD stats, same camera, same player, same
ambient poses, with nothing changed between the two shutters but `setOcclusionEnabled`:

| | |
| --- | --- |
| `wave3-{body}-occlusion-fade.png` | occlusion ON — the body faded (captured first) |
| `wave3-{body}-occlusion-control.png` | occlusion OFF — the body opaque |

The fade is captured **first**, and the world is never resumed between the two. An earlier
revision un-paused in between so the fade could resolve, and review caught the consequence: the
control read 13:04 / hunger 20 while the faded frame read 13:09 / hunger 21, with ambient actors
free to move — two frames that differed in more than the thing under test. Now the fade is allowed
to settle, the world is frozen once, and only then is occlusion switched off: `clearAllFades()`
restores the original materials synchronously and the disabled manager early-returns every frame
after that. The test asserts the clock, HUD stats, mode and player position were identical across
the pair, rather than claiming it in a comment.

It is a pair because **"an occluder faded" and "the fade revealed the player" are different
claims, and the first does not imply the second.** The first attempt at this evidence asserted
only the former: it waited for `getVisibilityState().faded` to report an opacity under 0.6 and
photographed the result. Review of the actual PNGs found the player floating clear of the body's
silhouette in four of the six — the assertion was true and the picture proved nothing.

The reason is structural. **The occluder is an AABB over the AUTHORED footprint; the thing on
screen is a mesh that under-fills its lot.** At the shipped aim, with the body `gap` nearer the
camera than the player, in screen-up units measured from the player's feet:

```
D = √(CAM_R² + CAM_H²)      k = CAM_R/D      m = CAM_H/D      m/k = CAM_H/CAM_R ≈ 1.0607
the body's base drops to      −m·gap
its roofline reaches           k·H − m·gap
the player's head reaches      k·SUBJECT_HEIGHT
⇒ the body covers the player iff   H ≥ SUBJECT_HEIGHT + (CAM_H/CAM_R)·gap
```

and `gap` can never be smaller than the footprint's half-extent along the camera axis, because
the player has to stand outside the collider. **A body shorter than its own lot is wide can
therefore never get in front of a subject standing outside that lot.** `fadeGeometry` in
[`tests/visual/framing.ts`](../tests/visual/framing.ts) solves this and reports `coverage`, and
the classification is pinned in the spec and unit-tested so it cannot flip silently:

| body | rendered H | authored lot | stand-off | player coverage | reveals? |
| --- | --- | --- | --- | --- | --- |
| `building_apartment_01` | 15.00 | 9 × 9 | 6.96 | 4.23× | **yes** |
| `building_gate_hotel_01` | 15.00 | 9 × 8 | 6.61 | 4.44× | **yes** |
| `building_townhomes_01` | 7.95 | 7 × 7 | 5.55 | 1.15× | **yes** |
| `building_shop_01` | 4.82 | 6 × 6 | 4.84 | 0 | no |
| `building_house_01` | 4.76 | 5.5 × 5.5 | 4.49 | 0 | no |
| `building_garage_01` | 3.78 | 8 × 7 | 5.90 | 0 | no |

For the three that can, the pair is a true reveal: the control shows the player **completely
hidden** behind an opaque facade — on the apartment, only the name label and the interact prompt
betray that anyone is there — and the faded frame shows them through the translucent body.

For the other three the pair is still worth having (it shows the fade acting on that body and
nothing else, at identical geometry) but it is **not** reveal evidence, and neither the test title
nor this document claims it is. What those three actually document is a **conservative
over-fade**: the AABB reports the body as blocking a subject its mesh cannot reach. That is a
property of the footprint-AABB occluder model, not something issue #46 introduced — but the
vertical extent this issue corrected makes the band taller, so it is recorded here rather than
left for someone to rediscover from a puzzling screenshot. Narrowing the occluder to the rendered
mesh's own footprint would be the fix, and it is a separate change: the footprint is authored
gameplay data that collision, routing and anchors all read.

---

## 3. `assetsSettled()` is no longer vacuously true

**The defect.** The predicate compared mounted-vs-committed GLB counters:
`active + failed >= expected`. That describes a moment, and a moment cannot tell "everything
committed" from "between scenes". A sector remount — `resetGame()`, a teleport, a streaming
crossing — tears the old instances down before the new ones register, so all three counters pass
through a trough reading `0`, where the comparison is **vacuously true**. Two committed baselines
were captured in that trough, each holding a procedural fallback where the GLB belongs, and Wave 3
had one spec time out at 15 s waiting for a model. Individual specs had grown their own
`waitForTimeout(1200)`-then-re-check workarounds, which is the same race with a longer fuse.

**The fix.** Any change to the mount graph — a mount, an unmount, a commit or a load failure —
now stamps `registry.glbLandmarkEpoch` and `registry.glbLandmarkChangedAt`
(`noteGlbLandmarkChange()`), and the predicate requires all three of:

1. nothing pending (`active + failed >= expected`, as before);
2. the mount graph unchanged for `ASSET_SETTLE_QUIET_MS` (400 ms) — a remount trough always
   violates this;
3. `glbLandmarkEpoch > 0` — at least one landmark has ever registered, which kills the same
   vacuity at boot, before anything has mounted.

A timestamp beats sampling the counters from the test side: the trough can be a few frames long,
and a poll that misses it would call a half-built scene settled.

**Proving the scene, not the boot.** `getAssetReadiness()` exposes the mount graph (counts, epoch,
quiet time, and the manifest ids whose GLB body committed or failed), and
[`tests/visual/visualHelpers.ts`](../tests/visual/visualHelpers.ts) turns it into
`waitForSceneSettled(page, { requireGlb })`. Every visual spec's readiness wait goes through it;
where a shot is ABOUT a body, the body is named, so the wait proves the photograph has the model
rather than the fallback:

| Spec | Named body | Why |
| --- | --- | --- |
| `weather-visuals` | `building_office_01` | this baseline once recorded that body's procedural fallback |
| `wave3-asset-visuals` | the placement's own body, per shot | `viewFrom` teleports into a fresh sector every time |
| `wave1-asset-visuals`, `vehicle-visuals` | the granted vehicle class | a vehicle GLB only mounts AFTER the grant |

Fallback shots — the ones that abort a GLB at the network layer on purpose — opt out through an
explicit `fallback: true`, so the wait never requires a body the test just made unreachable.

The hand-rolled workarounds in `weather-visuals`, `wave1-asset-visuals` and `vehicle-visuals` are
gone, replaced by the real gate.

---

## 4. Derived framing is a shared helper

Wave 3's `frameFor()` solved the camera geometry in closed form instead of eyeballing a zoom, and
caught two framing bugs doing it — one frame aimed tens of metres above the roofline and
photographed the sky. It was private to one spec.

It now lives in [`tests/visual/framing.ts`](../tests/visual/framing.ts) — **pure geometry, no
Playwright, no browser** — alongside `checkFraming()` (the same math run forwards, to verify a
frame a spec still states by hand), `screenRight()`/`standBeside()` (the stand-off derivation Wave
2 needed), and `manifestBody()` / `manifestEntry()`, which read a body's rendered dimensions,
shipped scale and file **from the manifest** rather than from a table transcribed into a spec.
`manifestBody` applies the entry's own canonical-facing yaw by default, so a ±90° body comes back
in world axes without the caller retyping the rotation.

Because the module is pure, it is unit-tested at arithmetic speed rather than only through a
25-second browser capture: [`tests/visual/framing.test.ts`](../tests/visual/framing.test.ts)
asserts that a solved frame really centres what it claims and fills what it was asked for, that
the solver REFUSES the two framings that produce an unjudgeable baseline (a fill over 1, a look
target at or above the camera), that a deep body's depth projects vertically as well as its
height, and — as an extraction regression pin — that it still returns the exact numbers the
committed Wave 3 baselines were captured at. `vite.config.ts` picks up `tests/**/*.test.ts`;
Playwright's own files are `*.spec.ts` and are never collected there.

Wave 3 is migrated onto it: its private solver, azimuth/stand-off tables, camera constants, body
dimensions, shipped scales and file paths are all gone, replaced by imports and manifest reads.

---

## 5. The baseline migration

Every mismatch was adjudicated individually against an `expected | actual | diff` contact sheet.
Nothing was bulk-updated, and **nothing was accepted that this issue should not bless**.

| | |
| --- | --- |
| Mismatches found — full no-update sweep at the merge base `04ae46e`, 289 cases | **88** |
| …plus one introduced by the §3 occluder fix and adjudicated (`character-player-beside-kim`) | 1 |
| **Existing baselines adjudicated and modified** | **92** |
| &nbsp;&nbsp;• accepted as captured (a real mismatch, attributable to a merged approved body) | 89 |
| &nbsp;&nbsp;• rejected-and-reframed (passed the sweep; re-shot after review rejected the evidence) | 3 |
| **New baselines this issue creates** | **9** |
| **Rejected with no replacement** | **0** |
| **Baseline files touched** | 92 modified + 9 added = **101** |

The whole set of 88 pre-existing mismatches is the debt Waves 0–3 left, and it is broader than
issue #46 assumed when it was written: the mismatches are not confined to the nine Wave 3
placements. They are every frame that happens to contain **any** merged, approved body — Wave 0's
office and sedan, Wave 1's four vehicle classes, Wave 2's streetlight, hydrant and bin, and Wave
3's six buildings — plus that body's label height, which moves with it. `wave3-asset-visuals`
itself was **0 / 69** mismatched: Wave 3's own evidence was correct all along; what was stale was
everyone else's picture of the city.

In every one of the 88, the subject of the test is unchanged. Characters, wardrobe, vehicles as
subjects, props as subjects, DOM panels and HUD all compare clean; the change is always the
scenery. That is what makes them accepted rather than rejected.

Exactly ONE existing baseline changed because of code in this branch —
`character-player-beside-kim` — and it changed because §3 now fades a 15 m body that had been
standing opaque in front of the subject. One baseline out of 289 is the whole blast radius of the
occluder-height fix.

Per-image ledger, the ten committed contact sheets, and how to review them from the PR:
[`docs/review/issue-46-baseline-migration/`](review/issue-46-baseline-migration/).

---

## Verification

Run on the pinned Node, one browser process at a time on `:5199`, `--workers=1`, sequentially.

| Gate | Result |
| --- | --- |
| `tsc -b --force` | 0 |
| `oxlint` (repo-wide) | 0 errors |
| `vitest run` | **1616 passed / 1616**, 0 failed, 0 skipped |
| `npm run build` | 0 |
| `dist/` grep for `GAME_TEST_API` | **0** |
| `scripts/assetReport.mjs` | 29 assets, 0 over budget |
| **Visual `--no-update` pass 1** | **292 / 292**, 0 failed |
| **Visual `--no-update` pass 2** | **292 / 292**, 0 failed |
| Full E2E | 369 tests executed; 9 failures, all attributed |

Both visual passes are `--no-update`, at the terminal bytes, with every shard 01–30 recorded.
Shard 22 is the whole `wave3-asset-visuals.spec.ts` (72 tests, ~28 min) and was run as 11
sequential title partitions whose union is exactly its 72 tests.

The nine E2E failures are attributed one by one against the exact merge base in
[`docs/review/issue-46-baseline-migration/e2e-attribution.md`](review/issue-46-baseline-migration/e2e-attribution.md):
**eight reproduce identically on `04ae46e`** — one of them returning a byte-identical value, and
the 300 s integrity soak reporting the same two offender pairs on both trees — and the ninth is
CPU-load sensitive by its own documented design (warm fail / cool pass on both trees). No timeout
was raised, no assertion weakened and no sleep added to reach that state.

Worth stating plainly, because it is the check that could most easily have gone the other way:
`occlusion` › *walking back into clear view restores the building smoothly* asserts
`faded.length === 0`, and §3 RAISES occluder `maxY`, which can only make more things fade. Run
alone on both trees it fails identically, so §3 is not implicated.

---

## What did NOT change

Ids, positions, footprints, colliders, anchors, interactions, labels, districts, streaming
identity and the save schema are untouched. No asset was generated, regenerated or re-scaled —
zero Meshy calls, zero paid API use, zero credits. Character identity and wardrobe are untouched.
There is no second renderer, animation, dialogue or population system.

The only production behaviour that changes is the one thing the issue asked to change: an occluder
now fades over the full height of the body it represents.
