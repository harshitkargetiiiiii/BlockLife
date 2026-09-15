# Residential archetype reuse (issue #55)

Issue #55 maps already-shipped, owner-approved house bodies onto authored residential lots that
still rendered the procedural house. It is a mapping expansion, not an intake: **no GLB or texture
file was added**, and no gameplay datum moved. It was implemented in three draft slices; none is merged.

Mapping coverage is not visual acceptance.

## Slice 1 — five more 5.5 × 5.5 lots on `arch_house_01`

Issue #55 extends the approved detached-house archetype `arch_house_01`, which
[Wave 3](ASSET_INTEGRATION_WAVE_3.md) projects onto four authored placements, to **five more
authored lots with the identical 5.5 × 5.5 footprint**:

- no GLB, texture, manifest row, renderer or cache was added;
- the archetype row keeps its uniform 0.9515 calibration and measured +z front.

| Placement | Position (x, z) | Authored box (w × h × d) | Door | Applied yaw |
|---|---|---|---|---:|
| `building_house_r4` | 10, −54.5 | 5.5 × 4 × 5.5 | south | 0 |
| `building_house_w4` | −57, 13 | 5.5 × 4 × 5.5 | east | π⁄2 |
| `building_house_w6` | −40, 14 | 5.5 × 4.3 × 5.5 | west | −π⁄2 |
| `building_house_s4` | 14, 41 | 5.5 × 4.5 × 5.5 | south | 0 |
| `building_house_s6` | −5, 55.5 | 5.5 × 4 × 5.5 | north | π |

### What each mapping is

Each lot gains exactly the `BuildingDef.visual` block Wave 3's houses carry:

- `referenceSize [5.5, 4.5, 5.5]`
- `canonicalFacing: 'south'`
- `maxScaleDeviation: 0`

The body therefore renders **undistorted at 5.4935 × 4.757 × 5.0635** on every lot. The lots authored at 4.0 m and 4.3 m are **not** squashed on Y to match their boxes, and the per-placement projection only yaws the model's front onto the authored door.

**Unchanged gameplay data:** position, `def.size`, door, colours, label and windows flag. The collider, entrance anchor, routing and occluder footprint therefore stay keyed to the authored box.

**Occluder height:** it covers whichever is taller, the box plus its 0.5 m roof slab or the 4.757 m body (issue #46 §3).

**Fallback:** a missing or failed GLB still renders the complete procedural house.

**Overlay seed:** each archetype placement keeps its own, so the reuse carries no shared per-building randomness.

## Slice 2 — the fifteen 5 × 5 house lots, on two existing bodies

The 5.5 m body does not fit a 5 × 5 lot at its 0.9515 calibration, so slice 2 uses two bodies that do. Both are already in the repository, and both source files are byte-identical:

| Body | File (sha256) | Uniform fit | Fitted width × height × depth | Max half-extent after any cardinal yaw |
|---|---|---:|---|---:|
| terracotta two-storey hipped house | `arch_residential_house_01.glb` (`c934c1e2…`) | the **existing** row, 2.95 (+2.81 base offset) | 4.999412 × 5.622895 × 4.075732 | 2.4997 |
| red steep-gable house with chimney | `arch_house_01.glb` (`cf388916…`) through the new row **`arch_house_01_compact`** | 0.865 | 4.994103 × 4.324543 × 4.603209 | 2.4998 |

Both fronts are +z. The terracotta body inherits a base 1.447 mm below ground from the issue #25 calibration; that value was measured, and it has not been corrected.

**The compact row is a calibration, not a copy.** `arch_house_01_compact` is a second manifest row that points at the same `arch_house_01.glb`:
- no mesh, texture or GLB was duplicated, and no atlas or tint was added;
- the 0.9515 `arch_house_01` row and its nine 5.5 × 5.5 placements are untouched;
- both rows resolve to one URL, so there is one cached parse;
- each placement clones its own scene;
- each row keeps its own load-branch reference counts;
- nothing is disposed globally.

`s = floor(min(2.5 / 2.88995, 2.5 / 2.66315) × 1e4) / 1e4 = 0.865` (X binds).

| Placement | Body | Authored box | Door | Applied yaw |
|---|---|---|---|---:|
| `building_house_r3` | terracotta | 5 × 4.2 × 5 | south | 0 |
| `building_house_r5` | compact red | 5 × 4 × 5 | north | π |
| `building_house_w1` | terracotta | 5 × 4 × 5 | east | π⁄2 |
| `building_house_w3` | terracotta | 5 × 4.2 × 5 | east | π⁄2 |
| `building_house_w5` | compact red | 5 × 4 × 5 | west | −π⁄2 |
| `building_house_s1` | terracotta | 5 × 4 × 5 | south | 0 |
| `building_house_s3` | terracotta | 5 × 4 × 5 | south | 0 |
| `building_house_s5` | terracotta | 5 × 4 × 5 | north | π |
| `building_house_s7` | terracotta | 5 × 4.2 × 5 | north | π |
| `s2_-1_n1` (compiled) | terracotta | 5 × 4 × 5 | south | 0 |
| `s2_-1_n2` (compiled) | compact red | 5 × 4 × 5 | south | 0 |
| `s2_-1_n3` (compiled) | terracotta | 5 × 4 × 5 | south | 0 |
| `s2_-1_s1` (compiled) | compact red | 5 × 4 × 5 | north | π |
| `s2_-1_s2` (compiled) | terracotta | 5 × 4 × 5 | north | π |
| `s2_-1_s3` (compiled) | compact red | 5 × 4 × 5 | north | π |

The mix is 10 terracotta and 5 compact red. The compiled rows alternate in opposite phases, and no authored door was changed to create variety.

**Projection:** every new lot carries `{ referenceSize: [5, 4, 5], canonicalFacing: 'south', maxScaleDeviation: 0 }`. The projection is uniform on every axis: the 4.2 m lots are not stretched. It only yaws the front onto the authored door.

**Existing projections untouched:** `building_house_r1` keeps its own issue #25 projection unchanged.

**Occluder height:**
- terracotta: its 5.6214 m rendered top;
- compact red (4.3245 m): the 4.5 m box-plus-slab, which is taller.

### Compiled lots: a typed visual passthrough

`LotAuthoringSpec` and `CompiledBuilding` gain an optional `visual`, and `compileLot` copies it into the compiled building **only when authored**.
- **No lot is dropped:** every lot without one compiles to exactly its previous output, with no `visual` key emitted.
- **Scope:** `FreeLotAuthoringSpec` and the other authoring paths are unchanged.
- **Residential East:** the spec's six house lots carry the projections. *(Slice 2 state, historical:)* the `n4` townhouse lot stayed procedural; slice 3 maps it.

### Counts at slice 2 (verified from the exported `BUILDINGS` at `5ef710b8`; historical — slice 3 raises the mapped count to 37)

- **Authored placements:** 73.
- **Placements mapped to a GLB body:** **34**, counting both own-row bodies and `visual` projections. That is mapping intent, not a count of bodies that render.
  - 9 own-row bodies, as on master;
  - 5 projections master already had;
  - issue #55's 20: slice 1's 5 and slice 2's 15.
- **Unique house source files:** 2. The manifest has 3 house rows (`arch_house_01`, `arch_house_01_compact`, `arch_residential_house_01`), so the rows outnumber the files.

## Slice 3 — the three compiled townhouse lots, on the shipped row-house body

The three compiled `townhouse` lots (7 × 6 × 7) that still rendered the procedural box now draw the Wave 3 row-house body `building_townhomes_01` (`arch_row_house_01.glb`, `53eb375b…`) at its **existing** uniform 0.8835 calibration. No manifest row, alias, file, renderer or compiler path is added: each lot uses slice 2's optional `LotAuthoringSpec.visual`.

| Placement | Position (x, z) | Authored box | Door | Applied yaw |
|---|---|---|---|---:|
| `s1_-1_s2` (Main Street East) | 98.96, −85.5 | 7 × 6 × 7 | north | π |
| `s1_-2_s2` (Main Street North) | 110, −289.5 | 7 × 6 × 7 | north | π |
| `s2_-1_n4` (Residential East) | 264.2, −110.5 | 7 × 6 × 7 | south | 0 |

- **Projection:** `{ assetId: 'building_townhomes_01', referenceSize: [7, 6, 7], canonicalFacing: 'south', maxScaleDeviation: 0 }` — uniform and facing-only. The body renders 6.961189 × 7.951500 × 5.286783 m with its base at the ground, max half-extent 3.4998 of the lot's 3.5 under the applied yaw.
- **Roof above the box:** the 7.9515 m rendered top is taller than the 6 m authored box (6.5 m with its roof slab). The occluder keeps the authored footprint and covers the projected top, the same policy as the Wave 3 townhomes placement; no box-height waiver.
- **Unchanged:** ids, positions, sizes, doors, labels (none), template colours and the procedural fallback, front-detail props, colliders and routes; the row-house manifest row and its own `building_townhomes_01` placement. No apartment interaction is added.
- **Counts (current, slice 3):** **37** of 73 authored placements are mapped to a GLB body in the exported `BUILDINGS` (28 projections + 9 own-row bodies). That is mapping intent, not a count of bodies that render and not visual acceptance.

**Status:** source, CPU tests and one bounded in-game run whose framing check is false. See [Slice 3 evidence and status](#slice-3-evidence-and-status-2026-09-15).

## What stays out

- **Other building roles.** Every `building_house_*` lot and every compiled townhouse lot is now mapped. Several shop, office and other placements already carry their own row bodies and are not changed here. The **remaining unmapped** shops, cafés, depots, warehouses, offices, towers and the waterfront free lot stay procedural; each needs its own role decision.
- **Wave 3's config and provenance.** They still record Wave 3's own four house placements. This expansion is recorded here and pinned by its own contracts instead.
- **Issue #58** (walkway surface vs collider contact), label offsets, and any global scaling framework.

## Gates

- **`src/game/assets/residentialReuseContract.test.ts`** (slice 1):
  - the exact five and the exact nine-placement union;
  - no other house lot takes the 5.5 m row;
  - authored facts including fallback colours;
  - the unchanged archetype row;
  - facing-only projection with the per-door yaw;
  - lot containment after yaw;
  - occluder footprint and height;
  - no overlay grid, and distinct seeds.
- **`src/game/assets/residentialNext15Contract.test.ts`** (slice 2):
  - both source files byte-identical;
  - exactly **twenty** house projections added relative to master (plus slice 3's three townhouses, pinned in their own contract), and nothing master mapped dropped;
  - 28 projections and 37 of 73 placements mapped to a GLB body (34 at slice 2, before slice 3's three);
  - per-body placement sets;
  - **every other placement and every prop byte-identical to master's export** (sha256 of `BUILDINGS` with only the twenty house visuals and the three townhouse visuals removed, and of `PROPS`);
  - authored facts;
  - uniform, facing-only projection;
  - **yaw containment measured from the GLB accessor bounds**;
  - the compact row sharing the red file, with the other two rows unchanged;
  - occluder height;
  - no overlays, and distinct seeds.
- **`src/game/assets/residentialTownhouseContract.test.ts`** (slice 3):
  - the shipped row-house file byte-identical and its manifest row unchanged;
  - the three lots' exported authored facts;
  - exactly these three projections; 37 of 73 placements mapped to a GLB body;
  - every other placement (including the twenty earlier issue #55 mappings) and every prop hashed equal to the delivered slice 2 export;
  - uniform facing-only projection, byte-measured yaw containment, and the occluder covering the projected 7.9515 m roof.
- **`src/game/world/residentialReuseBuildings.test.tsx`**, for all twenty-three lots:
  - one body when loaded;
  - the complete procedural house on failure, signature-equal to a direct `BuildingMesh`;
  - calibration and base offset on the primitive, yaw on the nested projection group;
  - both red rows requesting one URL while keeping separate branch counts.
- **`src/game/world/authoring/sectorAuthoring.test.ts`:** the lot visual reaches the compiled building, and removing the optional field changes nothing else in the compiled sector.
- **`src/game/assets/wave3Contract.test.ts`:** its "no Wave 3 body elsewhere" rule is **narrowed, not deleted** (CONVENTIONS #39).
  - *By manifest id:* slice 1's five are exempt, only through `arch_house_01`, and slice 3's three townhouses, only through `building_townhomes_01`.
  - *By body file:* outside Wave 3's own placements, only slice 1's five (through `arch_house_01`), slice 2's five compact placements (through `arch_house_01_compact`) and slice 3's three townhouses (through `building_townhomes_01`) may draw a Wave 3 file. A calibration row cannot bypass the id check.

## Slice 1 evidence and status (2026-09-15, at `8fa09443`)

A bounded coverage increment, **not final visual cohesion**. That run used the pre–issue #56 default rig, which had a defective 2.93 m envelope.

**Unit and contract gates** (at the evidence bytes):
- the two new test files pass 18/18;
- the full vitest suite passed 189 files / 1,691 tests before the render test's fallback assertion was strengthened;
- `tsc -b --force` clean; oxlint 0 errors;
- build and dist test-API leak 0; `checkDistClean` clean; asset report 0 over budget.

**One owned in-game job** (headed, Apple M5 Pro Metal, served the branch's working tree):
- All five placements render the approved body at the ordinary camera from their door side, grounded, porch toward the authored door.
- All nine `arch_house_01` placements count as `model`, and the archetype is active and never failed.
- With the GLB aborted, all nine render the complete procedural house, the branch is failed, and the only errors are the aborted fetch.
- A player-at-front-door view and a near-corner review view were captured.

**Unload/reload: not demonstrated.**
- `SectorDirector` pins the apartment street-exit sector every frame.
- `APARTMENT_STREET_EXIT` (−12.5, −7.2) lies in `s0_0`, as do all five houses, so ordinary streaming never unloads them. From `[260, −100]`, `s0_0` stayed `reduced` with every placement mounted.
- Remounting stays covered by the branch-lifetime unit tests.
- The existing Wave 4 E2E comment claiming that trip unloads the central sector appears inaccurate for the same reason. Noted, not changed.

**Focused no-update visual run** (14 residential-framing tests, no baseline updated): 9 passed, 5 failed.

Playwright's own reported values (final recorded attempt, raw `results.json` / `list.log`):

| test | differing pixels | ratio |
|---|---:|---:|
| `block-residential-west` | 47,280 | 0.06 |
| `block-residential-south` | 67,224 | 0.08 |
| `residential-street` | 41,931 | 0.05 |
| Wave 3 context `house-w2-west` | 20,086 | 0.03 |
| Wave 3 context `house-s2-south` | 27,377 | 0.03 |

Every failure contains the new houses **and** differences issue #55 does not touch: parked-car bodies (procedural box → GLB), the HUD clock and, in one frame, an NPC pose.

A separate, cruder measurement, which is **not** Playwright's metric (per-pixel RGB-sum difference > 30, over hand-drawn boxes around the new houses), gives:
- 3.4–13.7% of pixels differing inside those boxes;
- 0.3–1.8% outside them.

**Reading:** the out-of-house part is under the 3% tolerance, and these tests passed before this change. That is consistent with pre-existing stale pixels exposed by the new house pixels (CONVENTIONS #6), but **the attribution is mixed and unproven**. No baseline was updated.

## Slice 2 evidence and status (2026-09-15)

A bounded coverage increment for these fifteen placements — **not final visual cohesion**, full-scene quality or low-end performance acceptance. Slice 2 is judged against the corrected issue #56 default rig (a 2.15 m envelope, merged locally into this branch), not the defective 2.93 m one.

**CPU gates** (the reviewed slice 2 source, before this documentation update):
- focused suites: 13 files / 163 tests passed;
- terminal gate: `tsc -b --force` 0, oxlint 0, `vitest run` 191 files / 1739 tests passed, build 0, dist `GAME_TEST_API` 0, `checkDistClean` clean, asset report 38 files / 0 over budget.

**One owned in-game job** (headed Chromium, Apple M5 Pro Metal; 47 s; 12 PNGs; no retry): **13 of 14 checks true, one false.**
- Every row was mounted, rendered its model and was active, never failed, at all 11 healthy steps.
- Zero request failures, page errors or console errors in the healthy context.
- Compiled Residential East: the sector really unloaded (tier `unloaded`, all six houses unmounted), and on return all six remounted as models.
- **Terracotta file aborted:** every mounted terracotta placement rendered the complete procedural house (branch failed) while both red rows stayed models.
- **Shared red file aborted:** BOTH red rows — `arch_house_01` and `arch_house_01_compact` — rendered procedural with both branches failed, while terracotta stayed a model.
- Errors matched only the aborted file's exact path.
- From those district views the three compiled compact lots were not mounted (legitimate streaming), so the failure evidence for the compact row covers its two handwritten lots.
- **Framing check false:** 6 of 12 PNGs did not frame every member house by projection. One house per two- or three-house group was cropped: `building_house_s1` (at the frame edge; fully shown in the separate door close-up), `building_house_s3`, `s2_-1_n1` (twice) and `s2_-1_s3`.
- The compact `building_house_w5` door close-up was heavily faded by the ordinary occlusion fade, so its opaque doorway scale was not judged in that run.

**Completion capture** (one small follow-up run, not a retry; 16 s; 4 PNGs; 7 of 7 checks true):
- `building_house_s3`, `s2_-1_n1` and `s2_-1_s3`, each captured alone at the ordinary camera, framed fully by projection, each mounted as its row's model with the row active.
- `building_house_w5` at the ordinary zoom with the camera orbited to the reverse side: the house measured opaque (opacity 1, no forced fade), and its porch, door and player relationship read at about player height — acceptable for this bounded mapping increment.
- Zero request failures, page errors or console errors.

With these, every one of the fifteen houses appears fully in frame in at least one native image. That is evidence for delivering these fifteen placements, not visual acceptance of the whole scene; the original 13/14 run and its six framing misses stay recorded above.

**Not run:** full E2E, the visual suites and CI; this tree's CI result is unknown. **No baseline was updated.**

**Still open:**
- **Style:** the houses mix a cartoon terracotta texture with an aged, photographic red-house texture, and both read differently from their procedural neighbours.
- **Repetition:** the identical red cottage appears repeatedly along each street.
- **Roof height:** the two bodies differ by 1.297 m, which reads clearly at the ordinary camera.
- Label/UI clearance, low-end performance and issue #58 surface contact.

## Slice 3 evidence and status (2026-09-15)

A bounded mapping increment for these three placements — **not final visual cohesion**, full-scene quality or low-end performance acceptance.

**CPU gates** (the slice 3 source before this documentation update):
- `tsc -b --force` 0, oxlint 0;
- `vitest run` 192 files / 1753 tests passed; the unit logs carry texture-blob warnings;
- build 0, dist `GAME_TEST_API` 0, `checkDistClean` clean (51 files), asset report 38 files / 0 over budget.

**One owned in-game job** (headed Chromium, Apple M5 Pro Metal; 28 s; 5 PNGs; no retry; source fingerprint unchanged during the run): **12 of 13 checks true, one false.**
- **Healthy views:** each townhouse, viewed alone at the ordinary zoom from its door side (azimuth π, π, 0; the player 6 m out on the door side), rendered the row-house model at material opacity 1.
- **Healthy rows:** at every healthy step, all four house rows (row-house, terracotta, red, compact red) had mounted representatives rendering their model, with the branch active and never failed.
- **Unload and return:** Main Street North `s1_-2` really unloaded (tier `unloaded`, `s1_-2_s2` unmounted) while the player stood in `s0_0`, and on return `s1_-2_s2` remounted as the model.
- **Healthy errors:** zero request failures, page errors or console errors.
- **Row-house file aborted:**
  - all four mounted row-house placements — the three townhouses and Wave 3's own `building_townhomes_01` — rendered procedural, with the branch failed;
  - terracotta, red and compact red stayed active models;
  - one failed request, one console error and four page errors, all naming the exact aborted path, and no unrelated errors.
- **Framing check false on all 5 PNGs.**
  - **What it measures:** the corners of the authored 7 × 7 footprint extruded to the 7.9515 m rendered top — a conservative box, not the mesh — which must lie 8 px inside the viewport.
  - **Result:** in every shot that box spans x 616–952.5, y −34.2–396.1, so its top lies above the image.
  - **Native PNGs:** each healthy model, including roof, chimney and front platform, is fully in frame. The failure shot's procedural fallback has its upper roof edge cropped.
  - **Not claimed:** all five fully framed, or a measured mesh projection in place of the check. There is no complete framing proof for the fallback.

**Visual reading** (these three placements only):
- **Street front:** in the three healthy views, front doors, windows and the porch platform face the authored street.
- **No visible defects:** no floating base, and no duplicate procedural body.
- **Unchanged collision and occlusion:** the taller body keeps the 6 m authored physics box and the projected-top occluder.
- **Not implied:** doorway interaction, roof collision, hidden sides or low-end performance.

**Not run:** full E2E, the visual suites and CI; this tree's CI result is unknown. **No baseline was updated.**

**Still open:**
- **Style:** the aged, photographic row-house texture reads differently from its procedural neighbours.
- **Repetition:** the same body now appears at four placements.
- Label/UI clearance, low-end performance and issue #58 surface contact.
