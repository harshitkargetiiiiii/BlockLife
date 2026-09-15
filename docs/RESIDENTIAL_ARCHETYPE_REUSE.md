# Residential archetype reuse — five more detached houses (issue #55)

Issue #55 extends the approved detached-house archetype `arch_house_01`, which
[Wave 3](ASSET_INTEGRATION_WAVE_3.md) projects onto four authored placements, to **five more
authored lots with the identical 5.5 × 5.5 footprint**. It is a mapping expansion, not an intake:

- no GLB, texture, manifest row, renderer or cache was added;
- the archetype row keeps its uniform 0.9515 calibration and measured +z front.

| Placement | Position (x, z) | Authored box (w × h × d) | Door | Applied yaw |
|---|---|---|---|---:|
| `building_house_r4` | 10, −54.5 | 5.5 × 4 × 5.5 | south | 0 |
| `building_house_w4` | −57, 13 | 5.5 × 4 × 5.5 | east | π⁄2 |
| `building_house_w6` | −40, 14 | 5.5 × 4.3 × 5.5 | west | −π⁄2 |
| `building_house_s4` | 14, 41 | 5.5 × 4.5 × 5.5 | south | 0 |
| `building_house_s6` | −5, 55.5 | 5.5 × 4 × 5.5 | north | π |

## What each mapping is

Each lot gains exactly the `BuildingDef.visual` block Wave 3's houses carry:

- `referenceSize [5.5, 4.5, 5.5]`
- `canonicalFacing: 'south'`
- `maxScaleDeviation: 0`

The body therefore renders **undistorted at 5.4935 × 4.757 × 5.0635** on every lot. The lots authored at 4.0 m and 4.3 m are **not** squashed on Y to match their boxes, and the per-placement projection only yaws the model's front onto the authored door.

**Unchanged gameplay data:** position, `def.size`, door, colours, label and windows flag. The collider, entrance anchor, routing and occluder footprint therefore stay keyed to the authored box.

**Occluder height:** it covers whichever is taller, the box plus its 0.5 m roof slab or the 4.757 m body (issue #46 §3).

**Fallback:** a missing or failed GLB still renders the complete procedural house.

**Overlay seed:** each of the nine archetype placements keeps its own, so the reuse carries no shared per-building randomness.

## What stays out

- **The 5 × 5 lots.** This 5.5 m body does not fit them unchanged: `building_house_r3`, `r5`, `w1`, `w3`, `w5`, `s1`, `s3`, `s5`, `s7`, and the compiled lots. They need a second, correctly fitted size class, which is a later slice.
- **`building_house_r1`.** It keeps the issue #25 `arch_residential_house_01` archetype.
- **Wave 3's config and provenance.** They still record Wave 3's own four placements. This expansion is recorded here and pinned by its own contract instead.

## Gates

- **`src/game/assets/residentialReuseContract.test.ts`:**
  - the exact five and the exact nine-placement union;
  - every other house lot untouched;
  - authored facts including fallback colours;
  - unchanged archetype row;
  - facing-only projection with the per-door yaw;
  - lot containment after yaw;
  - occluder footprint and height;
  - no overlay grid, and distinct seeds across all nine.
- **`src/game/world/residentialReuseBuildings.test.tsx`:** one body when loaded, the complete procedural house on failure, the calibration on the primitive and the yaw on the nested projection group.
- **`src/game/assets/wave3Contract.test.ts`:** its "only the nine Wave 3 placements project a Wave 3 body" rule is **narrowed, not deleted** (CONVENTIONS #39). Exactly these five placements, and only through a `visual` projection of `arch_house_01`, are exempt; Wave 3's own nine stay pinned.

## Evidence and status (2026-09-15)

A bounded coverage increment, **not final visual cohesion**. Mapping coverage is not visual acceptance.

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

**Remaining limitations:**
- **Visible repetition:** the identical body appears twice across the west street (w4/w6) and three times in the south street view (s2/s4/s6).
- **Door scale:** the door reads small beside the stylised 2.93 m player.
- **Style:** the textured houses read differently from their procedural neighbours.
- **The fifteen 5 × 5 lots** stay procedural pending a separately fitted class with door/player-scale and variety checks.
