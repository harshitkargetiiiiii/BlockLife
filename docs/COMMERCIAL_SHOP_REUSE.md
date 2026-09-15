# Commercial shop reuse: Main St Mart and North Mart (issue #60)

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
  - exactly these two projections; 30 projections and 39 of 73 mapped;
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

- Bay Supply (`s0_-2_shop`, authored through `freeLots`), Book Nook, the markets, the deli, gate retail and café lots.
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
