# Integration Wave 3 — high-impact building replacements (issue #44)

Wave 3 seats six owner-approved 2026-08-31 sprint **building bodies** — an **apartment**, a
**shop**, a reusable detached **house**, a **row house**, a **repair garage** and a **hotel** —
onto **nine** existing authored building placements, on exactly the terms
[Wave 0](ASSET_INTEGRATION_WAVE_0.md) used for the office and park bench,
[Wave 1](ASSET_INTEGRATION_WAVE_1.md) used for the vehicle bodies and
[Wave 2](ASSET_INTEGRATION_WAVE_2.md) used for the street props.

This is deterministic visual intake and projection. **No Meshy call, paid generation,
enhancement, remesh, retexture, rig, animation or asset purchase was involved — 0 credits.**
The sources are the same already-approved sprint outputs, reduced and normalized in-repo.

Nothing gameplay-facing changed. No building id, position, `def.size` footprint, collider,
entrance/door anchor, interaction, label meaning, district membership, streaming identity,
occluder descriptor, save field or second building renderer was added or altered. Every
projected body is a purely visual child of the SAME `LandmarkAsset` slot the Quaternius
landmarks and the Wave 0 office already use, and every one of the nine placements keeps
`BuildingMesh` as its fallback.

## What shipped

| Placement(s) | Manifest id | Shipped file | Tris | Texture | Size |
|---|---|---|---:|---|---:|
| `building_apartment_01` | `building_apartment_01` | `public/assets/models/city/arch_apartment_01.glb` | 20,817 | 1024² jpeg | 1,380,496 B |
| `building_shop_01` | `building_shop_01` | `public/assets/models/city/arch_shop_01.glb` | 16,089 | 1024² jpeg | 1,019,504 B |
| `building_house_01`, `building_house_r2`, `building_house_w2`, `building_house_s2` | `arch_house_01` | `public/assets/models/city/arch_house_01.glb` | 17,208 | 1024² jpeg | 1,199,528 B |
| `building_townhomes_01` | `building_townhomes_01` | `public/assets/models/city/arch_row_house_01.glb` | 18,374 | 1024² jpeg | 1,517,372 B |
| `building_garage_01` | `building_garage_01` | `public/assets/models/city/arch_repair_garage_01.glb` | 11,214 | 1024² jpeg | 946,876 B |
| `building_gate_hotel_01` | `building_gate_hotel_01` | `public/assets/models/city/arch_hotel_01.glb` | 20,520 | 1024² jpeg | 1,608,588 B |

Full provenance — source paths, source and output SHA-256, exact operations, measured bounds,
per-side facade measurements and structure — lives in
[`asset-provenance/wave3-provenance.json`](asset-provenance/wave3-provenance.json).

**Exactly nine placements, and no others.** The four house placements are one per
district/central area on purpose. `building_house_r1` keeps its issue #25
`arch_residential_house_01` archetype and every other authored house stays procedural, so the
residential streets keep their variety. `wave3Contract.test.ts` carries the negative assertion
for every unselected building in `BUILDINGS`.

## Two wiring paths, both pre-existing

| Path | Used by | Why |
|---|---|---|
| **id-keyed manifest row** | the five 1:1 placements (apartment, shop, townhomes, garage, hotel) | Each has exactly one placement, so the manifest row *is* the projection: one `scale`, one `rotation`. This is what issue #38 Wave 0 did for `building_office_01`. |
| **`BuildingDef.visual` archetype** | the four house placements → `arch_house_01` | One downloaded, cloned scene backs four placements. This is the issue #25 reusable-archetype mechanism, unchanged. |

The apartment and townhome rows were **reconciled in place** rather than duplicated: they keep
their ids and simply point at the approved body. The two files they used to point at
(`quaternius_building_medium_2.glb`, `blocklife_apartment_hq_01.glb`) had no other placement and
were deleted rather than left shipping into `dist/` as dead payload. The still-referenced CC0
kit files — `quaternius_building_small_1.glb` (the gym) and `quaternius_building_large_2.glb`
(the backdrop tower, with its issue #21 §6 palette variant) — are untouched.

## Deterministic intake

```
node scripts/asset-intake/buildWave3.mjs           # rebuild
node scripts/asset-intake/buildWave3.mjs --check   # verify committed bytes, worktree untouched
```

`buildWave3.mjs` shares every primitive with Waves 0–2 through
[`scripts/asset-intake/lib.mjs`](../scripts/asset-intake/lib.mjs) — the same read, assert,
normalize, prune, texture-reduce and verify steps. Per body:

1. assert the **owner-approved SHA-256** before the file is opened (plus byte count and triangle
   count against the issue #44 table), read-only;
2. rename the single material to `baked_atlas`;
3. assert the origin is already at the base and the shipped minimum lands on **y = 0** (all six
   sources are bottom-origin, so **no vertical transform is applied**);
4. `dedup()` + `prune()`;
5. `textureCompress` → **1024² JPEG q85, lanczos3**;
6. assert the **mesh digest is byte-identical** across the transform — geometry, indices,
   topology, triangle count and proportions preserved;
7. assert the bounding box did not move at all;
8. assert runtime-safe: metallic 0, emissive `[0,0,0]`, no emissive texture, no cameras, no
   lights, no Draco/meshopt/KTX2/unlit, embedded textures only.

`--check` rebuilds into a real temp directory **outside** the worktree and compares hashes, so a
verification run never dirties the tree.

### Why 1024 and not Wave 2's 512

Wave 2 halved the policy ceiling because a street prop is a few dozen pixels tall at play
distance and is instanced dozens of times. A building is the opposite on both counts: it fills a
large part of the frame (the apartment is 24 m tall and hundreds of pixels high from the shipped
camera), and each body is placed once — four times for the house archetype, which shares one
download, one geometry and one material. Detail is what is visible here, so Wave 3 sits at the
**1024² policy maximum `scripts/assetReport.mjs` already enforces**, not below it. No ceiling was
raised.

### Orientation is measured, never guessed

Issue #44 forbids deriving orientation from a filename, and a wrong guess is not cosmetic: it
puts a shop's glazed front against a back alley and turns an authored door anchor into a blank
wall. Two independent pieces of evidence decide each body's canonical facing:

- **rendered cardinal captures** of the shipped bytes (the primary evidence — see
  [Visual evidence](#visual-evidence));
- a **per-side facade profile** measured from the real vertices by the intake and recorded in the
  provenance: for each of the four sides, the face span, how far the lower body is recessed
  behind that side's outermost plane over the *entrance band* (the bottom 30% of the body), and
  the vertex density near that plane. Door frames, shutters, steps and awnings are geometry, so
  an entrance elevation is markedly denser than a blank gable.

Both agree on all six: **every approved body's front is its own +z elevation** — the repo's
`'south'` — so `canonicalFacing: 'south'` is declared for all six and the per-placement yaw comes
entirely from the authored `def.door`.

| Body | Front elevation (measured) | Authored door | Applied yaw |
|---|---|---|---:|
| apartment | +z (symmetric; no distinguishable entrance elevation) | south | 0 |
| shop | +z — glazed shopfront, awning, signboard | south | 0 |
| house | +z — front door, porch posts, steps | north / south / east | π / 0 / π⁄2 |
| row house | +z — two front doors; ±x are blank party walls | south | 0 |
| repair garage | +z — the pair of orange roller shutters | west | −π⁄2 |
| hotel | +z — centred canopy over double doors (all four elevations are entrances) | west | −π⁄2 |

## Projection — how the scale was derived

Issue #44 forbids moving a single authored footprint, so the body is fitted to the **lot**, never
the lot to the body. For each placement:

```
s = floor( min( (w/2) / hx , (d/2) / hz , MAX_RENDERED_HEIGHT / sizeY ) * 1e4 ) / 1e4
```

where `(w, d)` is the placement's authored `def.size` footprint in `cityLayout.ts` and `hx`, `hz`
are the model's measured **half-extents** *after* the canonical-facing yaw — a ±90° yaw swaps
which measured half-extent faces which lot axis, and computing the fit before the yaw is exactly
how a body ends up overhanging one axis while under-filling the other. Every measured dimension
is inflated by `BOUNDS_EPSILON = 5e-5` first, which is half of `measureBounds`' 4-dp rounding
step: without it a value that rounded DOWN could let the derived scale overhang the lot by up to
5e-5 units.

The scale is **uniform**, so every approved body ships with its own proportions undistorted.

| Placement | Authored lot (w × h × d) | Yaw | Scale | Rendered (w × h × d, world) | Binding bound |
|---|---|---:|---:|---|---|
| `building_apartment_01` | 9 × 7.5 × 9 | 0 | 0.6000 | 5.538 × 15.000 × 5.118 | **height ceiling** |
| `building_shop_01` | 6 × 5 × 6 | 0 | 1.206 | 5.993 × 4.824 × 4.884 | X (half 2.9998 / 3) |
| `arch_house_01` (×4) | 5.5 × 4.5 × 5.5 | per door | 0.9515 | 5.494 × 4.757 × 5.064 | X (half 2.7497 / 2.75) |
| `building_townhomes_01` | 7 × 6 × 7 | 0 | 0.8835 | 6.961 × 7.952 × 5.287 | X (half 3.4998 / 3.5) |
| `building_garage_01` | 8 × 5.5 × 7 | −π⁄2 | 0.6304 | 4.834 × 3.782 × 6.992 | world Z (half 3.4995 / 3.5) |
| `building_gate_hotel_01` | 9 × 13 × 8 | −π⁄2 | 0.8333 | 8.446 × 14.999 × 7.618 | **height ceiling** |

`wave3Contract.test.ts` recomputes every one of those numbers from `BUILDINGS`, `MAX_RENDERED_HEIGHT`
and the committed bytes — including that one of the three bounds really is saturated
(`fill > 0.999`), so a body can never be silently shrunk to a doll's house by a copied constant.

### The reusable house archetype is facing-only

All four house placements share the same 5.5 × 5.5 authored footprint, so ONE uniform
calibration serves all four and the per-placement projection carries only the door yaw. The
projections declare **`maxScaleDeviation: 0`**, which pins the resolved projection scale to
exactly `[1, 1, 1]`. Without it, the one placement with a different authored *height*
(`building_house_s2`, 4.2 against the 4.5 reference) would have squashed this approved body by
6.7% on Y alone — a non-uniform distortion of an approved asset, which issue #44's "uniform
scale" rule forbids. Each placement still gets its own `overlaySeed`, so the reuse is not
detectable as a clone through any shared per-building randomness.

### The camera-engulf ceiling — a defect this wave found and fixed

`FollowCamera` is not a free camera. It sits at `player + (12, 18, 12)` — 18 m above its target,
16.97 m out horizontally — and its `near` is **−200**, so geometry behind the camera plane is
deliberately drawn (that is what stops tall buildings being sliced open into hollow cutaways).
Every one of the 47 authored buildings in `cityLayout.ts` is shorter than 18 m; the tallest is
`building_tower_04` at 17 m, a backdrop outside the play area. The shipped city therefore has an
**unwritten invariant: no building near a walkable position is tall enough to contain the
camera.**

A pure footprint fit broke it. The apartment measures 25 m and would have rendered at **24.31 m**
in its 9 × 9 lot — roof 6.31 m ABOVE the camera. Standing in the central plaza with the DEV orbit
at π puts the camera at **(−12, 18, −12)**: inside that footprint, under that roof. The frame
fills with the inside of the roof and the subject disappears. Seven Wave 0 candidate-character
baselines caught it, and `character-player-beside-kim` caught the matching occlusion failure —
the player hidden behind 16 m of mass that sits ABOVE the 8 m occluder box, so detection never
fires and the facade never fades.

**This was never test-only.** Any player walking within ~17 m of that building on the right
bearing gets the same camera-inside-a-roof view in normal play.

The fix is `MAX_RENDERED_HEIGHT = 15.0` as a third bound on the uniform fit. 15 m is not
arbitrary: it is EXACTLY what the Quaternius body this placement replaces already rendered at
(25 × 0.60), down to the same 16.2 label height. So the apartment's presentation envelope is
**preserved rather than grown**, and its occlusion behaviour — a 15 m body over an 8 m occluder
box — is byte-for-byte the pre-existing base condition, which is what issue #44's "occlusion
identity unchanged" asks for. The ceiling is applied uniformly, so it also trims the hotel from
15.72 m to 15.00 m; the hotel never actually contained the camera, so that 0.72 m is margin
rather than a fix, but one ceiling for every body beats a special case.

The cost is documented: the apartment under-fills its 9 × 9 lot (half-extents 2.78 and 2.57
against 4.5). A camera that never ends up inside a building is worth more than a filled lot.
`wave3Contract.test.ts` gates both halves — that no projected body can contain the camera, that
no authored box can either, and that the apartment holds the exact envelope of the body it
replaced.

### Rendered height is a consequence, not a free parameter

The uniform fit decides the height, bounded by the camera ceiling. Three of the nine bodies
stand above the procedural box height their placement authors:

| Placement | Authored box height | Wave 3 rendered height | Height it replaces |
|---|---:|---:|---:|
| `building_apartment_01` | 7.5 | **15.00** (at the ceiling) | 15.0 (Quaternius Building_Medium_2 @ 0.60) — **unchanged** |
| `building_gate_hotel_01` | 13 | **15.00** (at the ceiling) | — (was procedural) |
| `building_townhomes_01` | 6 | **7.95** | 10.5 (`blocklife_apartment_hq_01` @ 5.5) — **2.55 m shorter** |
| `building_shop_01` | 5 | 4.82 | — (was procedural) |
| `arch_house_01` (×4) | 4.5 / 4.2 | 4.76 | — (was procedural) |
| `building_garage_01` | 5.5 | 3.78 | — (was procedural) |

This is a **presentation** property of a placement that already had one: `building_apartment_01`
has shipped a 15 m visual over a 7.5 m authored box since the Quaternius integration, and
`building_townhomes_01` a 10.5 m visual over a 6 m box since issue #21 §6. Wave 3 makes the
apartment's overhang larger and the townhome's smaller.

**`def.size` remains the sole authority** for the collider, the occluder box, routing, anchors,
placement validation and every other gameplay read. Issue #44 requires occlusion identity to stay
unchanged, so `getBuildingOccluderDescriptor` still derives `bounds2D` and `maxY = h + 0.5` from
the authored box, and no Wave 3 entry declares an `occlusion` override — asserted per placement
in `wave3Contract.test.ts`, and photographed with the fade ON for the three tall bodies.

### The garage under-fills its lot, on purpose

The approved garage body is 11.09 m wide across its two-shutter elevation and 7.67 m deep. Its
placement authors `door: 'west'` on an 8 × 7 lot, so that 11.09 m elevation has to land on the
lot's **7 m** axis, which binds the fit at 0.6304 and leaves 1.58 m of lot on either side in X.
Preserving the authored entrance is worth more than filling the lot, and the same trade already
shipped in Wave 0: `building_office_01` renders 4.98 m wide in a 7 m lot.

## Colour behaviour — source colours retained

Each approved body is ONE mesh with ONE material carrying a baked base-colour atlas: walls,
windows, doors, roof and trim are painted into the same texture. There is no clean recolorable
slot to expose, and tinting the atlas would recolor the whole building. So all six declare an
explicitly **empty** `materialSlots` map — "retain the source colours" stated positively, the same
honest declaration Waves 1 and 2 made for the baked vehicle and prop bodies — and their material
is named `baked_atlas`, deliberately not a slot-candidate name.

The `building_apartment_01` row's previous `wall`/`trim` slots named **Quaternius** materials
(`MI_InteriorWall`, `MI_Trim_Green`) that do not exist in the replacement body; they were removed
with the model they described. The backdrop tower's issue #21 §6 palette variant is untouched and
still the thing under test for that mechanism.

## Window overlays — one suppression, no ghosts

`building_apartment_01` carried two authored emissive night grids, tuned for the Quaternius
Building_Medium_2 body (9.06 × 15.0 × 7.86 at 0.60). Against the replacement body they are wrong
in every dimension: the south plane at `facadeDistance 3.98` would sit **0.17 m inside** the new
8.30 m-deep facade, the east plane at 4.58 would float **0.09 m outside** it, and five rows of
glow reaching 13.2 m would cover only the lower half of a 24.3 m building.

Issue #44 allows realigning **or** suppressing a legacy grid. Suppression is the honest option
here: this body bakes its own windows into its single atlas, exactly like the row house, the
hotel and every other Wave-3 building — and exactly like the issue #21 §6 apartment, which has
carried no grid for the same reason since it shipped. The two defs are removed;
`WindowOverlays.test.tsx` pins a `SUPPRESSED_OVERLAY_IDS` list so the removal cannot be silently
undone, `CityBlock.test.tsx` asserts no grid is emitted for the apartment, and the night
treatment is photographed from both suppressed elevations.

## One door representation on the garage

`Districts.tsx` paints a rolling-door decal on the garage's **south** wall — set dressing for a
windowless procedural box. The approved body carries its own pair of roller shutters, and the
−π⁄2 yaw that points them at the authored west door maps the model's third (single) shutter onto
that same south wall. Leaving the decal would paint a second, contradictory door directly over a
real one.

The decal is therefore gated on `hasRealModel('building_garage_01')`: it renders only while no
real model is registered for that placement, which is exactly when the procedural box needs it.
Both branches are photographed. (The gate is manifest-level, not load-state-level, so the forced
missing-model capture shows the procedural garage without the painted door; the building fallback
itself is complete, which is what the "exactly one body" contract covers.)

## Payload and render stats

Measured against the **exact base** `b0d8ab6` in a second worktree, same machine, same specs,
same staging, run sequentially. No ceiling was raised.

### Production payload

| | Base `b0d8ab6` | Wave 3 | Δ |
|---|---:|---:|---:|
| `dist/` total | 27,019,343 B | 32,011,721 B | **+4,992,378 B (+18.5%)** |
| GLB bytes in `dist/` | 22,814,192 B | 27,797,124 B | +4,982,932 B |
| GLB files shipped | 25 | 29 | +4 |
| JS bundle | 4,148,217 B (gzip 1,374,094) | 4,150,641 B (gzip 1,374,420) | +2,424 B (gzip +326 B) |
| CSS bundle | 30,580 B | 30,580 B | 0 |

Six new bodies add 7,672,364 B; retiring `quaternius_building_medium_2.glb` (2,199,824 B) and
`blocklife_apartment_hq_01.glb` (489,608 B) gives 2,689,432 B back. This is the largest payload
step of the four waves, and it is the honest cost of replacing procedural boxes with textured
photogrammetry-grade bodies at the 1024² policy ceiling.

## Visual evidence

[`tests/visual/wave3-asset-visuals.spec.ts`](../tests/visual/wave3-asset-visuals.spec.ts) — 68
baselines, every one inspected by eye before it was written. See the delivery report for the
indexed list.

### Framing is derived, not tuned

A building is 3.8–24.3 m tall and the camera centres on the PLAYER, so a hand-picked zoom crops
one subject and loses another in the middle distance. `frameFor()` solves the camera geometry
instead. `FollowCamera` keeps its position at `player + R(azimuth)·(12, 18, 12)` and only re-aims
at the look target `player + (0, lookY, 0)`, so with `R = 16.97` and `Λ = 18 − lookY`,
`D = √(R² + Λ²)`, a world point lands at

```
screenUp(Q) = (Q.y − PLAYER_Y − lookY)·(R / D) − (Λ / D)·((Q − player) · ĥ)
```

Centring a body of height `h` standing `gap` away solves in closed form to
`lookY = (h/2 − PLAYER_Y ± 18·gap/R) / (1 ± gap/R)`, and its on-screen span is
`(R/D)·h + (Λ/D)·along` — the second term being the box's own depth along the camera axis, which
also projects vertically. Two bugs were found and fixed by writing this down rather than
eyeballing it: measuring the height term from the GROUND instead of from the look target (which
aimed 14 m high and photographed sky and roof undersides), and omitting the depth term (which
made a 4.8 m shop overflow a frame solved for 4.8 m of height).

The DEV orbit maps `CAMERA_OFFSET`'s horizontal direction to a pure compass direction at azimuth
`−π/4` (south), `+π/4` (east), `3π/4` (north) and `−3π/4` (west); azimuth 0 is the shipped
three-quarter view of the south-east corner.

### Why the six-asset cardinals are shot in isolation

The first capture pass shot all four cardinals of every body at its own placement. Two of them
came back unjudgeable, and not because of framing: the Mini Mart's **west** elevation stands
9.5 m from a 24.3 m apartment tower and its **east** elevation 2 m from the 6 m Book Nook. The
shipped rig puts its camera 18 m above the look target, so no camera it can produce sees past a
24 m neighbour at that distance — those two elevations are physically unphotographable in situ.
Issue #44 says to reject an occluded capture rather than ship it.

So the ASSET evidence (requirement 1) uses the existing DEV review hook `setPlayerStaticGlb` —
the issue #27 H0 Calibration path that `tests/human-proof/candidateReview.spec.ts` already uses
for candidate rigs. It mounts an un-rigged GLB statically in the player slot, grounded with its
lowest vertex at `y = 0`, on open grass west of the central ring with nothing between it and the
camera, and renders it through the real renderer **at the body's shipped uniform scale** — so
these frames prove the projected size as well as the four elevations. The override is DEV-only,
non-persistent and cleared after every shot; no runtime slot, manifest row or placement is
touched. The same six bodies in their real placements are covered by the three-quarter, context,
entrance, occlusion, day/night and district blocks.

The review hook borrows the player rig, which carries a spawn heading of 180°, so a model yawed
by `y` presents the elevation at `y + 180`. That offset is **measured, not assumed**: at yaw 45
the repair garage — whose two roller shutters are unmistakably on its +z face — showed its blank
−z elevation.

### Index — 68 inspected baselines

`tests/visual/wave3-asset-visuals.spec.ts-snapshots/`, all `…-chromium-darwin.png`.

**The six approved bodies, isolated (24)** — `wave3-asset-<body>-{front,east,rear,west}` for
`apartment`, `shop`, `house`, `rowhouse`, `garage`, `hotel`. Each is that body's own elevation
presented square-on to the shipped camera, at its shipped uniform scale, grounded, on open grass
with nothing in front of it. `front` is the measured +z elevation: the shop's glazed shopfront,
the house's porch and front door, the row house's two front doors, the garage's pair of orange
roller shutters, the hotel's centred canopy. `east` / `west` are the lateral pair — the row
house's dish-and-windows gable against its plain downpipe gable, the garage's single side shutter
against blank cladding.

**The same bodies at their placements, shipped angle (6)** — `wave3-<body>-three-quarter`.

**All nine placements in city context (9)** — `wave3-context-{apartment-01, shop-01,
house-01-central, house-r2-north, house-w2-west, house-s2-south, townhomes-01, garage-01,
gate-hotel-01}`, each framed to the same 40-unit world height so they read against each other.

**Entrances on the authored doors (8)** — `wave3-{apartment,shop,house,rowhouse,garage,hotel}-entrance-<door>`,
plus `wave3-apartment-home-interactable` (the `Press E to interact with Your Apartment` prompt
still resolves in front of the new body) and `wave3-house-w2-entrance-east` (the SAME archetype
file turning its porch east for the west-district placement while it faces north and south
elsewhere).

**Occlusion, fade ON (3)** — `wave3-{apartment,hotel,townhomes}-occlusion-fade`. The body sits
between the camera and the player and fades; the fade is `wholeObject`, so the full height goes
translucent even though DETECTION still uses the authored box.

**Day and night (5)** — `wave3-apartment-day-facade` (noon: lit by the sun, not by itself),
`wave3-apartment-night`, `wave3-apartment-night-east` (both suppressed grids, gone),
`wave3-shop-night`, `wave3-hotel-night`.

**Forced missing model (6)** — `wave3-<body>-fallback-missing-model`, each at framing IDENTICAL
to that body's entrance shot, so the pair is a true A/B. The GLB request is aborted with
`page.route(...).abort()` before the page loads: `useGLTF` throws, `AssetErrorBoundary` catches,
and the complete procedural `BuildingMesh` renders — nothing in the app is stubbed or disabled.

**One door representation (1)** — `wave3-garage-south-no-decal`: the garage's south wall with the
GLB healthy, carrying the model's own single shutter and no painted stand-in over it.

**District overviews (6)** — `wave3-district-{central, north-residential, west-residential,
south-residential, east-industrial, downtown-gateway}`, occlusion ON, the shipped aim, widened
zoom.

Five captures were REJECTED and reshot during this wave rather than blessed:

| Rejected | Why | Fix |
|---|---|---|
| shop cardinals east + west, in situ | fully blocked by a 24 m tower 9.5 m away and a 6 m neighbour 2 m away | the whole six-asset block moved to the isolated DEV review path |
| every asset elevation, first pass | the lateral pair was mirrored — "east" held the west gable | yaw mapping corrected against the offscreen reference renders |
| garage fallback | cropped: the 6.0 m procedural box is taller than the 3.78 m GLB the frame was solved for | entrance/fallback pairs framed for whichever body is taller |
| all nine context shots | a per-body fill pulled the apartment's frame to 79 units and put the diorama edge in shot | fixed 40-unit world height for every context frame |
| east-industrial district | the garage sat on the camera ray and the shipped occlusion faded it | stand point moved east of the subject |
