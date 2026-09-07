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

**Separately tracked:** master's `vehicle_compact_car_01` readiness observation in CI (bytes arrive,
`useGLTF` never returns, all four stage marks missing). A stall of a similar shape was measured on
this branch and is written up in §7 — but no shared cause has been established between them, and
none is claimed.

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

The wheel **hub colour** is a separate axis and does apply. `paint_wheel` takes the style's hub
colour through the same contribution replacement, and this is measured on rendered pixels rather
than on uniforms — Standard (`#26262c`) against Sport Alloy (`#c9ccd1`), both `radiusScale: 1.0`, so
the geometry is identical between the two frames and every changed pixel is the hub colour:

| | |
| - | - |
| changed pixels in the one-wheel ROI | **218** of 19,000 |
| bounding box of the change | 36 x 39 px — one wheel, nothing else |
| mean max-channel over the changed set | **16.7 -> 47.4** (near-black spokes to light alloy) |
| tyre patch (6x6, all-dark in both frames, inside the change box) | **0 changed** |
| bodywork clear of the arch (45x35) | **0 changed** |

Stated precisely: what recolors is the **rim and spokes**, not the whole wheel. The classifier
selects only 1.75–3.42% of each wheel's UV texels, and the rendered consequence is exactly that —
the spokes lighten, the rubber stays rubber. That is the intended behaviour and it is visible
(`docs/review/issue-50/evidence/12-hub-standard*.png` vs `13-hub-sport-alloy*.png`), but it is not
a claim that every wheel texel is a recolorable rim.

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

## 7. The loading stall: what was measured, and what changed

The first version of this work loaded the contribution map through `useLoader`, inside the same
Suspense boundary as the model. That produced a readiness stall, and a bounded diagnostic
(`markAssetStage` gained `mask-render` / `mask-returned`; Playwright `requestfinished` +
response-body reads, because the `performance` resource buffer overflows at 320 assets) separated
the stages. **One observed run**, timestamps relative to test start:

| t | observation |
| ---: | - |
| 17.9 s | `mask-render` — React reached the component; it suspends on the map |
| 18.6 s | contribution PNG complete on the wire, 688,674 B, SHA-256 `55dd1900…` |
| 20.8 s | `mask-render` + `mask-returned` — the boundary retried and the map hook returned |
| 20.8 s | `sports_car_01.glb` requested (1 ms later) |
| 21.8 s | the GLB's body complete on the wire, 921,412 B |
| 21.8–48.2 s | **nothing** — `hook-returned` absent, `pending 1 / active 0 / failed 0` |
| 48.3 s | an unrelated state change re-renders the subtree; `hook-returned`, `clone-built`, `react-commit`, `active-effect` all fire in the same instant and `pending` goes to `[]` |

Separately, an independent `new Image()` decode of the same PNG in the same page succeeded in
778–1059 ms at 1024×1024, and there were zero page errors. So in that run the bytes were complete,
the browser could decode them, and the suspended boundary resumed only when something else
re-rendered it.

**What that is and is not.** It is evidence of a completion/retry problem **in the observed run**.
It is not proof that only a second suspension can fail, it does not exonerate the earlier
texture-stage stall, and it does **not** establish a shared cause with master's
`vehicle_compact_car_01` observation (run 34159853538) — that one has a single resource and is
tracked separately.

**What changed here.** The map no longer suspends. `usePaintMask` loads it through a module-cached
`THREE.TextureLoader` promise started in `VehicleAsset` — the component that never suspends — so the
map and the model are requested in parallel and the boundary keeps exactly **one** suspending
resource, as it had before this issue. This removes the second exposure this issue would otherwise
have added; it does not claim to fix the underlying behaviour.

The error contract is unchanged, which took a correction to get right. The hook returns three
distinct states and the map is a **required** asset:

- `pending` — the body is drawn in its authored paint, and readiness does **not** count it. Marking
  the branch active here would let a visual gate photograph the authored colour and call it the
  saved one.
- `error` — rethrown **inside** the existing vehicle error boundary, so a failed map behaves exactly
  like a failed model: complete procedural `CarMesh`, the DEV warning, and the `glbFailed` census.
  An unpainted GLB reported as finished would be worse than a whole procedural car.
- `ready` — the only state that marks the branch active.

The state is keyed by URL, because React keeps the previous state through the render in which the
URL changes; without that key one render of a new entry would be handed the old entry's texture and
its `ready` status.

**Both completion orders are gated in the browser**, with a bounded route delay forcing each and no
nudge, store mutation, extra sleep or raised deadline — because moving only the map to a state
update could have woken a boundary whose model happened to be ready already, while leaving the
opposite order stuck. Both pass (`tests/visual/issue50-paint-evidence.spec.ts`).

## 8. Still open

- **`painted-sports` and `wheels-offroad` baselines** are untouched, as are all others. They still
  record the pre-Wave-1 body, so they differ on master too and their difference here says nothing
  about this change. Both were run with NO update and their expected/actual/diff triples collected
  for the reviewer at `docs/review/issue-50/legacy-baseline-adjudication/` (24,449 px and 26,874 px,
  ratio 0.03 each). Whether to re-record them, and against which body, is deliberately not decided
  in this PR.
- **`docs/review/issue-50/evidence/`** holds the rendered frames: default/charcoal/blue repaints of
  one instance in one frozen pose, an inspection close-up, two contrasting owned sports cars in ONE
  frame, the three-quarter wheel standard/off-road/round-trip sequence, and the Standard vs Sport
  Alloy hub contrast.
