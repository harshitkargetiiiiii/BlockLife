# 3D Asset Pipeline & Visual Upgrade (issue #21)

How production GLB assets enter BlockLife and project onto the **real** world —
characters, the drivable vehicle shell, buildings and props — behind a strict
"never block the scene, never depend on the model for gameplay" contract.

This platform **extends** the GLB pipeline shipped by earlier sprints (the asset
manifest + `LandmarkAsset`, and the character model/animation pipeline); it does
not reinvent them. New in #21: a canonical registry superset, a category-agnostic
material-**variant** system, a **vehicle** GLB adapter that projects onto the ONE
driving shell, a deterministic asset-report/budget harness, and this policy doc.

## The one rule: gameplay never depends on the model
Colliders, footprints, physics, navigation, interaction and save/load read
**authored data** (`cityLayout.ts`, the one-shell `getActiveVehicleProjection()`,
the character controller), never a loaded GLB. Every GLB keeps a procedural
**fallback**, so a missing / disabled / still-loading / broken model changes only
pixels — never behaviour. A GLB is fetched only when its manifest entry is BOTH
`enabled` and has a `glbPath`; otherwise the fallback renders.

## Modules (`src/game/assets/`)
| File | Role |
|---|---|
| `assetManifest.ts` | §1 canonical registry: `AssetManifestEntry` (id, category, glbPath, scale/rotation/offset, fallbackKey, attribution/license, enabled, **materialSlots**, **variants**, **budget**, **bounds**) + `validateManifest`. |
| `modelRegistry.ts` | Runtime lookup: `getManifestEntry` / `shouldLoadGlb` / `resolveGlbUrl` (honours `BASE_URL`). Gameplay never imports this. |
| `assetVariants.ts` | §3 category-agnostic material-variant system (below). |
| `LandmarkAsset.tsx` | §6/§8 building + prop loader — Suspense + ErrorBoundary + settle counters, primitive fallback. |
| `VehicleAsset.tsx` | §5 vehicle loader — same contract, CarMesh fallback, projects onto the ONE shell. |
| `assetCredits.ts` | Machine-readable mirror of `public/assets/ASSET_CREDITS.md`. |

Characters extend the registry from `src/game/characters/` (`characterManifest.ts`
`CHARACTER_ASSETS` holds rig/clip/slot/bounds detail; `AnimatedCharacter.tsx` is the
loader). A unit test asserts every character def has a matching canonical manifest row.

## §3 Material-variant system (`assetVariants.ts`)
ONE mechanism for per-instance colour/material variants with **no geometry
duplication**: a "slot" is a semantic name (`paint`, `shirt`) mapped to the GLB
material names carrying it; only the isolated slots' materials are **cloned per
instance**, so the shared drei GLTF cache scene is never mutated and one file backs
many colours.
- `resolveMaterialSlots(scene, slotMap)` → slot → live materials.
- `createVariantInstances(scene, slotMap, isolate[])` → clone + swap the isolated
  slots, return them.
- `applyVariant(slots, { slot: { color } })` → recolour (writes `color` only).
- `disposeVariantMaterials(slots, isolate[])` → dispose on unmount.

Both consumers use it: the character wardrobe (`characterMaterials.ts` is now a thin
adapter over it — customizable slots shirt/pants/hair) and vehicle paint/wheel.

## §5 Vehicle adapter — one shell, optional GLB
`Vehicle.tsx` renders exactly ONE physical rigid body. Its visual child is
`<VehicleVisual assetId={proj.assetId} …/>`, which composes the GLB **body**
(`<VehicleAsset>`, from the active class's `VehicleDef.assetId` via
`getActiveVehicleProjection()`) with the always-present `CarFittings` (wheels,
headlights, named `taillight` meshes, driver/passenger spheres). When that class's
manifest entry is enabled the GLB body projects onto the shell (paint recolours the
`paint` slot per-instance); otherwise `CarShell` renders. **The collider half-extents +
mass are still derived from the projection, never the model** — so the one-shell arcade
driving model is untouched and the non-GLB path is byte-identical to the old `CarMesh`.

Round-2 scope: **all four ownable classes** ship a distinct GLB — `vehicle_compact_car_01`
(Compact, the migration target), `vehicle_scooter_01`, `vehicle_utility_van_01`,
`vehicle_sports_car_01` (each remeshed ≤ ~12k tris, single normalized `paint` material).
Because `CarFittings` composes over the GLB, brake-lights, occupant spheres and wheel
behaviour are preserved for every class — parked and active render through the SAME
`VehicleVisual`, so a parked owned car and the driven shell agree by construction. A
review fix also corrected `VehicleAsset`'s slot merge (`{...DEFAULT_VEHICLE_SLOTS,
...entry.materialSlots}`) so a class that declares only `paint` keeps the default wheel
slot.

**One-shell + stolen cars (pre-existing, by design).** Because there is ONE physical
shell, an unowned/stolen shell is painted the classic drivable teal
(`DRIVABLE_CAR_COLOR = #3aa6a0`, unchanged from master) and the baseline projection is
the Compact — so every *driven* stolen car looks like the same teal Compact. #21 only
changed the shell's *shape* (box → GLB); it did not introduce the teal repaint or the
one-shell identity. Giving stolen cars distinct visuals is a vehicle-identity feature
(would touch the one-shell architecture this sprint preserves), tracked as a follow-up —
NOT an asset-pipeline task.

## §4 Character integration — Meshy humanoids + the representative-player path
Two production humanoids (`blocklife_female_01`, `blocklife_male_01`) are Meshy
`image_to_3d` → `remesh` (≤15.4k tris) → `rig` outputs, texture-optimized to 1K.
They render through the existing `AnimatedCharacter` pipeline. Wiring (Hybrid model):
- **Named NPCs** — *superseded; see
  [`CHARACTER_IDENTITY_AND_POPULATION.md`](CHARACTER_IDENTITY_AND_POPULATION.md) for the current
  contract.* When this sprint shipped, Maya and Ravi rode the Meshy rigs via
  `NPCDef.characterAssetId`. **Today all six named NPCs — including Maya and Ravi — ride the
  slot-rich `blocklife_person`**, because issue #23 made visual identity a matter of recolorable
  material slots (skin/hair/shirt/pants/shoes/accessory) that the baked-material Meshy rigs cannot
  expose. `blocklife_female_01` / `blocklife_male_01` remain valid, loadable assets with **no
  named-NPC runtime mapping**; they are reachable through the DEV override below. Issue #38 Wave 0
  added `blocklife_kabir_01` / `blocklife_ravi_01` on the same candidate footing.
- **The representative-player avatar path**: the player draws through the SAME
  `AnimatedCharacter` path as any asset. A DEV override (`debugPlayerCharacterId` store
  field + `GAME_TEST_API.setPlayerCharacterAsset(id)`) makes `CharacterControllerView`
  pick any `CHARACTER_ASSETS` def — proving the path is not NPC-only (E2E asserts the
  player loads the Meshy model, never the fallback; a §14 baseline frames it).
- **Six in-game variants** ride `blocklife_person` (the player + Kim + Bruno/Leo/Nisha
  via `NPCDef.bodyColor` → `CharacterAppearance`): ONE shared geometry, per-instance
  shirt/pants/hair materials (unit-proven: 6 distinct people, geometry shared, materials
  instance-local).

Two Meshy-rig realities are handled as data (plus one controller flag):
- **One baked material** (`Material_1`) → `materialSlots: {}` (the model's own texture is
  its appearance — correct for named NPCs; the wardrobe-recolorable rig is `blocklife_person`).
- **Walk-only clip** (`Armature|walking_man|baselayer`, `Hips` root): the Meshy rigs ship a
  single walk clip, so all three locomotion roles alias it and the def sets **`staticIdle:
  true`** — the controller HOLDS a still idle instead of marching in place (a playtest caught
  the marching that plain walk-as-idle produced). This is an **asset** limitation of the two
  Meshy rigs, **not** a pipeline one: the character pipeline fully supports distinct idle/walk/
  run (proven for `blocklife_person`, which the player + Kim ride — `transitions idle→walk→run`
  + `resolveClips` + `playbackRateFor` unit tests). A distinct Meshy run clip + a purpose-made
  idle (a re-rig / `meshy_animate` pass) are a bounded follow-up. The shipped-asset motion
  contract is locked by `round2Contract.test.ts §13 #4`.

## §8 Shared loader/cache + settle contract
drei's `useGLTF` (three's `GLTFLoader` + a URL-keyed Suspense cache) is the loader
everywhere; `LandmarkAsset` clones per instance via `scene.clone(true)`,
`AnimatedCharacter` via skeleton-safe `SkeletonUtils.clone`. Every loader increments
`runtimeRegistry.glbLandmarks{Expected,Active,Failed}` on mount/commit/fail and
decrements on unmount, so `GAME_TEST_API.assetsSettled()` (`active+failed ≥ expected`)
stays honest and visual tests wait for the real scene. No DRACO/meshopt/KTX2 decoder
is wired; adopt one only with a decoder under `public/` + a `useGLTF` loader arg.

## §7 Lighting & material policy
- Scene lighting is one `ambientLight` + one `hemisphereLight` + one shadow-casting
  `directionalLight`, recoloured per frame from the game clock × weather
  (`Lighting.tsx`). The sun uses `shadow-normalBias 0.9` to cure acne on large flat
  GLB faces; the orthographic camera uses `near=-200` so tall GLBs between camera and
  player aren't sliced. Renderer defaults: ACESFilmic tone mapping + sRGB output.
- **New GLB materials must reuse the shared singletons in `materials.ts` or the
  declared variant slots** — never ad-hoc per-instance materials, except where
  per-instance isolation is required (wardrobe / vehicle paint), which goes through
  `assetVariants`. Emissive night windows on exported façades use the
  `glbWindowGlowMaterial` overlay (`WindowOverlays.tsx`), not baked emission.

## Budgets & the asset-report harness (`scripts/assetReport.mjs`) — §2/§12
Per-category triangle + texture budgets (browser targets):

| Category | Max triangles | Textures |
|---|---|---|
| character (hero) | 45,000 (NPC bar 25,000) | ≤ 1024 |
| vehicle | 40,000 | ≤ 1024 |
| building (city) | 60,000 | ≤ 1024 |
| prop | 10,000 | ≤ 1024 |

`node scripts/assetReport.mjs [modelsDir] [--json out.json]` walks the GLBs, parses
each container's JSON chunk directly (no three/DOM — a stable headless before/after
perf harness), prints tris / KB / textures / clips / material-slot names per asset,
and **exits 1 if any asset is over budget** so the gate can enforce §12.

## §6 Building palette variants
The 3 Quaternius archetypes (`medium_2` → apartment, `small_1` → gym, `large_2` → the west
backdrop tower) each back a placement. *(When this sprint shipped, `large_2` backed the office
**and** the tower; issue #38 Wave 0 moved Nook Offices onto its own sprint GLB, so `large_2` now
backs the backdrop tower alone. The palette-variant mechanism below is unchanged.)* Each building entry
declares `materialSlots` (`wall`/`trim`) naming the façade + trim materials; a
`BuildingDef.paletteVariant` recolors THIS instance's declared slots via `LandmarkAsset`'s
`variant`. The backdrop tower carries the `large_2` archetype with a warm-brick façade + brass
trim, so the archetype reads as a distinct building. These are **textured** kit materials, so a
variant TINTS (three.js `map × color`); glass/interior materials are not in a slot, so windows
never tint. Declaring slots only isolates materials per instance (identity clone) — verified
**zero** baseline churn (the apartment baseline + the whole city sweep pass byte-identical after
slots were added). Cosmetic only: colliders / occluders / entrances derive from `cityLayout`, so
a palette variant can never change gameplay (E2E: every sector stays at 0 placement defects).

## §12 measured render cost (before/after)
Captured deterministically via `GAME_TEST_API.getRenderStats()` (a DEV `PerfProbe` reading
`gl.info` + JS heap each frame on the real clamped delta) on the paused city + a driving scene:

| Scene | Draw calls | Triangles | Textures | Geometries | JS heap |
|---|---|---|---|---|---|
| City (plaza, paused) | ~1,050 | ~294k | 86 | 592 | ~133 MB |
| Driving | ~984 | ~314k | 86 | — | ~150 MB |

All well under the E2E perf ceilings (`drawCalls < 2500`, `triangles < 4M`, `textures < 400`),
so the GLB upgrade stays within a comfortable browser budget: the GLBs add texture memory over
the old all-primitive world but keep draw calls low (shared cached scenes; one fetch per file).

## Test coverage (§13 production paths / §14 visual matrix)
- **§13 unit** (`src/game/assets/round2Contract.test.ts`): every ownable class → an enabled
  paint-slot GLB; 6 character variants share one geometry; the player rig's three gaits are
  distinct while the Meshy rigs opt into `staticIdle`; building palette variants recolor walls
  (not glass), share geometry, stay instance-local. Atop the existing
  `CharacterAnimationController` / `characterManifest` / `assetVariants` suites.
- **§13 E2E** (`tests/e2e/asset-pipeline-round2.spec.ts`, 11): named NPCs + player load the
  primary model (never fallback); save→reset→load rehydrates; all 4 classes project onto the
  one shell + settle; the representative-player path drives a Meshy humanoid; a GLB is fetched
  once + shared; GLBs survive a streaming unload→reload with no error; the overlay is never
  stranded; GLB + palette visuals keep placement at 0 defects.
- **§14 visual** (`tests/visual/asset-upgrade-visuals.spec.ts`, 10 dedicated + the 149-baseline
  suite in context): apartment, female / both humanoids, player-as-Meshy, named-resident
  variety, backdrop tower palette variant, and the four driven vehicle classes.

## First-wave asset set (round 2)
- **Characters**: 2 Meshy humanoids (female / male) — today **candidate assets with no
  named-NPC mapping** — plus the `blocklife_person` rig, which since issue #23 carries the player
  and all six named cast members as per-instance identity variants.
- **Vehicles**: all 4 ownable classes (Compact / Scooter / Van / Sports) as distinct GLBs on
  the one shell.
- **Buildings**: 3 reusable Quaternius archetypes (apartment / gym / backdrop tower) — `large_2`
  carries the palette-varied backdrop tower (it also backed the office until issue #38 Wave 0
  replaced that model) — plus the `blocklife_apartment_hq` townhome.

## Known limitations (bounded follow-ups)
- **Ambient crowd stays primitive by design.** The 6+ variant system rides the named cast +
  player (7 distinct in-world characters; 5 `blocklife_person` colour variants patrol/roam) and
  is unit-proven to scale. The anonymous ~50-citizen `AmbientCitizens` crowd stays deliberately-
  cheap shared-primitive meshes (pre-existing): routing 50 skinned rigs would undermine the §12
  perf budget. Rigging the anonymous crowd is a bounded, opt-in follow-up, not a pipeline gap.
- The two Meshy humanoid rigs ship a **walk-only** clip (a distinct run/idle is a re-rig /
  `meshy_animate` follow-up); `blocklife_person` already has real idle/walk/run.
- Meshy rigs use one baked material (no per-slot wardrobe recolor) — by design for named NPCs.
- Every *driven* stolen car shows the teal Compact shell (pre-existing one-shell behaviour,
  identical on master; a vehicle-identity follow-up, not an asset-pipeline task).
- No DRACO / meshopt / KTX2 decoder wired (assets are small enough without one).

## Adding a GLB asset (workflow)
1. Generate/obtain a licensed GLB (CC0 / original / licensed — never ripped or
   branded; see `ASSET_CREDITS.md`). Characters: T-pose, feet at y≈0, facing +z.
2. `node scripts/assetReport.mjs` → confirm within budget and read the material-slot
   names it prints.
3. Place under `public/assets/models/<category>/`; record the intake in
   `public/assets/ASSET_CREDITS.md` + `assetCredits.ts`.
4. Add / update the manifest row (`glbPath`, `enabled:true`, scale/rotation/offset,
   `materialSlots`, `variants`, `budget`, attribution/license). Characters also add a
   `CHARACTER_ASSETS` def (clip aliases, `skeletonRootName`, `materialSlots`, bounds).
5. Vehicles: set `VehicleDef.assetId`. Buildings/props: they already route through
   `LandmarkAsset` by id.
6. `npm test` (registry/collider consistency) then re-baseline visuals with
   `--update-snapshots=all` and **view** the PNGs.
