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
`<VehicleAsset assetId={proj.assetId} paint …><CarMesh …/></VehicleAsset>`, where
`assetId` comes from the active class's `VehicleDef.assetId` via
`getActiveVehicleProjection()`. When that class's manifest entry is enabled, the GLB
projects onto the shell (paint recolours the `paint` slot per-instance); otherwise
CarMesh renders. **The collider half-extents + mass are still derived from the
projection, never the model** — so the one-shell arcade driving model is untouched
and the baseline is byte-identical until a GLB is enabled.

v1 slice scope: only `vehicle_compact_car_01` ships a GLB. Occupant spheres + the
brake-light material swap remain CarMesh-only (documented limitation).

**One-shell + stolen cars (pre-existing, by design).** Because there is ONE physical
shell, an unowned/stolen shell is painted the classic drivable teal
(`DRIVABLE_CAR_COLOR = #3aa6a0`, unchanged from master) and the baseline projection is
the Compact — so every *driven* stolen car looks like the same teal Compact. #21 only
changed the shell's *shape* (box → GLB); it did not introduce the teal repaint or the
one-shell identity. Giving stolen cars distinct visuals is a vehicle-identity feature
(would touch the one-shell architecture this sprint preserves), tracked as a follow-up —
NOT an asset-pipeline task.

## §4 Character integration — Meshy humanoids
Two production humanoids (`blocklife_female_01`, `blocklife_male_01`) are Meshy
`image_to_3d` → `remesh` (≤15.4k tris) → `rig` outputs, texture-optimized to 1K.
They render through the existing `AnimatedCharacter` pipeline, assigned to named
NPCs via `NPCDef.characterAssetId` (Maya → female, Ravi → male). Two rig realities
shape the integration, handled as data (plus one small controller flag):
- **One baked material** (`Material_1`) → `materialSlots: {}` (no per-slot wardrobe
  recolor; the model's own texture is its appearance — correct for NPCs). The
  player keeps the slot-based wardrobe on the primitive `blocklife_person` rig.
- **Walk-only clip** (`Armature|walking_man|baselayer`, `Hips` root) → all three
  locomotion roles alias it, and the def sets **`staticIdle: true`** so the
  `CharacterAnimationController` HOLDS the idle at a single frame instead of
  looping the walk in place while standing (a playtest caught the "marching in
  place" that plain walk-as-idle produced). Assets with a real idle clip (the
  player rig) are unaffected — their idle still loops. A distinct run clip + a
  purpose-made idle are bounded follow-ups.

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
