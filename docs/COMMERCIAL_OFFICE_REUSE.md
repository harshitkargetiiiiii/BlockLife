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
  - the office row's two emissive grids (model east 4 × 4, model south 4 × 3) render inside the projection group, so they yaw with the body;
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
- **Night windows are visibly misaligned.** The glow rectangles are flat bright patches crossing the facade and window detailing, including near the ground floor, and do not read as lit panes over the model's own window rows. Only the world-east grid faces the default camera. This is a concrete follow-up, not a pass.
- **Scene:**
  - **Day bodies:** recognisably textured offices with visible bases and preserved planters.
  - **Remaining:** the ~1.5 m bare grass margins, blank ground-floor surfaces, the 9.5 m body under a 12.5 m occluder, and the mix with procedural cafés, trees and characters.
- **Not run:** full E2E and the visual suites; this tree's CI result is unknown. **No baseline was updated.**
