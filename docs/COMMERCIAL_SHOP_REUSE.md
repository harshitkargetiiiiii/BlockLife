# Commercial shop reuse: Main St Mart and North Mart (issue #60), Bay Supply (issue #61)

Issue #60 maps the already-shipped, owner-approved Wave 3 shop body onto the two compiled `small_shop` lots that still rendered the procedural box. It is a mapping expansion, not an intake: **no GLB, texture, manifest row or alias was added**, and no gameplay datum moved. It is a draft slice delivered alongside issue #55's residential slices ([`RESIDENTIAL_ARCHETYPE_REUSE.md`](RESIDENTIAL_ARCHETYPE_REUSE.md)); nothing is merged.

Mapping coverage is not visual acceptance.

## The two placements

The body is `building_shop_01` (`arch_shop_01.glb`, `fc758a28…`) at its **existing** uniform 1.206 calibration, with zero base offset. No manifest row, alias, file, renderer or compiler path is added: each lot uses issue #55's optional `LotAuthoringSpec.visual`.

| Placement | Label | Position (x, z) | Authored box | Door | Applied yaw |
|---|---|---|---|---|---:|
| `s1_-1_s1` (Main Street East) | Main St Mart | 85.36, −86 | 6 × 5 × 6 | north | π |
| `s1_-2_s1` (Main Street North) | North Mart | 90, −290 | 6 × 5 × 6 | north | π |

- **Projection:** `{ assetId: 'building_shop_01', referenceSize: [6, 5, 6], canonicalFacing: 'south', maxScaleDeviation: 0 }`. It is uniform and facing-only, and yaws the model's +z shopfront onto the authored north door.
- **Fit:** the body renders 5.9925 × 4.824 × 4.8836 m with its base on the ground, inside the 6 × 6 footprint under the applied yaw (containment measured from the GLB accessor bounds; the tightest X margin is only about 0.0002 m).
- **Height:** the rendered top (4.824 m) is **below** the authored 5 m box plus its 0.5 m slab. The occluder therefore keeps the authored footprint and its box-plus-slab height (5.5 m).
- **Front details:** the `small_shop` policy's signboard and flower pot are preserved exactly. Both stand more than 1 m in front of the rendered shopfront.
- **Sign anchor:** a registered model uses the row's `labelHeight`, so the sign moves from the procedural 6.6 m (box + 1.6) to 6 m, 1.176 m above the rendered roof. Label and facade clearance on screen is a native-evidence question, not assumed from these numbers.
- **Unchanged:** ids, labels and label colours, positions, sizes, doors, template colours and the complete procedural fallback, front-detail props, colliders, routes, pedestrian destinations and anchors, the shop manifest row and Wave 3's own `building_shop_01` placement (Mini Mart), the twenty-three issue #55 mappings, and the Wave 3 intake config and provenance.
- **Counts:** **39** of 73 authored placements are mapped to a GLB body in the exported `BUILDINGS` (30 projections + 9 own-row bodies), up from issue #55's 37. That is mapping intent, not a count of bodies that render, not merged coverage and not unique-asset utilisation.

## Gates

- **`src/game/assets/commercialMartsContract.test.ts`:**
  - the shop file byte-identical and its row unchanged;
  - the two lots' exported authored facts;
  - exactly these two Marts among the row's projections (three with issue #61's Bay Supply); now 31 projections and 40 of 73 mapped;
  - every other placement and every prop hashed equal to the delivered townhouse-slice export;
  - uniform facing-only projection;
  - byte-measured containment and grounding;
  - the front props in front of the rendered shopfront;
  - occluder height;
  - the 6 m sign anchor;
  - no overlay grid, and distinct seeds.
- **`src/game/world/residentialReuseBuildings.test.tsx`:** both Marts join the one-body / complete-fallback / calibration-and-yaw loops, and the authored sign survives both branches.
- **`src/game/assets/wave3Contract.test.ts`:** the "no Wave 3 body elsewhere" rule stays **narrowed, not deleted** (CONVENTIONS #39). Exactly these two, only through `building_shop_01`, are exempt, by manifest id and by body file.
- **`residentialNext15Contract.test.ts` / `residentialTownhouseContract.test.ts`:** narrow count and digest updates, naming the two Marts. Their own mappings stay pinned.

## Stays out

- Book Nook, the markets, the deli, gate retail and café lots, and the other Waterfront free lots (Shorefront Cafe, Pier Kiosk). Bay Supply is mapped separately by issue #61 (below).
- Industrial role substitutions, warehouses and tower remaps.
- Any global scaling framework, and issue #58 surface contact.

## Evidence and status (2026-09-15)

A bounded draft mapping of these two placements. It is **not** final visual cohesion, a label-clearance policy, whole-scene quality or low-end performance acceptance, and not merged coverage.

**CPU gates:**
- **Focused, while editing:** 14 files / 217 tests passed.
- **Terminal gate v1: FAILED, retained.** `tsc -b --force` and the build exited 2 on `TS6133` (an unused loop binding in the new contract). The other steps passed.
- **Fix:** the binding was removed; no assertion, threshold or other file changed.
- **Terminal gate v2, once:** `tsc -b --force` 0, oxlint 0, `vitest run` 193 files / 1767 tests passed, build 0, dist `GAME_TEST_API` 0, `checkDistClean` clean (51 files), asset report 38 files / 0 over budget.
- **Warnings:** the logs carry warnings from untouched modules and an unrelated texture-load test. CPU tests are not render acceptance.

**One owned in-game job** (headed Chromium, Apple M5 Pro Metal; 24 s; 4 PNGs; no retry; source fingerprint unchanged during the run): **16 of 16 checks true.**
- **Healthy views:** each Mart, viewed alone at the ordinary zoom from its door side (azimuth π, player 6 m out), rendered the shop model at material opacity 1.
- **Healthy rows:** Wave 3's Mini Mart stayed mounted as the model at every healthy step. The shop row and all four house rows (row-house, terracotta, red, compact red) were active and never failed.
- **Unload and return:** Main Street North `s1_-2` really unloaded (tier `unloaded`, North Mart unmounted) while the player stood in `s0_0`; on return North Mart remounted as the model.
- **Healthy errors:** zero request failures, page errors or console errors.
- **Shop file aborted:**
  - Main St Mart, North Mart and the Mini Mart all rendered the complete procedural shop (26 meshes each), with the branch failed;
  - all four house rows stayed active models;
  - 1 request failure, 1 console error and 3 page errors, all naming the exact aborted path, and no unrelated errors.
- **Framing:** the conservative authored-box framing check (5.5 m top) passed on all 4 PNGs. It projects the authored box, not mesh vertices, so it does not prove unoccluded coverage at every camera.
- **Sign:** measured on screen in every Mart view, and clear of the projected signboard and flower-pot bounds.

**Visual reading and open limits** (these two placements only):
- **Sign position:** the sign chip's bottom edge sits on the projected 6 m anchor in **both** the healthy and the failed-load branch, because `hasRealModel` reports manifest intent. In screen space the chip sits over the roof, not above the whole roof silhouette. On the failed-load branch it **overlaps the procedural rooftop AC unit**. Label clearance is not solved in general.
- **Tree occlusion:** an existing, unchanged sidewalk tree partly hides Main St Mart's left awning and signboard. North Mart's shopfront is clearer.
- **Return PNG artefact:** the North Mart return shot shows a pale rectangle behind the top-right HUD panel. It is unexplained and not attributed to this change.
- **Style and repetition:** the photographic teal texture reads differently from the flat procedural downtown blocks, and the same body now appears at three placements. Its sign panels are blank, and it is lower than the procedural box it replaces.
- **Not judged:** doorway or interior interaction, hidden sides, low-end performance and issue #58 surface contact.

**Not run:** full E2E, the visual suites and CI; this tree's CI result is unknown. **No baseline was updated.**

## Issue #61 — Bay Supply, through a free-lot visual

Bay Supply is a Waterfront Gateway **free lot** (`freeLots`, not road frontage), so it could not reuse the road-lot pass-through. Issue #61 adds the one missing capability and maps exactly this one placement. It is a draft slice; nothing is merged.

**The pass-through:**
- `FreeLotAuthoringSpec` gains the same optional, typed `visual?: BuildingVisualProjection` as `LotAuthoringSpec`.
- The free-lot compiler copies it into the compiled building only when authored (`...(free.visual ? { visual: free.visual } : {})`). A free lot without one compiles to exactly its previous building, with no `visual` key.
- Position, template size, facing, details, source refs and generated ids are untouched.
- There is no implicit default: no other `small_shop` or free lot is mapped.

| Placement | Label | Position (x, z) | Authored box | Door | Applied yaw |
|---|---|---|---|---|---:|
| `s0_-2_shop` (Waterfront Gateway free lot) | Bay Supply | 28, −289 | 6 × 5 × 6 | north | π |

- **Projection:** `{ assetId: 'building_shop_01', referenceSize: [6, 5, 6], canonicalFacing: 'south', maxScaleDeviation: 0 }`, with the same row, calibration and file (`fc758a28…`) as the Marts. It is uniform and facing-only.
- **Fit:** the body occupies roughly world X 25.007–31.000 and Z −291.441 to −286.557 with its base on the ground, inside the authored 25–31 / −292 to −286. The tightest X margin is about 0.0002 m (containment measured from the GLB accessor bounds).
- **Occluder:** keeps the authored footprint and the 5.5 m box-plus-slab top, above the 4.824 m body. Physics stays `[6, 5, 6]`.
- **Front details:** signboard `s0_-2_shop_front_0` [30.1, −293.3] and flower pot `_front_1` [25.9, −293.1] are preserved exactly, each more than 1 m in front of the rendered shopfront. That is plan-view separation, not a camera-space claim.
- **Destination:** `pdest_s0_-2_shop` stays at [28, −293.5]: shop / queue, capacity 3, hours 8–21, `indoor_preferred`, derived from the building door anchor, with edges to `pn_prom_entry` and `pdest_waterfront_view`. The arrival point is **not** moved to the model entrance, and no interior is added.
- **Sign anchor:** 6 m (the row's `labelHeight`) instead of the procedural 6.6 m, in both the healthy and the failed-load branch, because `hasRealModel` reports manifest intent. The Marts run showed the chip over the roof, and over the fallback's rooftop AC unit. That risk is to be measured for Bay Supply, not assumed absent; no label policy change is in scope.
- **Unchanged:** Shorefront Cafe and Pier Kiosk (no own `visual` key), the synthetic probe's free lot, the rest of the Waterfront Gateway sector, the shop row and Wave 3's Mini Mart, both Marts, the twenty-three issue #55 mappings, the Wave 3 config and provenance, wardrobe, characters and vehicles.
- **Counts:** **40** of 73 authored placements are mapped to a GLB body (31 projections + 9 own-row bodies). The shop row has **three** projections (two Marts and Bay Supply) plus its own-row Mini Mart. That is mapping intent, not bodies that render, not merged coverage and not unique-asset utilisation.

**Gates:**
- **`src/game/assets/commercialBaySupplyContract.test.ts`:**
  - the shop file byte-identical and its row unchanged;
  - Bay's exported authored facts;
  - exactly three shop projections; 31 projections and 40 of 73 mapped;
  - the **complete compiled Waterfront Gateway**, with only `visual` keys dropped, equal to the digest captured from the **pre-change compiler** at `097b440c` (every compiled field, `sourceRefs` Map as entries), with exactly Bay's two `visual` keys present;
  - global BUILDINGS without Bay's visual, PROPS, citizen destinations and the pedestrian graph equal to their pre-change digests;
  - Bay's destination facts and edges;
  - uniform yaw π;
  - byte-measured containment and grounding;
  - both front props in front of the shopfront;
  - occluder height;
  - the sign anchor arithmetic;
  - no overlay grid, and distinct seeds.
- **`src/game/world/authoring/sectorAuthoring.test.ts`:**
  - the free-lot visual reaches the compiled building and only Bay authors one;
  - stripping it changes nothing else in the compiled sector;
  - the synthetic probe's free lot emits no `visual` key.
- **`src/game/world/residentialReuseBuildings.test.tsx`:** Bay joins the one-body / complete-fallback / sign / calibration-and-yaw loops.
- **`src/game/assets/wave3Contract.test.ts`:** exactly this id, only through `building_shop_01`, is exempt, by manifest id and by body file.
- **`commercialMartsContract.test.ts`, `residentialTownhouseContract.test.ts`, `residentialNext15Contract.test.ts`:** narrow count, projection-set and digest-exclusion updates naming Bay Supply. Their old digest constants are unchanged.

### Bay Supply evidence and status (2026-09-15)

A bounded draft mapping of this one placement, with **one requirement unmet**. This is **not** complete issue #61 acceptance, a label-clearance policy, whole-scene quality or low-end performance acceptance, and not merged coverage.

**CPU gate** (once, at the executed source bytes):
- `tsc -b --force` 0, oxlint 0, `vitest run` 194 files / 1783 tests passed, build 0, dist `GAME_TEST_API` 0, `checkDistClean` clean (51 files), asset report 38 files / 0 over budget.
- **Focused run:** 14 files / 210 tests passed while editing. A shell glob omitted the expansion-sector test file from that focused run only; the full gate includes it.

**One owned in-game job** (headed Chromium, Apple M5 Pro Metal; 64 s; 3 PNGs; no retry; source fingerprint unchanged during the run): **14 of 16 checks true, 2 false.**
- **Healthy view:** Bay Supply, viewed from its north door side at the ordinary zoom (azimuth π), rendered the shop model at material opacity 1.
- **Healthy rows:** the Mini Mart, both Marts and all four house rows stayed loaded models and never failed. Shorefront Cafe and Pier Kiosk carry no `visual` key and stayed procedural.
- **Healthy errors:** zero request failures, page errors or console errors.
- **Shop file aborted:**
  - Bay Supply, the Mini Mart and both Marts rendered the complete procedural shop (26 meshes each), with the branch failed;
  - all four house rows stayed active models;
  - 1 request failure, 1 console error and 4 page errors, all naming the exact aborted path, and no unrelated errors.
- **Framing:** the conservative authored-box check (5.5 m top) passed on all 3 PNGs. It projects the box, not mesh vertices.
- **Sign:** measured on screen in every view, and clear of the projected signboard and flower-pot bounds.
- **UNMET — genuine sector unload:**
  - **What happened:** with the player at [−12, 40] in `s0_0`, the Waterfront Gateway sector `s0_-2` stayed `reduced` (warm, ready) for the full 48 s wait and **never unloaded**; Bay Supply stayed mounted. The checks `allStepsSettled` and `waterfrontReallyUnloadedAndBaySupplyUnmounted` are false.
  - **Return check:** the later check that found the model again on return is only a **revisit, not remount evidence**.
  - **Candidate cause, not proven:** the streaming policy's routed-vehicle prewarm (`getRoutePrewarmSectorIds`) is a plausible reason, but the run did not record the prewarm set, so no cause is established.
  - **No change made for it:** no streaming, traffic or routing code changed in this slice, and none was changed to force an unload.

**Visual reading and open limits** (this placement only):
- **Sign position:** the sign chip's bottom edge sits on the projected 6 m anchor in **both** the healthy and the failed-load branch (manifest-intent `hasRealModel`). It sits over the roof in screen space and, on the failed-load branch, **overlaps the procedural rooftop AC unit**. It stays readable and clear of the front props. Label clearance is not solved in general.
- **Neighbours:** Pier Kiosk appears only as a cropped edge and Shorefront Cafe is off-frame, so the census confirms their procedural presence; there is no full neighbour visual acceptance.
- **Style and repetition:** the photographic teal texture reads differently from the flat procedural waterfront plaza, and the shop body now appears at four placements (the Mini Mart plus three projections). Its sign panels are blank.
- **Not judged:** hidden sides, doorway or interior interaction, low-end performance and issue #58 surface contact.

**Not run:** full E2E, the visual suites and CI; this tree's CI result is unknown. **No baseline was updated.**
