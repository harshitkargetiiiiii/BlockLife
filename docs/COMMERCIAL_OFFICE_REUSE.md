# Commercial office reuse: Main St Offices and North Exchange (issue #63)

Issue #63 maps the already-shipped, owner-approved Nook Offices body onto the two compiled `office_tower` lots that still rendered the procedural box. It is a mapping expansion, not an intake: **no GLB, texture, manifest row or alias was added**, and no gameplay datum moved. It is a draft slice on PR #57, after the issue #55 residential, issue #60 Marts and issue #61 Bay Supply slices; nothing is merged.

Mapping coverage is not visual acceptance.

## The two placements

The body is `building_office_01` (`arch_office_01.glb`, `fb5b709a…`) at its **existing** uniform 0.9501 calibration, with zero rotation and offset. Each lot uses the existing road-lot `LotAuthoringSpec.visual`; no compiler or renderer capability is added.

| Placement | Label | Position (x, z) | Authored box | Door | Applied yaw |
|---|---|---|---|---|---:|
| `s1_-1_n1` (Main Street East) | Main St Offices | 80.6, −112 | 8 × 12 × 8 | south | +π/2 |
| `s1_-2_n1` (Main Street North) | North Exchange | 80, −316 | 8 × 12 × 8 | south | +π/2 |

**Projection:** `{ assetId: 'building_office_01', referenceSize: [8, 12, 8], canonicalFacing: 'west', maxScaleDeviation: 0 }`. It is uniform and facing-only.

**Why canonical west:**
- The office row applies no yaw, and Nook Offices' authored door is **west**.
- Wave 0's native capture `wave0-office-entrance-west` records the entrance on that side; Main reviewed the saved image and its staging.
- So the model's entrance is its **west** elevation, and the resolver yaws it +π/2 onto each south door. That turns the model's west face to world south.

**Unchanged:** Nook Offices keeps its own row and no projection.

## Measured from the shipped bytes

- **Fit:** at 0.9501 the body is 4.982 × 9.500 × 5.072 m with its base on the ground. After the +π/2 yaw it occupies about 5.07 m (X) × 4.98 m (Z) of each 8 × 8 lot.
- **Under-fill:** about **1.5 m of bare lot on every side**, which is a visible cost to judge natively. Nook Offices under-fills its 7 m lot the same way.
- **Height:**
  - the rendered roof is **9.5 m**, **2.5 m below** the authored 12 m box;
  - the occluder keeps the authored footprint and its **12.5 m** box-plus-slab top, which is taller;
  - a player behind the building can therefore fade it while the space above the roof is empty, the same policy as the Marts and Bay Supply.
- **Sign anchor:** a registered model uses the row's `labelHeight`, so the sign moves from the procedural **13.6 m** (box + 1.6) to **10.2 m**, 0.7 m above the rendered roof, in both the healthy and failed-load branch (manifest-intent `hasRealModel`). Clearance against the roof and neighbouring signs is a native question.
- **Front planters:** the `office_tower` policy's two `street_planter` props are preserved exactly, and stand more than 1 m in front of the rendered entrance (plan view).
- **Window overlays:**
  - the office row's two emissive grids render inside the projection group, so they yaw with the body. At issue #63 they were model east 4 × 4 and model south 4 × 3; issue #64 re-authored them onto measured glass panes (see below);
  - after +π/2 they face world **north** and world **east**, and only the east grid faces the default camera;
  - each placement gets its own lit-window seed.

**Counts:** **42** of 73 authored placements are mapped to a GLB body (33 projections + 9 own-row bodies), up from 40. That is mapping intent, not a count of bodies that render, not merged coverage and not unique-asset utilisation. The office body now appears at three placements.

**Unchanged:**
- ids, labels and label colours, positions, sizes, doors;
- template colours and the complete procedural fallback;
- front planters, colliders, routes, pedestrian destinations and graph, anchors;
- the office manifest row and its overlay data, Nook Offices;
- every earlier issue #55/#60/#61 mapping;
- player, wardrobe, characters and vehicles.

## Gates

- **`src/game/assets/commercialOfficesContract.test.ts`:**
  - the office file byte-identical; its row and both overlay grids unchanged; Nook Offices untouched;
  - both lots' authored facts;
  - exactly two projections; 33 projections and 42 of 73 mapped;
  - the **complete compiled Main Street East and North sectors**, with only the office lot's authored and compiled `visual` removed, equal to digests captured from the **pre-change compiler** at `c6d369bc`;
  - global BUILDINGS without the two visuals, PROPS, citizen destinations and the pedestrian graph equal their pre-change digests;
  - uniform yaw +π/2;
  - byte-measured containment, grounding and the ~1.5 m margins;
  - planters in front of the entrance;
  - the occluder at 12.5;
  - the 13.6 → 10.2 sign anchor;
  - distinct per-placement overlay seeds.
- **`src/game/world/commercialOfficesBuildings.test.tsx`:** for both lots:
  - one model body with no procedural shell, the calibration on the model and +π/2 on the projection;
  - the overlay group rendered once under a group carrying the same yaw, with both facades;
  - the sign present in both branches;
  - on failure, the complete procedural building, signature-equal to a direct `BuildingMesh`.
- **Earlier contracts** (`commercialBaySupplyContract`, `commercialMartsContract`, `residentialTownhouseContract`, `residentialNext15Contract`): narrow count and digest-exclusion updates naming exactly these two ids. Old digest constants are unchanged.

## Stays out

- Gateway Offices and Meridian Tower (separate adjudication).
- The mixed-use blocks.
- Backdrop towers.
- Cafés, delis, markets, commons and more shop-body copies.
- Warehouse/garage substitutions.
- Label or occluder policy changes, and issue #58 surface contact.

## Evidence and status (2026-09-15)

A bounded draft mapping of these two placements. It is **not** final visual cohesion, label or night-lighting acceptance, a green full-E2E result, or merged coverage.

**CPU gates:**
- **Focused v1: FAILED, retained.** `CityBlock.test.tsx` counted `asset:building_office_01` slots and `window-overlay:building_office_01` groups city-wide as one; the two new projections make three. It now pins exactly Nook Offices plus these two lots as the owning placements; every other landmark stays one. Focused v2 then passed 20 files / 255 tests.
- **Terminal gate, once:** `tsc -b --force` 0, oxlint 0, `vitest run` **196 files / 1798 tests passed**, build 0, dist `GAME_TEST_API` 0, `checkDistClean` clean (51 files), asset report 38 files / 0 over budget.

**One owned in-game job** (headed Chromium 149, Apple M5 Pro Metal, ordinary zoom, 1280 × 720; **30 s, 6 PNGs, no retry**; source fingerprint unchanged during the run): **17 of 18 checks true, one false.**

*How it was launched:* the reviewer invoked it with `--preflight` instead of `--preflight-only`. The runner did not reject the unknown flag, so its embedded source, runtime and process checks passed and the reviewed job ran. It was the only native run.

- **Healthy views:** both offices, viewed from their south door side at the ordinary camera (the player's spot checked clear of every building footprint), rendered the office model at material opacity 1.
- **Healthy rows:** Nook Offices stayed a model at every healthy step, and all six compared rows (office, shop, row house, terracotta, red, compact red) stayed active models.
- **Unload and return:** Main Street North `s1_-2` **really unloaded** (tier `unloaded`, North Exchange unmounted) while the player stood in `s0_0`, and on return North Exchange remounted as the model.
- **Night overlays:**
  - at 22:00 the window-glow opacity is 0.9 (day 0);
  - both offices' overlay groups are mounted with world yaw +π/2 and both facade grids;
  - the two placements light different cells.

  That proves switching and attachment, not visual alignment (see limits).
- **Healthy errors:** zero request failures, page errors or console errors.
- **Office file aborted:**
  - both new offices **and** Nook Offices rendered the complete procedural building, with the office branch failed;
  - the shop, row-house, terracotta, red and compact rows stayed active models;
  - 1 request failure, 1 console error and 3 page errors, all naming the exact aborted path, and no unrelated errors.
- **Sign and planters:** the sign was measured on screen in every view, and both preserved planters are clear of it.

**Open limits** (the checks above do not remove them):
- **Framing: false in all six views, retained.**
  - **Measured:** the rendered-body box (the yawed body to 9.5 m) projects to y −36.1 px; the conservative authored box (12.5 m) to y −157.8 px. The rear roof extremity is clipped at the top of the frame.
  - **Fallback views:** the 12 m procedural buildings are strongly cropped. The runner used the model-sized box in those views too, so its fallback framing figure is not a complete procedural extent.
  - **Not claimed:** complete-silhouette acceptance.
- **Sign over the roof:**
  - the sign chip sits exactly on the 10.2 m anchor in both branches (manifest-intent `hasRealModel`), including on the taller procedural fallback;
  - in screen space it overlaps the roof (−71.9 px to the body-box top);
  - that is screen overlap, not geometric penetration, and fallback sign placement is not accepted.
- **Night windows are visibly misaligned.** The glow rectangles are flat bright patches crossing the facade and window detailing, including near the ground floor, and do not read as lit panes over the model's own window rows. Only the world-east grid faces the default camera. This is a concrete follow-up, not a pass. It is historical evidence for the issue #63 bytes. Issue #64 (below) corrects the data; its one native run supports that correction at the normal camera, and does not change this issue #63 result.
- **Scene:**
  - **Day bodies:** recognisably textured offices with visible bases and preserved planters.
  - **Remaining:** the ~1.5 m bare grass margins, blank ground-floor surfaces, the 9.5 m body under a 12.5 m occluder, and the mix with procedural cafés, trees and characters.
- **Not run:** full E2E and the visual suites; this tree's CI result is unknown. **No baseline was updated.**

## Issue #64: night glow on measured glass panes (draft)

The issue #63 night capture showed the office row's glow rectangles off the glass. That row is shared, so the fault reached Nook Offices too. The Wave 0 grids sat just outside the whole-building bounding box, but the office's glazing is **recessed** behind its piers. Rays cast against the shipped triangles put those planes **0.03–0.46 m** in front of the real surface, with rows over the sign band, sills and parapet.

**Change:**
- Only the two `building_office_01` definitions and their comment in `src/game/world/windowOverlayData.ts`. The overlay schema and renderer are unchanged.
- The GLB, texture, material, glow curve and calibration are unchanged, and so are the manifest row, placements and gameplay.
- Still **two definitions per office**, so **6 glow draws** across the three placements.

**Measured (calibrated model metres, 0.9501 applied; lateral = z on the east face, x on the south face):**
- **Glass depth:** east glass is planar at x ≈ 2.099–2.111; the south face's big window at z ≈ 2.092–2.094. Raised mullions and transoms sit about 2.13–2.16, piers and wall about 2.25–2.34.
- **Pane locations:** 1 mm scans from each pane centre, stopping where the outermost surface left that pane's glass plane by more than 12 mm, rounded inward to 1 cm.
- **Texture review:** the extracted atlas was reviewed against the textured orthographic elevations.
- **Lit:** only the lower glazed floor's clean panes, two pane rows on each face.
- **Left dark:** the upper floor's glass has baked vertical bars and muntins, so glow there would wash over window detailing. The south face's narrow left light breaks the uniform column spacing.

| grid | facade distance | rows × columns | spacing | start | window | pane glass (lateral × y) |
|---|---:|---|---|---|---|---|
| east (seed 31, lit ratio 0.6) | 2.13 | 2 × 3 | 1.05, 0.58 | −1.045, 4.09 | 0.74 × 0.34 | [−1.49, −0.60], [−0.46, 0.48], [0.62, 1.48] × [3.85–3.86, 4.32–4.33] and [4.41, 4.92–4.94] |
| south (seed 32, lit ratio 0.5) | 2.12 | 2 × 2 | 0.952, 0.58 | 0.126, 4.085 | 0.65 × 0.34 | [−0.26, 0.51], [0.65, 1.50] × [3.85–3.86, 4.32] and [4.39, 4.93–4.94] |

**Fit:**
- **Inset:** every rectangle is inset at least 5 cm inside exactly one pane, and every pane carries exactly one cell.
- **Clearance:** each plane sits **19–32 mm** proud of the outermost surface at every **sampled** point, an 11 × 11 lattice over the rectangle with centre, corners and edges included.
- **Planarity:** the sampled surface under each cell varies by at most about 5 mm.

That is a sampled measurement, not a continuous triangle-clipping proof. The planes stay behind the raised frame, so at an angle the jambs clip them.

**Lit cells (unchanged seed rule):**

| placement | seeds | east lit | south lit | total |
|---|---|---|---|---:|
| Nook Offices (no projection) | 31 / 32 | r0c0 r0c1 r0c2 r1c2 | r0c0 r0c1 r1c0 r1c1 | 8 |
| Main St Offices (+π/2) | 31 ^ overlaySeed / 32 ^ overlaySeed | r0c0 r0c1 r0c2 r1c0 r1c2 | r0c0 r1c0 | 7 |
| North Exchange (+π/2) | 31 ^ overlaySeed / 32 ^ overlaySeed | r0c1 r1c0 r1c2 | r0c0 r1c0 r1c1 | 6 |

That is **21 lit instances** (was 51: 18, 16, 17) in the same 6 draws.
- **Nook Offices:** the default camera sees both lit faces.
- **The two projected offices:** it sees only model south, which is world east.

**Gates:**
- **`wave0Contract.test.ts`:** replaces the old "plane just outside the AABB" proof. It pins the pane table and requires each cell to be inset in exactly one pane. It re-casts rays against the GLB triangles at every sampled lattice point, checking planarity ≤ 6 mm, recess ≥ 0.3 m behind the building extreme, and clearance 15–40 mm. The outer width and roof guards stay.
- **`commercialOfficesBuildings.test.tsx`:** recovers the lit cells from the **actual instance matrices** at all three placements, identically on a second mount, with distinct patterns per facade, 21 instances and 6 draws.
- **`commercialOfficesContract.test.ts`:** updates only its grid pin. The GLB, row, compiler, world and fallback pins are unchanged.

**Status:**
- **CPU:** focused v1 failed on one new assertion (9-digit `toBeCloseTo` on positions read back from Float32 instance matrices, off by 4.3e-8; now 6-digit); focused v2 passed 11 files / 106 tests. The terminal gate at the stable bytes passed: tsc, oxlint and build all 0; `vitest run` 196 files / 1801 tests; dist clean; asset report 0 over budget.
- **Native:** one owned headed run (Chromium 149, Apple M5 Pro Metal, 1280 × 720, DPR 1), exactly once, **40 s**, **6 PNGs**, no retry.
  - **Camera:** the ordinary follow camera: azimuth 0, look-Y 0, zoom 34, normal occlusion, opacity and LOD.
  - **Executed pins:** harness `4688be85…`, raw evidence `ba8581f4…`. Sources: `windowOverlayData.ts` `7efdeb27…`, `wave0Contract.test.ts` `aff51523…`, `commercialOfficesBuildings.test.tsx` `186e7e36…`, `commercialOfficesContract.test.ts` `42ae08e2…`, and this document at `d38d30ea…`. GLB `fb5b709a…`, unchanged during the run.
  - **Result:** **17 of 17 automatic checks true**, with **zero** request, page or console errors.
    - Day and night views of all three offices, from observer spots chosen with the live camera's projection.
    - Each complete rendered body and every camera-facing lit pane inside the frame, with no HUD over the sampled pane points.
    - The body an opaque, active model.
    - Overlay yaw 0 at Nook Offices and +π/2 at the other two.
    - Exactly the pinned lit cells, each on its authored plane and cell.
    - Glow 0 by day and 0.9 at night.
  - **Visual review:** Main reviewed all six PNGs. At the normal camera, the glow now sits in the lower glazed floor's window band, on none of the sign band, sills, storefront, upper floor or roof, and nothing glows by day. This supports the scoped correction for draft delivery.
- **Limits that remain:**
  - **Not proven:** sub-pixel pane-edge or mullion alignment (a pane is about 12 px tall), temporal behaviour and z-fighting, other angles and zooms, and continuous DOM clearance (it was sampled).
  - **Back faces:** the faces the camera never sees (model east on the two projected offices) are supported by the instance and geometry checks only, not by pixels.
  - **Sparse lighting:** night is sparse by design. The upper floor and the south face's narrow light stay dark, and the two projected offices show only 2 and 3 lit panes toward the camera.
  - **Labels:** signs still overlap the roof edge in screen space, and Nook Offices' label overlaps the Job Board label.
  - **Scene:** bare lot margins, mixed procedural neighbours, trees and the broader graphics integration are not accepted by this run.
  - **Issue #63 framing:** its false framing result was measured in different views and stays as recorded. Seeing whole bodies here does not retroactively clear it.
  - **Not rerun:** the issue #63 unload, remount and failure evidence belongs to the issue #63 bytes and is not relabelled.
  - **Not run:** full E2E and the visual suites. The Wave 0 visual golden `wave0-office-night-windows` is expected to differ and was not updated.
