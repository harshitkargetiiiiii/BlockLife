# Vehicle paint segmentation on a baked-atlas body (issue #50)

Wave 1 (issue #40) shipped the approved sports coupe as **one mesh, one material, one baked
1024² atlas** — panels, glass, lamps, tyres and trim all in the same texture. That is why its
manifest entry declared `materialSlots: {}`: the §3 variant system recolors a whole material, so
declaring a paint slot there would have tinted the windows too. The consequence was recorded
honestly at the time and is the defect this issue closes: a player's saved paint and wheel choice
were purchased, stored, persisted and shown in the Garage, but **invisible on the body**.

Nothing here is regenerated or re-authored. The approved source is read-only, outside the
repository, and its bytes are untouched; what ships is derived from it by a deterministic pipeline
whose outputs `--check` reproduces byte-for-byte.

---

## 1. The correction that came first: PR #49's "stuck fallback" does not exist

Issue #50 opened partly on PR #49's report that an owned vehicle sat on its procedural fallback
until unrelated asset activity forced a render, evidenced by the `painted-sports` baseline. That
attribution is **wrong**, and this branch does not act on it.

| | |
| - | - |
| `painted-sports-chromium-darwin.png` last changed | `ba68922`, 2026-08-20 (#24) |
| `public/assets/models/vehicles/sports_car_01.glb` replaced | `27aa628`, 2026-09-01 (Wave 1, #41) |

The baseline **predates the binary**, so no run after `27aa628` can reproduce it. Reading the two
files confirms why the frame changed:

| | old (`5d37a01`, 493,056 B) | shipped (`27aa628`, 918,088 B) |
| - | - | - |
| materials | **`paint`**, untextured, baseColorFactor `[0.843, 0.902, 0.933, 1]` | `baked_atlas`, textured (252,650 B JPEG) |
| verts / tris | 13,249 / 11,319 | 17,971 / 14,829 |

`DEFAULT_VEHICLE_SLOTS.paint` in `VehicleAsset.tsx` lists the literal candidate `'paint'`, so the
OLD body was fully recolorable through the existing variant path. Cropping the parked car out of
the committed baseline shows a **detailed coupe** — windscreen, side glass, wheel arches, mirrors,
lamps — in the applied `#2c2c33`, next to a `CarShell` (a box plus a light-grey cabin box) in the
same frame for comparison. The baseline recorded the old GLB wearing its paint, never a fallback.
There is therefore no counter/visibility contradiction, and no activation patch was invented.

**Still genuinely open, and NOT claimed fixed here:** the `arrived-never-committed` readiness stall
reported in CI for `vehicle_compact_car_01` (bytes arrive, `useGLTF` never returns, all four stage
marks missing). It reproduced locally on this branch for `vehicle_sports_car_01`
(`expected 320 / active 319 / pending 1`, quiet for 37 s). See §7.

---

## 2. What the body actually is

Measured from the shipped bytes (`scripts/asset-intake/segmentation.mjs` re-measures all of it on
every build):

- 1 mesh, 1 primitive, 1 material, `POSITION`/`NORMAL`/`TEXCOORD_0`, 17,971 verts / 14,829 tris.
- Position-welded connectivity (1e-6, **connectivity only** — geometry is never welded) yields
  **exactly 5 components**: body 9,392 tris + four wheels 1,364 / 1,362 / 1,356 / 1,355.
- The atlas hue histogram of saturated texels is one dominant lobe at 40–60° (318,864 texels)
  against under 30,000 everywhere else: the panels are one saturated yellow; the glass, tyres,
  lamp housings and shadowed trim are near-neutral.

## 3. What is derived, offline and deterministically

1. **A five-part split** — body + one node per wheel, each wheel's vertices re-expressed about its
   own centre with the node translated back by exactly that centre, so a wheel has a real pivot.
   Wheel LOCAL coordinates change; the composed geometry does not, and the build asserts that per
   triangle: same source triangle, corner by corner in order (winding), composed position within
   1e-6, **`NORMAL` and `TEXCOORD_0` exactly equal**. Triangle count, referenced-vertex count and
   the scene root's identity transform are asserted too.
2. **A paint contribution map** — for every texel the classifier calls painted panel, that texel's
   **actual colour, byte for byte from the atlas**; zero everywhere else. Nothing is synthesized,
   averaged or grown. The build asserts the map is a pure restriction of the atlas.
3. Two materials, `paint_body` and `paint_wheel`, both still pointing at the ONE source atlas.

The classifier is a HUE test (49° ± 12, saturation ≥ 0.55, value ≥ 20), declared in
`wave1.config.mjs` and re-measured on every build against recorded figures. It is a hue test
because the first version used an absolute RGB floor (`r ≥ 150, g ≥ 110`), which classified the
flat panel colour but **excluded the shaded yellow in every seam and crease** — those then survived
a repaint as gold flecks on a charcoal car.

The build also **proves the UV row orientation from the file** rather than quoting the spec: mean
per-channel colour agreement across geometrically shared triangle edges is 43.4 for `row = v·H`
against 115.6 for `(1-v)·H`. This check exists because the first revision used the flipped mapping.

## 4. How the renderer uses it

```
contribution = texture(contributionMap, uv)          // filtered exactly like the atlas
remainder    = max(sampled - contribution, 0)        // whatever else was in this sample
brightness   = luma(contribution) / luma(reference)  // how light the authored paint was here
diffuse      = remainder + brightness * chosenPaint
```

Both terms are premultiplied by coverage, which is the quantity hardware filtering interpolates
correctly, so the result is exact at a filtered boundary as well as inside a panel — including a
boundary between paint and a **non-black** neighbour, where `remainder` is that neighbour's own
contribution. A zero contribution is the identity.

**Two simpler encodings were tried and measurably failed**, which is why the shipped one is RGB:

| encoding | what went wrong |
| - | - |
| binary coverage mask + `mix()` | At a filtered boundary between painted `P` and black, `sampled = 0.5P` and `coverage = 0.5`, so the mix returns `0.25P + 0.25C` — a quarter of the AUTHORED paint survives however perfect the mask is. On this finely chopped unwrap (2,261 raw UV islands over 14,829 triangles) that drew a gold line along every triangle edge. |
| scalar premultiplied contribution `luma(texel)/luma(reference)` | Fixes the boundary algebra but approximates every texel by ONE reference hue times a brightness, so each texel's own chroma survives the subtraction and is added back over the new paint. Measured: mean per-texel max-channel residual 0.0234 linear, max 0.2617, 89,692 texels over 0.03 — red/green mottling across the panels. |

The contribution map's sampler is matched to the atlas's — `flipY = false`, `RepeatWrapping`,
`SRGBColorSpace`, linear + linear-mipmap-linear — because the two are subtracted from each other
per sample. Any mismatch and the subtraction does not cancel.

**Cost:** the derived GLB grows 918,088 → 921,412 B (+3,324) and the contribution map is a new
688,674 B PNG (1024², decoded footprint the same as the atlas it accompanies). Total **+691,998 B**
for the one body that declares it. No other asset changes.

## 5. Wheels — and an honest limitation

The four wheel pivots let a wheel style's `radiusScale` scale a wheel in its own **radial plane**
(local X/Y; the axle axis Z is asserted), with a `radius × (scale − 1)` lift so the contact patch
stays on the road. The transform is SET, never multiplied, so repeated style changes do not
accumulate.

**Ground contact is not arch clearance, and this body cannot hold the advertised off-road radius.**
Measured by triangle/triangle intersection against the body's own geometry at its real transform
(`src/game/assets/wheelClearance.test.ts`, recomputed from the shipped bytes):

| radial scale | intersecting triangle pairs, all four wheels |
| ---: | ---: |
| 1.00 (authored) | 0 |
| **1.04 (declared cap)** | **0** |
| 1.05 | 217 |
| 1.18 (`wheels_offroad`) | 806 — the tyre passes through the wing |

So `maxWheelRadiusScale: 1.04` is declared on the manifest entry and `wheelNodeTransform` clamps to
it, reporting `clamped: true` when it does. **This is a reduction, stated as one:** on this body an
off-road wheel reads as a *slightly* larger wheel, not a markedly larger one. Nothing about the
wheel style changes in gameplay — `WHEEL_STYLES` still declares 1.18, the selection is still
stored, persisted and shown in the Garage, and every other class is unaffected. Rendering the
advertised size instead would put hundreds of wheel triangles inside the bodywork, which is a
defect, not a customization. Making 1.18 genuinely fit would mean re-authoring the arches, which is
outside this issue.

The wheel **hub colour** is a separate axis and does apply: `paint_wheel` takes the style's hub
colour through the same contribution replacement, so the painted rim recolors while the tyre — which
is outside the classified set — does not.

## 6. What is preserved

- The approved source GLB, its hash and its baked JPEG: untouched (`atlasBytesIdentical`).
- Geometry: same triangles, same normals, same UVs, same winding, same composed positions.
- The player, `blocklife_person`, all six wardrobe slots and wardrobe/save behaviour: untouched.
- Ownership, physics, colliders, tuning, economy, traffic, population and save: untouched. Paint
  and wheel selection remain exactly the values they were; only their appearance changes.
- The procedural `CarShell` fallback and the whole branch/settle/error-boundary contract: unchanged,
  and the contribution map lives inside the SAME Suspense and error boundary as the body, so a
  failure falls back to a complete procedural car rather than to a half-painted one.
- Wave 1's contract assertions are **narrowed, not deleted**: mesh and material counts are now read
  from the provenance the build emitted, and the "cannot rebind a default slot" guard is applied to
  EVERY material rather than only the first.

## 7. Open, and not claimed fixed

- **`arrived-never-committed` readiness stall.** Reported in CI for `vehicle_compact_car_01`;
  reproduced on this branch for `vehicle_sports_car_01` in the evidence spec
  (`expected 320 / active 319 / failed 0 / pending 1`, mount graph quiet for 37 s). It is NOT the
  `painted-sports` baseline phenomenon (§1), and it is not attributed here — the contribution map
  adds a second suspending resource to the vehicle boundary and its share of this has not been
  isolated. Determining whether the GLB or the map is the pending one is the next bounded step.
- **`painted-sports` and `wheels-offroad` baselines** are untouched, as are all others. They still
  record the pre-Wave-1 body; adjudicating them belongs to review, with the evidence below.
- **`docs/review/issue-50/evidence/`** holds the rendered frames: default/charcoal/blue/paper
  repaints of one instance in one frozen pose, an inspection close-up, two contrasting owned sports
  cars in ONE frame, and the three-quarter wheel standard/off-road/round-trip sequence.
