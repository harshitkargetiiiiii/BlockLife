# Integration Wave 1 — completing the owned-vehicle garage (issue #40)

Wave 1 seats the three remaining owner-approved 2026-08-31 sprint vehicle bodies —
**scooter**, **utility van** and **sports coupe** — into the three existing non-compact
owned-vehicle visual slots, completing the four-class garage that
[Wave 0](ASSET_INTEGRATION_WAVE_0.md) started with the compact sedan.

This is deterministic visual intake and projection. **No Meshy call, paid generation,
enhancement, remesh, retexture, rig or asset purchase was involved — 0 credits.** The sources
are the same already-approved sprint outputs, reduced and normalized in-repo.

Nothing gameplay-facing changed: no rigid body, renderer, vehicle class, ownership entry, save
field or projection path was added. `VehicleAsset` remains a purely visual child of the ONE
physical shell, and every class still falls back to `CarMesh`.

## What shipped

| Runtime slot | Class | Shipped file | Tris | Texture | Size |
|---|---|---|---:|---|---:|
| `vehicle_scooter_01` | `veh_scooter` | `public/assets/models/vehicles/scooter_01.glb` | 20,401 | 1024² jpeg | 1,527,060 B |
| `vehicle_utility_van_01` | `veh_van` | `public/assets/models/vehicles/utility_van_01.glb` | 14,413 | 1024² jpeg | 1,142,064 B |
| `vehicle_sports_car_01` | `veh_sports` | `public/assets/models/vehicles/sports_car_01.glb` | 14,829 | 1024² jpeg | 918,088 B |

The stable paths and asset ids are unchanged — only the bytes behind them. Full provenance
(source paths, source and output SHA-256, exact operations, measured bounds, structure) lives in
[`asset-provenance/wave1-provenance.json`](asset-provenance/wave1-provenance.json).

Also removed: `public/assets/models/vehicles/compact_car_01.glb`, round 1's untextured compact
body. Wave 0 moved `vehicle_compact_car_01` onto `compact_sedan_01.glb` but left the old file in
`public/`, so Vite kept copying a **dead duplicate production GLB into `dist/`**. Nothing
referenced it; the only mention was a fixture *string* in `VehicleAsset.test.tsx`, now pointed at
the file the class actually ships.

## Deterministic intake

```
node scripts/asset-intake/buildWave1.mjs           # rebuild
node scripts/asset-intake/buildWave1.mjs --check   # verify committed bytes, worktree untouched
```

Wave 0's pipeline was **generalized rather than forked**: the shared primitives now live in
[`scripts/asset-intake/lib.mjs`](../scripts/asset-intake/lib.mjs) and both waves import them.
`buildWave0.mjs --check` still reproduces all five Wave 0 outputs byte-identically through the
shared code, which is the proof that the refactor moved no bytes.

Per source, in order:

1. **Assert the approved SHA-256 before reading.** A mismatch is a hard failure, not a warning.
2. Open the pristine source **read-only**; the pipeline never writes to an input path.
3. Normalize the single material's name to `baked_atlas` — deliberately NOT a paint-slot
   candidate, so the baked source paint can never be tinted (see "Paint behaviour" below).
4. `dedup` + `prune`.
5. `textureCompress` → ≤1024², JPEG q85, lanczos3.
6. **Assert the mesh digest and bounding box are unchanged** across the transform, so geometry,
   indices, origin and wheel count are provably preserved.
7. **Assert runtime-safe:** metallic 0, emissive `[0,0,0]`, no emissive texture, no
   `KHR_materials_unlit` / `KHR_lights_punctual` / draco / meshopt / KTX2, zero cameras, and
   embedded textures only (no external URL).
8. Emit deterministic bytes + a machine-readable provenance record.

`--check` rebuilds into a real `mkdtemp` directory outside the repository with guaranteed
cleanup on every exit path, so verifying never dirties the worktree.

### Source-identity note

Issue #40's table lists **6,576,564 bytes** for the utility van. The file whose SHA-256 matches
the approved `8aa7ef19…` hash is **6,645,388 bytes**. SHA-256 is the authoritative identity and
it matches exactly (as do the ledger's 14,413 triangles), so the source is the approved one and
the issue's byte column is a transcription slip. Recorded here and in the provenance rather than
silently normalized away.

## Projection — how the scale was derived

**Two** factors decide a body's rendered size, and both are in the derivation:

1. **`AssetManifestEntry.scale`**, applied in LOCAL space **before** the entry's 90° yaw. So
   local **X** drives world **LENGTH** and local **Z** drives world **WIDTH**. Every source's
   nose is at local −X, which `rotation: [0, π/2, 0]` maps onto the shell's `+z` nose (`CarMesh`
   puts its headlights at `z = +1.96`).
2. **`shellMeshScale(def.collider)`** — the one shell scales its whole mesh group per class, in
   WORLD axes, as the class collider relative to the legacy Compact's `[1, 0.55, 2]`. It is
   `[1, 1, 1]` for the Compact (so the Wave 0 sedan derivation is unaffected) but **not** for the
   others, and it MULTIPLIES the manifest scale.

Deriving against the class footprint while ignoring factor 2 would have shipped the scooter at
**0.55×** its intended size. It was previously inlined in `Vehicle.tsx`; Wave 1 exports it from
`vehicleProjection.ts` (a pure move, no behaviour change) so the contract test reads the real
value instead of a copy.

All four sprint sources are normalized to ≈1.897 local units on their longest axis, so the
sources carry **no** real-world relative size — absolute scale has to come from the authored
class footprint in `vehicleRegistry`.

Each entry's scale is therefore chosen to **cancel** the non-uniform shell factor
(`scale.i = k / meshScale.i`), which makes the RENDERED body exactly uniform — the approved
model's proportions ship undistorted — with

```
k = min( 2·halfLength·0.97 / localX ,  2·halfWidth·0.97 / localZ )
```

0.97 is the fill the Wave 0 sedan already lands on (3.81 of its 3.90 footprint), so the whole
garage is on one convention and no body overhangs the footprint it is projected onto.

| Class | Local bbox (X,Y,Z) | `shellMeshScale` | k | Manifest scale | Rendered L × H × W | Footprint (L × W) |
|---|---|---|---:|---|---|---|
| `veh_scooter` | 1.8977 × 1.4394 × 0.9071 | 0.55, 0.9091, 0.55 | 1.1245192 | 2.0445, 1.2369, 2.0445 | 2.1339 × 1.6185 × 1.0200 | 2.2 × 1.1 |
| `veh_van` | 1.8979 × 1.2643 × 0.9323 | 1.2, 1.2727, 1.25 | 2.4970503 | 1.9976, 1.9619, 2.0808 | 4.7391 × 3.1569 × 2.3279 | 5.0 × 2.4 |
| `veh_sports` | 1.8948 × 0.5636 × 0.8620 | 1.05, 0.9091, 1.0 | 2.0477095 | 2.0477, 2.2524, 1.9501 | 3.8800 × 1.1540 × 1.7650 | 4.0 × 2.1 |

For the van, **width binds** rather than length: the high-roof body is proportionally wider than
its class footprint's length:width ratio, so filling the length would have overhung the width.

The pre-Wave-1 constants were the compact car's, which after the shell factor made every class
render at roughly car proportions — a "scooter" 2.13 m long but as tall as a car, and a van no
bigger than a hatchback. The new fleet differentiates: the van is 2.2× the scooter's length and
2.7× the sports coupe's height; the coupe is the lowest thing in the garage at 1.15 m.

[`src/game/assets/wave1Contract.test.ts`](../src/game/assets/wave1Contract.test.ts) recomputes
every number above from `vehicleRegistry` + `shellMeshScale` + the committed bytes, so a swapped
local X/Z, a wrong yaw, a forgotten shell factor or a hand-edited constant fails the gate.

## Paint behaviour — source paint retained

Each body is **one baked mesh with one material** carrying a baked base-colour atlas: windows,
lights, tyres and trim live in the same texture as the panels. There is no clean recolorable body
slot to expose, and tinting the atlas recolors the entire vehicle.

Issue #40 is explicit about this case — *"retain source paint rather than falsely claiming
per-panel paint support"* — so:

- the intake names the single material **`baked_atlas`**, which is not a candidate in
  `DEFAULT_VEHICLE_SLOTS` (`paint`/`Paint`/`body`/`Body`/`carpaint`/`CarPaint`) nor in any
  manifest declaration, so it cannot be re-bound by accident;
- the three manifest entries declare **`materialSlots: {}`** — an *explicitly empty* map, which
  `VehicleAsset` now distinguishes from an absent one and reads as "expose no recolorable slots,
  retain the source paint". An absent map still means "use the default candidates", so no other
  asset changes behaviour.

**Customization and save state are untouched.** A chosen paint is still purchased, stored on the
owned asset, persisted, shown in the Garage, returned by `getActiveVehicleProjection()`, and still
tints the procedural fallback shell. What no longer happens is the body texture being recolored.

Wheel-style customization is likewise stored and applied to state and still visible on the
fallback, but a Wave 1 body's baked wheels do not recolor — they are part of the atlas.

`round2Contract.test.ts` no longer asserts that *every* class has a paint slot (the claim that
forced the dishonest declaration). It now asserts something **stricter**: a declared paint slot
must name a material the GLB actually contains, and a slot may only be declined by a genuine
single-material body whose material cannot rebind a default slot.

The Wave 0 `compact_sedan_01.glb` is the same kind of single-material baked body and still
declares `paint: ['paint']`. It is **deliberately unchanged** here — this wave is scoped to the
Wave 1 bodies — and is flagged for the owner as the identical pre-existing case.

## Fittings — no duplicate wheels or lights on a GLB body

Every approved body contains its own wheels and lights inside its single baked mesh, but
`VehicleVisual` used to render the full procedural `CarFittings` set as an unconditional sibling.
That drew four oversized car wheels on top of the two-wheeled scooter (a visible multi-wheel
hybrid) and headlight/taillight boxes over baked ones.

`CarFittings` now takes a **`profile`**:

- **`full`** — the complete historical set (four wheels, headlights, taillights, occupants). Used
  by `CarMesh` and therefore by every ambient/parked/stealable car **and by the CarMesh fallback**,
  so those renders are byte-identical to before.
- **`bodyIncluded`** — occupant indicators only. Wheels, headlights and taillights are all
  dropped; the rendered captures confirmed the taillight boxes read as a second pair of lamps
  floating off the tail rather than as part of the vehicle.

  The brake-light state machine in `Vehicle.tsx` is **unchanged** and still drives every
  `taillight` mesh it finds — which is every procedural body: the CarMesh fallback, and ambient,
  parked and stealable cars. A baked-atlas body has no separable lamp to animate: its lights live
  in the same single texture as its panels, so lighting them would recolor the whole vehicle —
  the same dishonest recolor issue #40 rules out. Recorded here rather than faked.

The profile follows the branch that actually renders: `VehicleAsset` gained a `glbSiblings` slot
rendered **inside** the Suspense/ErrorBoundary, so the bounded set appears exactly when the model
does, and a failed or missing model falls back to the complete set — a broken GLB never yields a
wheelless car. Physics, occupants, ownership and save are untouched.

Gated by four render-tree tests in `VehicleAsset.test.tsx`: the fallback has 4 wheels and 2
taillights; a mounted GLB has **0** procedural wheels and **0** procedural tail lamps but keeps
its occupants; a failed GLB restores the complete set; and a mounted baked-atlas body is not
tinted.

## Known limitation — parked vs active mesh scale (pre-existing)

Two different, long-standing multipliers exist:

- the **active** shell uses `shellMeshScale(collider)` — per-axis;
- **`OwnedParkedVehicles`** uses its own uniform `clamp(halfLength / 1.95, 0.6, 1.4)`.

They agree only for the Compact (both `1`). For the other classes a parked vehicle has always
rendered at a slightly different size and vertical proportion from the same vehicle driven. This
predates Wave 1 and is **renderer** behaviour, so this wave — which is forbidden from adding or
altering a projection path — does not change it. It is recorded here with numbers instead:

| Class | Active L × H × W | Parked L × H × W | Parked, pre-Wave-1 |
|---|---|---|---|
| `veh_scooter` | 2.1339 × 1.6185 × 1.0200 | 2.3279 × 1.0682 × 1.1127 | 2.3355 × 0.9602 × 1.1983 |
| `veh_van` | 4.7391 × 3.1569 × 2.3279 | 4.8606 × 3.1800 × 2.4871 | 4.9913 × 2.0469 × 2.5677 |
| `veh_sports` | 3.8800 × 1.1540 × 1.7650 | 3.9795 × 1.3020 × 1.7241 | 3.9908 × 1.3771 × 2.0489 |

Every parked dimension is **equal to or smaller than** its pre-Wave-1 value, so the pre-existing
divergence is reduced on all three classes, never worsened. Unifying the two multipliers is a
clean one-line follow-up for the owner to authorize separately.

## Visual evidence

[`tests/visual/wave1-asset-visuals.spec.ts`](../tests/visual/wave1-asset-visuals.spec.ts) — 16
baselines, each inspected by eye: per class an active side view, an active front view, a parked
dealership-bay view, an occupied (driver seated) view and a night view; plus one four-class
lineup showing compact, scooter, van and sports side by side.

Staging is the open central plaza `[0, 0]`, chosen by probing four candidate locations: it is the
only one that frames the whole vehicle on flat, uncluttered pavement with every wheel and its
ground contact readable. The first capture pass staged at `[0, -2]`, beside Maya's Snack Truck,
which obstructed the subject — and it was those captures that exposed both defects above.

The missing-file fallback contract is gated **per class** at the unit level in
`VehicleAsset.test.tsx` — there is no runtime hook to disable a vehicle GLB in a browser session,
and adding one just to photograph it would be exactly the kind of new path issue #40 forbids.
