# Legacy sidewalk render height (issue #58)

Issue #58 found the player's shoes hidden while standing on the central inner sidewalk (recorded origin X −21.856, Z −18.344). The legacy central and district sidewalks were 0.12 m boxes centred at 0.06, so their visible top was **0.12**. Every walkable collider in the city has its top at **Y = 0**, and people and cars render from Y = 0. A shoe about 0.12 m tall standing on Y = 0 was therefore hidden inside the slab. The Gateway and compiled sectors do not have this outlier: they render sidewalks and plazas as planes at **0.03**.

This slice is a **bounded first candidate**, not visual acceptance.

## Policy: flat support, one sidewalk render layer

Physical support stays flat at Y = 0. The legacy sidewalks move onto the existing 0.03 layer, and the paint that sat on or beside them moves with them. Named heights live in [`src/game/world/surfaceHeights.ts`](../src/game/world/surfaceHeights.ts).

| Layer | Before | After | Source |
|---|---:|---:|---|
| Legacy sidewalk slab top (30 pieces: 10 in `Roads.tsx`, 20 in `Districts.tsx`) | 0.12 | **0.03** | same as Gateway / compiled sidewalks |
| Legacy slab thickness | 0.12 | 0.12 | unchanged; so the centre is **−0.03** (a centre of +0.03 would leave the top at 0.09) |
| Legacy curb-ramp pads (8, `Districts.tsx`) | 0.13 | **0.045** | the compiled crossing curb-ramp tier |
| Market curb-space stripes (3, `Districts.tsx`) | 0.065 | **0.032** | the residential curb-space stripe tier |

**Unchanged:**
- all slab X/Z footprints, connector gaps, materials and shadow flags, and every other mesh these renderers draw;
- roads (0.02), gutters, lane and crosswalk paint, plaza and seams, lawns, parking and aprons;
- the Gateway and compiled sectors, generated surface details and crossing art;
- all colliders, routes, anchors, doors and props;
- player, NPC, citizen and vehicle transforms; the wardrobe; every asset byte.

No actor Y offset, collider, step or suspension logic was added.

## What this does and does not change

- **Height mismatch (arithmetic, not a measurement):** it removes 9 cm of the mismatch. At the recorded origin roughly the top 0.089 m of a 0.12 m shoe is now above the pavement. The lower ~0.03 m still lies behind the 0.03 layer, as it already did on Gateway and compiled sidewalks. The measured native values are under [Status](#status).
- **Curb rise:** the visible road-to-sidewalk rise drops from 10 cm to **1 cm**. Curb readability and edge shadows at the ordinary camera are not proven by this change.
- **Why not raise support instead:** a raised-sidewalk policy (support at 0.12) would need support sampling for kinematic people and cars, step traversal for the player capsule and car body, door and prop bases, and streaming floor seams. It is deliberately **not** attempted here.

## Gates

**`src/game/world/surfaceContact.test.tsx`** (5 tests) renders the real `Roads`, `Districts` and a compiled sector, and checks:
- **Named heights:** the slab top (not the centre) is 0.03.
- **Slabs:** all 30 have tops 0.03, bottoms −0.09, thickness 0.12 and shadow flags, with X/Z footprints equal to the **pre-change** capture.
- **Decals:** all 8 ramps and 3 stripes are at their exact positions and tiers.
- **Complete render trees:** before mapping anything back, each of exactly **41** affected meshes (10 in `Roads`, 31 in `Districts`) has its new local Y, world translation Y and world-box min/max Y asserted. Mapping only those heights back to their old values then reproduces the pre-change mesh-dump digests of `Roads` (92 meshes) and `Districts` (201 meshes), captured at `c6d369bc` before this change.
- **Reported point:** the recorded origin lies on exactly the west inner strip.
- **Support:** the city ground collider still has its top at 0, and no sidewalk collider exists. These two are source-text checks.
- **Reference layer:** compiled sidewalk and plaza planes are still at 0.03, and the Gateway sidewalk planes at 0.03 (source text).

## Status

A bounded candidate with measured native evidence. **Not visual acceptance; issue #58 is not closed.**

**CPU** (the executed source, WIP commit `2dfeed3c`): `tsc -b --force`, oxlint and build exit 0; `vitest run` **195 files / 1788 tests passed**, including the 5 new tests; dist `GAME_TEST_API` 0; `checkDistClean` clean; asset report 0 over budget.

**Native evidence** (one sequential run per mode, same harness `surface-contact-run.v2.mjs` `0980f2a8…`, Apple M5 Pro Metal, headed Chromium 149; no retry):
- **Baseline:** the unmodified renderer, clean detached `c6d369bc`. **7 s, 2 PNGs, 8 of 8 recording checks true.** No pass is claimed for it. Raw evidence sha256 `14c0194d…`.
- **Candidate:** WIP `2dfeed3c`. **45 s, 7 PNGs, 15 of 17 checks true.** Raw evidence sha256 `40069543…`.
- **Both runs:** 0 page, console or request errors, and all owned processes exited.

**Measured at the recorded point** (live-scene geometry, not rendered visibility; same camera in both modes, but a different simulation phase, so not pixel-identical):

| view | mode | sidewalk top under the shoe | shoe top above it | shoe base behind the top |
|---|---|---:|---:|---:|
| ordinary camera | baseline | 0.12 | 0.006 m | 0.114 m |
| ordinary camera | candidate | 0.03 | 0.097 m | 0.023 m |
| planted-foot review | baseline | 0.12 | −0.009 m | 0.129 m |
| planted-foot review | candidate | 0.03 | 0.081 m | 0.039 m |

- **Support:** unchanged; the player group Y is −0.0011 in every sample.
- **Planted-foot view:** in the baseline the shoes are not distinguishable inside the 0.12 slab; in the candidate they are visible on the pavement.
- **Walking:** 18 samples from plaza (0.02) across the inner sidewalk (0.03) into the road (0.02): support stayed at 0, and the shoe top stayed above the surface.
- **Save/load:** restored the exact position with the same contact.

**Open limits:**
- **Ordinary camera at the recorded point:** the player is behind the occlusion-faded apartment tower in both modes, so shoe visibility cannot be judged from that view.
- **Remaining immersion:** 0.023–0.039 m of the shoe base remains behind the 0.03 layer.
- **Curb:** the 1 cm curb reads mainly by colour; its readability is not accepted.
- **Leo (kinematic NPC):** measured over a sidewalk (shoe top 0.157 m above), but the harness placed the player inside the Mini Mart footprint beside him, so his contact is **not visually judgeable**.
- **Compiled reference check: false, retained.** The top surface under the shoe was the existing 0.032 seam/curb-strip detail layer above the 0.03 sidewalk plane; the check did not allow for it.
- **Not observed:**
  - sector leave/remount (the legacy sidewalks are in the pinned `s0_0`);
  - a vehicle driving across the curb, and wheel contact (only a stationary granted car was recorded);
  - door or prop interaction beyond the approach photo.
- **Not run:** E2E and visual suites; no baseline image was updated.


**Stack propagation** (dependency only; not acceptance, not a merge to master):
- **Branch:** `fix/issue-58-surface-contact` is `95a10ef2` plus the no-fast-forward merge `d371d53f` of the issues #55–#64 topic head `f62bec1f`, which brings in office commits `aa8d1108` (#63) and `f62bec1f` (#64). No rebase, squash or force.
- **Proof the issue #58 change is untouched:** its five paths are byte-identical to `95a10ef2`, and the diff `f62bec1f`..`d371d53f` equals `c6d369bc`..`95a10ef2` byte for byte (sha256 `a9da09fa…`).
- **Combined CPU gate at `d371d53f`:** `tsc -b --force`, oxlint and build exit 0; `vitest run` **197 files / 1806 tests passed**; dist `GAME_TEST_API` 0; `checkDistClean` clean (51 files); asset report 38 files, 0 over budget. No local E2E or native run at this head.
- **Native results above:** they belong to their original bytes (baseline `c6d369bc`, candidate `2dfeed3c`) and were not re-run or relabelled.

**Terminal CI for `95a10ef2`** (E2E run 34953615841, attempt 1, over synthetic merge `4ef213ce`, whose tree equals the `95a10ef2` tree):
- **Result: FAILED.** 385 defined, 335 passed, 50 failed; none skipped, flaky or unrun. The static run 34953615889 succeeded.
- **Against the immediate base `c6d369bc`** (run 34953605914, 336 passed / 49 failed): 40 failure identities in common, 10 head-only, 9 base-only.
  - These are separate executions: a description, **not causal regression clearance**.
  - No head-only failure is dismissed, and a base-only failure's absence here is not proof of repair.
  - No artifacts were uploaded.
- **The head-only failures** include overall timeouts and three specific predicates:
  - run distance vs walk distance;
  - civilian +z escape progress (not a floor-height check);
  - a missing "loaded" toast.
- **Scope:** this record belongs to `95a10ef2` only. The stacked head has no CI result.
- **Raw logs and comparison:** `BlockLife-intake/issue58-surface-contact-2026-09-15/delivery/ci-run-34953615841/` (comparison JSON `1ab7a337…`).

A negative or unobserved result must not be answered with character offsets, collision changes or weaker assertions.
