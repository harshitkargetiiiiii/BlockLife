# Integration Wave 2 — streetlights, hydrants and trash bins (issue #42)

Wave 2 seats three owner-approved 2026-08-31 sprint **street props** — a vintage lantern
**streetlight**, the corrected blank-barrel **fire hydrant** and a **trash bin** — into the
existing `street_lamp`, `hydrant` and `trash_can` prop types, on exactly the terms
[Wave 0](ASSET_INTEGRATION_WAVE_0.md) used for the park bench and
[Wave 1](ASSET_INTEGRATION_WAVE_1.md) used for the vehicle bodies.

This is deterministic visual intake and projection. **No Meshy call, paid generation,
enhancement, remesh, retexture, rig, animation or asset purchase was involved — 0 credits.**
The sources are the same already-approved sprint outputs, reduced and normalized in-repo.

Nothing gameplay-facing changed. No prop placement, collider, `PROP_SOLIDITY` entry,
`PROP_PLACEMENT` envelope, occupancy rule, streaming behaviour, district compilation, save field
or second prop renderer was added or altered. Every projected prop is a purely visual child of
the SAME `LandmarkAsset` slot the Wave 0 bench and the Quaternius props already use, and every
one of the three types keeps its procedural component as the fallback.

## What shipped

| Prop type | Placements | Archetype id | Shipped file | Tris | Texture | Size |
|---|---:|---|---|---:|---|---:|
| `street_lamp` | 66 | `prop_streetlight_01` | `public/assets/models/props/prop_streetlight_01.glb` | 6,975 | 512² jpeg | 383,580 B |
| `hydrant` | 2 | `prop_fire_hydrant_01` | `public/assets/models/props/prop_fire_hydrant_01.glb` | 8,133 | 512² jpeg | 319,392 B |
| `trash_can` | 20 | `prop_trash_bin_01` | `public/assets/models/props/prop_trash_bin_01.glb` | 7,703 | 512² jpeg | 435,972 B |

Full provenance — source paths, source and output SHA-256, exact operations, measured bounds,
structure and the measured lantern anchor — lives in
[`asset-provenance/wave2-provenance.json`](asset-provenance/wave2-provenance.json).

The archetype ids deliberately do **not** mirror the prop-type names: `prop_street_lamp_01` is an
authored *placement* in `cityLayout.ts`, and an archetype must never be confusable with a
placement. `wave2Contract.test.ts` asserts that separation.

## Deterministic intake

```
node scripts/asset-intake/buildWave2.mjs           # rebuild
node scripts/asset-intake/buildWave2.mjs --check   # verify committed bytes, worktree untouched
```

Waves 0/1's pipeline was **generalized rather than forked**: the shared primitives stay in
[`scripts/asset-intake/lib.mjs`](../scripts/asset-intake/lib.mjs) and all three waves import
them. `buildWave0.mjs --check` and `buildWave1.mjs --check` still reproduce all eight earlier
outputs byte-identically through the shared code, which is the proof that this wave's
library change moved no bytes.

Per source, in order:

1. **Assert the approved SHA-256, byte count and triangle count before reading.** A mismatch is a
   hard failure, not a warning. All three matched issue #42's table exactly.
2. Open the pristine source **read-only**; the pipeline never writes to an input path.
3. Normalize the single material's name to `baked_atlas` — deliberately NOT a slot candidate, so
   the baked source colours can never be tinted (see "Colour behaviour" below).
4. **Ground a centred-origin source** by a root-node translation (hydrant only, see below).
5. `dedup` + `prune`.
6. `textureCompress` → ≤512², JPEG q85, lanczos3.
7. **Assert the mesh digest is unchanged** across the transform, so geometry, indices, topology,
   triangle count and proportions are provably preserved, and **assert the bounding box moved by
   exactly the declared grounding offset on Y and by nothing at all on X/Z**.
8. **Assert runtime-safe:** metallic 0, emissive `[0,0,0]`, no emissive texture, no
   `KHR_materials_unlit` / `KHR_lights_punctual` / draco / meshopt / KTX2, zero cameras, and
   embedded textures only (no external URL).
9. Emit deterministic bytes + a machine-readable provenance record.

`--check` rebuilds into a real `mkdtemp` directory outside the repository with guaranteed cleanup
on every exit path, so verifying never dirties the worktree.

### Why 512 and not the 1024 policy ceiling

A street prop is a few dozen pixels tall at play distance and is instanced dozens of times across
the city — 66 lamps and 20 bins against the bench's 3. Halving the texture edge quarters the
per-asset payload for detail no player can resolve. `assetReport.mjs` still measures the shipped
dimensions from the JPEG SOF header, so the budget stays genuinely enforced (a WebP texture would
make that check pass vacuously, which is why the output format is JPEG).

### Grounding the hydrant without touching a vertex

The approved hydrant reports **minY = −1**: it is the one sprint prop that skipped the separate
`remesh` stage where `origin_at: bottom` is applied, so its origin is centred. Dropped in as-is it
would sink half its height into the pavement.

Issue #42 asks for "a documented node/root transform or manifest offset that preserves mesh
accessor bytes". The intake uses the **root-node translation**: every scene root is moved
`+1.0` on Y, which `measureBounds` (and three.js) sees, and which leaves POSITION, NORMAL and the
index buffer byte-for-byte identical — so the existing mesh-digest assertion still holds and
proves it. The shipped file measures **minY = 0.0000**, so no manifest `positionOffset` is needed
and none is used; `wave2Contract.test.ts` asserts the source really was −1, the offset really was
+1, the size and triangle count are unchanged, and the other two sources were left alone.

## Projection — how the scale was derived

Every prop TYPE already owns an authored visual envelope in
[`propPlacement.ts`](../src/game/world/propPlacement.ts) (`visualHalf` in local XZ, `vertical` as
`[minY, maxY]`) that the whole-city placement validators and the district certification read.
Issue #42 forbids changing that table, so the projected body must fit **entirely inside** it. The
scale is therefore the largest UNIFORM factor that keeps every measured extent within the
envelope — the same rule Wave 0 used for the bench, applied to each source's own measured bbox
rather than reusing the bench's constant:

```
s = floor( min( visualHalf.x / extX , visualHalf.z / extZ , (vertical[1]-vertical[0]) / sizeY ) * 1e4 ) / 1e4
```

`extX`/`extZ` are the larger of |min| and |max| on that axis (none of the three models is exactly
centred), and every measured dimension is inflated by `5e-5` first — half of `measureBounds`'
4-dp rounding step, without which a value that rounded down could let the derived scale overhang
the envelope by up to 5e-5 units.

| Prop type | Local bbox (X,Y,Z) | Authored envelope | Binding axis | Scale | Rendered W × H × D |
|---|---|---|---|---:|---|
| `street_lamp` | 0.2919 × 1.8993 × 0.4166 | half [0.26, 0.26], vertical [0, 4.11] | **Z** | 1.2425 | 0.3627 × 2.3599 × 0.5176 |
| `hydrant` | 1.3191 × 2.0000 × 0.9286 | half [0.20, 0.20], vertical [0, 0.76] | **X** | 0.3031 | 0.3998 × 0.6062 × 0.2815 |
| `trash_can` | 0.8586 × 1.8976 × 0.9026 | half [0.32, 0.32], vertical [0, 0.92] | **Y** | 0.4848 | 0.4162 × 0.9200 × 0.4376 |

[`src/game/assets/wave2Contract.test.ts`](../src/game/assets/wave2Contract.test.ts) recomputes
every number above from `PROP_PLACEMENT` and the committed bytes — including that the binding
axis really is at its bound, so a prop cannot be silently shrunk to a speck by a copied constant.

### The streetlight is shorter than the envelope it fits inside

The lamp's **Z** extent binds first: the lantern reaches `z +0.2074` and the base plinth
`z −0.2092`, against the authored `0.26` half-extent. The authored `4.11` vertical span is
therefore not filled — the projected lamp is **2.36 m** tall where the procedural pole was 4.11 m.

That is a deliberate consequence of the constraint, not an oversight. `PROP_PLACEMENT` is what the
placement validators, the anchor-clearance check and district certification read, and issue #42
pins it; the alternative — widening the envelope, or granting `street_lamp` the `canopy`
exemption that lets tree foliage overhang — would relax a whole-city invariant to make one model
fit. The lamps now read as pedestrian-scale lanterns rather than highway masts. It is the most
visible change in this wave and is flagged for the owner as a judgement call rather than buried.

## Colour behaviour — source colours retained

Each prop is **one baked mesh with one material** carrying a baked base-colour atlas: pole,
lantern glass, barrel, caps and lid all live in the same texture. There is no clean recolorable
slot to expose, and tinting the atlas recolors the whole prop.

Issue #42 is explicit — *"Expose no recolor slot for these one-material baked atlases; retain
source colours honestly"* — so:

- the intake names the single material **`baked_atlas`**, which is not a candidate in any default
  or declared slot, so it cannot be re-bound by accident;
- the three manifest entries declare **`materialSlots: {}`** — an *explicitly empty* map, which
  reads as "expose no recolorable slots, retain the source colours". An absent map would be
  ambiguous.

A hydrant's authored `PropDef.color` is **not** dropped: it still tints the procedural hydrant,
which is what renders whenever the model is missing, disabled or broken.

## The streetlight's functional night light

The approved streetlight GLB is **geometry only**. It carries no light, no emissive material and
no `KHR_lights_punctual` — the intake refuses all three, which is exactly what keeps a lamp from
self-glowing in daylight.

The repo's own night illumination is unchanged in kind: the shared `lampBulbMaterial` bulb and
the `lampGlowMaterial` ground pool that `updateGlowMaterials` drives once per frame for the whole
city. Two things had to happen for it to keep working on a new body:

1. **It follows the branch that renders.** `LandmarkAsset` gained a `glbSiblings` slot — the same
   one `VehicleAsset` gained in Wave 1 — rendered INSIDE the Suspense/ErrorBoundary. The light
   appears exactly when the model does and disappears the moment the fallback takes over, so a
   broken GLB never yields a dark lamp and a mounted GLB never keeps a duplicate procedural pole.
2. **It is positioned on the model's own lantern.** The vintage crook hangs its lantern forward
   off the pole axis, and the lantern is not even the topmost geometry (the finial is), so "the
   light is at the top of the pole" is simply false for this body. The intake MEASURES the lamp
   head from the shipped vertices — the busiest 1/20-height slab above mid-height, grown while
   neighbours hold ≥25% of the peak vertex count — and records its bbox in the provenance. The
   manifest's `nightLight` is that measurement scaled by the projection:

   | | Local (measured) | × scale 1.2425 → world |
   |---|---|---|
   | lantern centre | −0.0009, 1.5197, 0.0849 | **−0.0011, 1.8882, 0.1055** |
   | bulb radius (smallest half-extent) | 0.1225 | **0.1522** |

   The bulb radius is the lantern's *smallest* half-extent, so the emissive sphere sits inside
   the lantern body rather than poking through its glass. The shared 0.26 sphere geometry is
   **scaled**, not re-allocated, so no new geometry, material or light source enters the scene and
   the day/night lighting budget is unchanged.

The procedural fallback lamp is byte-for-byte what it always was: pole, bulb at `[0, 3.85, 0]`,
unit-scaled, plus the same ground pool. `wave2Props.test.tsx` gates both branches.

## Payload and render stats

Measured against the **exact base** `27aa628` in a second worktree, same machine, same specs,
same staging, run sequentially. No ceiling was raised.

### Production payload

| | Base `27aa628` | Wave 2 | Δ |
|---|---:|---:|---:|
| `dist/` total | 32,320 KB | 33,480 KB | **+1,160 KB (+3.6%)** |
| GLB bytes in `dist/` | 28,208 KB | 29,360 KB | +1,152 KB |
| GLB files shipped | 22 | 25 | +3 |
| JS bundle | 4,145.91 kB (gzip 1,371.52) | 4,148.22 kB (gzip 1,372.06) | +2.31 kB (gzip +0.54 kB) |

The three new files are 1,113 KB of the increase; the rest is the manifest entries and the prop
wiring. Each texture is 512² rather than the 1024² the policy allows, which is what keeps 88 new
instanced bodies inside a ~1 MB payload delta.

### Render stats

`getRenderStats()` via the DEV perf probe, on the same deterministic scenes as
`asset-perf-round2.spec.ts` and `visual-upgrade-perf.spec.ts`.

| Scene / metric | Base `27aa628` | Wave 2 | Δ | Gate ceiling |
|---|---:|---:|---:|---:|
| central city — draw calls | 1,167 | 1,164 | **−3** | < 2,500 |
| central city — triangles | 329,008 | 608,461 | +279,453 | < 4,000,000 |
| central city — geometries | 612 | 512 | **−100** | — |
| central city — textures | 323 | 326 | +3 | < 400 |
| driving — draw calls | 1,113 | 1,113 | 0 | < 2,500 |
| driving — triangles | 357,284 | 601,026 | +243,742 | < 4,000,000 |
| Stage-A scene — draw calls | 1,206 | 1,203 | **−3** | — |
| Stage-A scene — unique materials | 1,592 | 1,542 | **−50** | — |
| Stage-A scene — variant-cache keys | 0 | 0 | 0 | must stay 0 |

**Draw calls, geometries and materials all went DOWN.** A projected prop replaces several
primitive meshes with one instanced GLB body — the trash bin was 2 meshes and is now 1, the
hydrant 2 → 1, the streetlight 3 → 3 (GLB body + the two retained light meshes) — and the 88
instances share ONE geometry and ONE material per archetype instead of allocating per type.

Triangles rise ~280k, which is the honest cost of the swap: a lantern is 6,975 triangles against
the ~316 of the primitive it replaces. That is 15% of the 4M gate ceiling, and the props are
frustum-culled like any other static mesh, so off-camera instances cost nothing to draw. No
budget or ceiling was changed.

## Visual evidence

[`tests/visual/wave2-asset-visuals.spec.ts`](../tests/visual/wave2-asset-visuals.spec.ts) —
see the delivery report for the indexed list. Every capture is uncropped, shows the whole prop
and its ground contact, and was inspected by eye before any baseline was written.

### Index — 24 inspected baselines

`tests/visual/wave2-asset-visuals.spec.ts-snapshots/`, all `…-chromium-darwin.png`.

| # | Baseline | What it proves |
|---:|---|---|
| 1 | `wave2-streetlight-front` | whole lamp, shipped view, base flange on the pavement |
| 2 | `wave2-streetlight-quarter` | orbited 90° — the crook and lantern in profile |
| 3 | `wave2-streetlight-rear` | orbited 180° — opposite side, no second pole behind the model |
| 4 | `wave2-streetlight-day-head` | close read at noon: lantern glass neutral, **not self-glowing** |
| 5 | `wave2-streetlight-night-head` | **identical framing at 22:00** — the retained bulb lights the model's own lantern |
| 6 | `wave2-streetlight-night` | wide night view — the ground pool still lights the pavement |
| 7 | `wave2-streetlight-context-central` | central ring among the other street furniture |
| 8 | `wave2-streetlight-context-east` | east industrial approach (second district) |
| 9 | `wave2-hydrant-front` | whole hydrant, bonnet/barrel/outlets, kerb contact |
| 10 | `wave2-hydrant-quarter` | orbited 90° — outlet axis end-on |
| 11 | `wave2-hydrant-rear` | orbited 180° — opposite face of the barrel |
| 12 | `wave2-hydrant-closeup-blank-barrel` | **the barrel is smooth and blank — no pseudo-text** |
| 13 | `wave2-hydrant-closeup-blank-barrel-rear` | the other half of the barrel, equally blank |
| 14 | `wave2-hydrant-context-waterfront` | West Commons kerb, in traffic/sidewalk context |
| 15 | `wave2-hydrant-context-central` | Corner Café sidewalk (second district), with a Wave 2 lamp in shot |
| 16 | `wave2-trashbin-front` | whole bin, lid and ribbed body, ground contact |
| 17 | `wave2-trashbin-quarter` | orbited 90°, beside the Wave 0 bench |
| 18 | `wave2-trashbin-rear` | orbited 180° — no second procedural can behind the model |
| 19 | `wave2-trashbin-context-south` | south district sidewalk |
| 20 | `wave2-trashbin-context-east` | east industrial crossing (second district), with a Wave 2 lamp in shot |
| 21 | `wave2-trashbin-context-central-park` | central park edge (third district) |
| 22 | `wave2-hydrant-fallback-missing-model` | **A/B with #9** — GLB request aborted → the complete procedural hydrant, authored colour intact |
| 23 | `wave2-streetlight-fallback-night` | **A/B with #6** — GLB aborted → the complete procedural lamp, pole AND functional light |
| 24 | `wave2-trashbin-fallback-missing-model` | **A/B with #16** — GLB aborted → the complete procedural can |

The three fallback captures abort the model's HTTP request with `page.route(...).abort()` before the
page loads. Nothing in the app is stubbed, disabled or given a test-only switch: `useGLTF` throws,
`AssetErrorBoundary` catches, and the procedural component renders — exactly what a deleted or
truncated file does in production.

### Framing note

The camera centres on the PLAYER, and `FollowCamera` sits at `player + (12, 18, 12)`, so its
screen-right axis in world space is `(+√½, 0, −√½)` rotated by the DEV orbit. The first capture
pass used the intuitive `(+x, +z)` stand-off, which is almost exactly the screen-VERTICAL axis
here — it put the player's body directly in front of the subject and buried a hydrant and a bin.
The spec now derives the stand-off from that basis (`screenRight()` / `standBeside()`), so every
subject sits clear of the player at the same screen height, at any orbit. Two hydrant context
shots additionally needed a 180° orbit: from the shipped angle the Corner Café and the West
Commons block stand between the camera and those two kerbs.

## Baseline migration — 24 added, 1 modified, 0 deleted

The full 220-shot visual suite was run with **no** `--update`. 216 passed.

**Three failures were timeouts, not image deltas**, in a 1.7-hour saturated run: two
`social-visuals` phone screens and one `vehicle-visuals` dealership screen, each a
`page.waitForFunction` / test timeout. All three **pass when re-run alone**, so they are the known
contention flake (CONVENTIONS #4), not a regression, and no baseline of theirs was touched.

**One baseline was genuinely different and is migrated:**
`weather-visuals.spec.ts-snapshots/weather-rain-central-evening-chromium-darwin.png`.

Its delta is larger than this wave's prop pixels, so it was traced rather than blessed:

1. The diff flags the streetlight and the trash bin (intended), **and** the whole
   `building_office_01` massing plus its floating label — which this wave cannot touch.
2. The label moved to `labelHeight: 10.2`, which only applies when that entry's **GLB** renders.
   So the committed baseline held the office's procedural **fallback** and the new capture holds
   its GLB.
3. `assetsSettled()` was probed and is `true` at every sample from 0.5 s to 9 s after staging, so
   the frame is not mid-load in any obvious sense — the counter is simply *vacuous* here (see below).
4. **At the exact base commit**, staging the identical scene and waiting 12 s instead of 2.8 s
   produces the office **GLB** — pixel-for-pixel the same building and label position as the new
   baseline. So the committed baseline was a **stale transient captured at the base commit**, not
   something this wave changed.

Root cause: `setupWeatherScene` waited for `assetsSettled()` **before** `resetGame()` +
`teleportPlayer()`. Those remount every streamed sector, and during a remount `glbLandmarksExpected`
briefly drops to 0 while `glbLandmarksActive` is still high, so `active + failed >= expected` is
vacuously true and the boot-time wait says nothing about the scene being photographed. The frame
then landed on a fixed 2,800 ms deadline, and whichever models happened to be up got captured.
Wave 2 adds 88 prop instances to those sectors, which shifted that timing enough for the settled
state to land inside the window.

The fix is in `setupWeatherScene`: let the remounted instances register, then wait for them to
actually commit, and keep the existing 2,800 ms settle. **Nothing was weakened, skipped, renamed
or given a longer assertion timeout** — a blind deadline was replaced with a real readiness gate.
Re-running the whole weather spec after the fix, **only this one baseline changed**; the other
four still match their committed bytes.

The 24 Wave 2 baselines are all new files. No baseline was deleted.
