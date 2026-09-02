# Asset Credits — BlockLife

> ⚠️ **Only use CC0, properly licensed, purchased-with-rights, or original
> assets. Do not use ripped game assets, branded assets, copyrighted logos,
> or unlicensed music.** Never GTA/Rockstar material of any kind.

## Status

Real GLB assets are integrated across several sprints: **Downtown City MegaKit
[Standard] by Quaternius (CC0-1.0)** (four building landmarks + five street
props), and **Meshy AI generated original** assets (four ownable vehicle
shells — all four from the owner-approved 2026-08-31 sprint since issue #40 —
three character rigs, an apartment/townhome, — issue #25 — a
reusable residential-house archetype and the job-board kiosk, and — issue #42
Wave 2 — three street props: a vintage lantern streetlight, a fire hydrant and a
trash bin). Audio and the remaining props/buildings stay procedural. **Every GLB keeps its procedural
fallback** — set an entry to `enabled: false` in
`src/game/assets/assetManifest.ts` to restore the primitive. Colliders,
footprints and anchors are layout-driven, never mesh-driven, so a
missing/disabled/broken GLB changes pixels only.

## Asset intake checklist

Complete **every** line below for **each** imported asset *before* flipping
its manifest entry to `enabled: true`:

- [ ] **Source URL**:
- [ ] **Creator**:
- [ ] **License** (exact identifier, e.g. CC0-1.0):
- [ ] **Attribution required?** (yes/no — if yes, attribution text):
- [ ] **Original file name**:
- [ ] **Converted file name** (as placed under `public/assets/`):
- [ ] **Optimization notes** (decimation, texture resize, draco, etc.):
- [ ] **Date added**:
- [ ] **Used asset id** (manifest id, e.g. `building_gym_01`):
- [ ] **Modified or unmodified**:
- [ ] **Proof of license** (screenshot/receipt/archive link stored where):

## Asset registry

| Asset name | Creator | Source | License | Downloaded | Modified | Asset id / usage |
| ---------- | ------- | ------ | ------- | ---------- | -------- | ---------------- |
| All other visuals & audio | BlockLife (procedural, in code) | this repository | original work | — | — | Everything not listed below |
| quaternius_building_medium_2.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | building_apartment_01 |
| quaternius_building_small_1.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | building_gym_01 |
| quaternius_building_large_2.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | building_tower_01 (also backed building_office_01 until issue #38 Wave 0 replaced that model) |
| quaternius_prop_acunit.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_ac_unit_01 |
| quaternius_prop_bollard.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_bollard_01 |
| quaternius_prop_plantersingle.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_street_planter_01 |
| quaternius_prop_manholecover.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_manhole_01 |
| quaternius_prop_drain.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_drain_01 |
| compact_sedan_01.glb | Meshy AI (generated, original) | meshy.ai (owner-approved 2026-08-31 sprint) | Meshy AI generated asset | 2026-08-31 | yes (texture 2K→1K, normalized material) | vehicle_compact_car_01 (issue #38 Wave 0) |
| scooter_01.glb | Meshy AI (generated, original) | meshy.ai (owner-approved 2026-08-31 sprint) | Meshy AI generated asset | 2026-09-01 | yes (texture 2K→1K, normalized material) | vehicle_scooter_01 (issue #40 Wave 1) |
| utility_van_01.glb | Meshy AI (generated, original) | meshy.ai (owner-approved 2026-08-31 sprint) | Meshy AI generated asset | 2026-09-01 | yes (texture 2K→1K, normalized material) | vehicle_utility_van_01 (issue #40 Wave 1) |
| sports_car_01.glb | Meshy AI (generated, original) | meshy.ai (owner-approved 2026-08-31 sprint) | Meshy AI generated asset | 2026-09-01 | yes (texture 2K→1K, normalized material) | vehicle_sports_car_01 (issue #40 Wave 1) |
| prop_streetlight_01.glb | Meshy AI (generated, original) | meshy.ai (owner-approved 2026-08-31 sprint) | Meshy AI generated asset | 2026-09-01 | yes (texture 2K→512, normalized material) | prop_streetlight_01 (issue #42 Wave 2) |
| prop_fire_hydrant_01.glb | Meshy AI (generated, original) | meshy.ai (owner-approved 2026-08-31 sprint) | Meshy AI generated asset | 2026-09-01 | yes (texture 2K→512, normalized material, grounded by root-node translation) | prop_fire_hydrant_01 (issue #42 Wave 2) |
| prop_trash_bin_01.glb | Meshy AI (generated, original) | meshy.ai (owner-approved 2026-08-31 sprint) | Meshy AI generated asset | 2026-09-01 | yes (texture 2K→512, normalized material) | prop_trash_bin_01 (issue #42 Wave 2) |
| blocklife_apartment_hq_01.glb | Meshy AI (generated, original) | meshy.ai (text→image→3D) | Meshy AI generated asset | 2026-08-03 | yes (lowpoly, texture→1K) | building_townhomes_01 |
| arch_residential_house_01.glb | Meshy AI (generated, original) | meshy.ai (text→image→3D) | Meshy AI generated asset | 2026-08-20 | yes (lowpoly 7936 tris, texture→1K) | arch_residential_house_01 (issue #25) |
| prop_job_kiosk_01.glb | Meshy AI (generated, original) | meshy.ai (text→image→3D) | Meshy AI generated asset | 2026-08-20 | yes (lowpoly 4703 tris, texture→1K) | prop_job_kiosk_01 (issue #25) |
| blocklife_female_01.glb | Meshy AI (generated, original) | meshy.ai (text→image→3D→rig) | Meshy AI generated asset | 2026-08-03 | yes (remesh 15k, texture→1K) | blocklife_female_01 — legacy/candidate, **no named-NPC runtime mapping** |
| blocklife_male_01.glb | Meshy AI (generated, original) | meshy.ai (text→image→3D→rig) | Meshy AI generated asset | 2026-08-03 | yes (remesh 15k, texture→1K) | blocklife_male_01 — legacy/candidate, **no named-NPC runtime mapping** |

> **Named-character mapping note (current as of issue #38).** `blocklife_female_01` and
> `blocklife_male_01` were originally wired to Maya and Ravi. They no longer are: since issue #23,
> **all six named NPCs — Maya and Ravi included — ride the slot-rich `blocklife_person`**, because
> visual identity is derived from recolorable material slots that these baked-material rigs cannot
> expose. Both files remain valid, credited, loadable assets with **no named-NPC runtime mapping**,
> reachable through the non-persistent DEV character override (named only outside `public/`, since
> this credits file ships in the production bundle and must stay free of test-API identifiers).
> The issue #38 Wave 0 characters (`blocklife_kabir_01`, `blocklife_ravi_01`) ship on the same
> candidate footing —
> despite its name, `blocklife_ravi_01` is **not** mapped to `npc_ravi_01`. See
> [`docs/CHARACTER_IDENTITY_AND_POPULATION.md`](../../docs/CHARACTER_IDENTITY_AND_POPULATION.md).

### Intake record — Meshy AI generated assets (issue #21 vertical slice)

- **Source URL**: https://www.meshy.ai (generated via the Meshy MCP: `text_to_image`
  concept → `image_to_3d` → `rig` for characters)
- **Creator**: Meshy AI generative model, prompted in this repo. Original works —
  no third-party IP, no ripped/branded content (prompts describe generic low-poly
  civilians, a compact car, and a plain apartment).
- **License**: Meshy AI generated asset. Ownership/commercial use is governed by the
  Meshy account's plan terms (https://www.meshy.ai/legal). **Action for the
  maintainer**: confirm the generating account's plan grants commercial/redistribution
  rights and archive that confirmation as proof-of-license before shipping publicly.
- **Attribution required**: per Meshy terms; credited here regardless.
- **Original → converted file names**: Meshy `model.glb` / `Animation_Walking_withSkin.glb`
  → `compact_car_01.glb`, `blocklife_apartment_hq_01.glb`, `blocklife_female_01.glb`,
  `blocklife_male_01.glb`.
- **Optimization notes** (all deterministic, in-repo, geometry-preserving):
  car — `image_to_3d` lowpoly untextured (9.4k tris) then `scripts/normalizeMeshyGlb.mjs`
  assigns a named `paint` material for the §3 variant system; building — lowpoly textured
  (6.6k tris), `scripts/optimizeGlb.mjs` resized its texture 2K→1K (2.1MB→0.48MB);
  humanoids — `image_to_3d` textured t-pose → Meshy `remesh` to ~15k tris → Meshy `rig`
  (walk+run) → `scripts/optimizeGlb.mjs` texture 2K→1K (~5.8MB→~2MB each). The character
  base is the `Animation_Walking_withSkin.glb` (mesh + `Hips` skeleton + walk clip); a
  distinct run clip is a bounded follow-up.
- **Date added**: 2026-08-03
- **Modified or unmodified**: modified (decimation + texture optimization + material
  naming; the generated design is unchanged).
- **Total generation cost**: 171 Meshy credits (vertical slice).

**Round-2 addendum (2026-08-04, superseded).** The remaining three ownable vehicle classes were
originally generated the same way (`image_to_3d` → Meshy `remesh` to ~12k tris →
`scripts/normalizeMeshyGlb.mjs` names a single `paint` material for the §3 variant system):
`scooter_01.glb`, `utility_van_01.glb`, `sports_car_01.glb`. Round-2 generation cost: ~27 credits
(running total ~198 of the approved ~230 envelope). **Those bytes were replaced at the same paths
by issue #40 Wave 1** (see below); the round-2 record is retained for cost/provenance history only.
`compact_car_01.glb` — round 1's untextured compact body, already superseded at the manifest level
by `compact_sedan_01.glb` in issue #38 Wave 0 — was likewise deleted in Wave 1 as a dead duplicate
that was still shipping into `dist/`. Same Meshy license terms + maintainer action as above.
Buildings in round 2 reused the already-credited CC0 Quaternius kit (no new generation): the
backdrop tower reuses `quaternius_building_large_2.glb` with a per-instance palette recolor.

**Issue #25 Stage A addendum (2026-08-20)** — two Meshy AI generated original assets via the
Meshy MCP: `text_to_image` (nano-banana-pro) concept reference → `image_to_3d` (meshy-6/latest,
lowpoly, textured), then `scripts/optimizeGlb.mjs` texture 2K→1K (no Meshy remesh — lowpoly was
already in budget). `arch_residential_house_01.glb` (reusable residential-house archetype, 7936
tris) and `prop_job_kiosk_01.glb` (job-board kiosk, 4703 tris). Prompts describe generic,
IP-clean low-poly objects with blank signage; no third-party/branded content. Full provenance +
credit ledger: `docs/asset-harvest-log.md`. Stage A generation cost: 78 credits (2 references ×
9 + 2 image-to-3d × 30). Same Meshy license terms + maintainer action (confirm the plan grants
commercial/redistribution rights and archive that confirmation) as above.

### Intake record — Downtown City MegaKit [Standard]

- **Source URL**: https://quaternius.com (Downtown City MegaKit, Standard/free tier)
- **Creator**: Quaternius
- **License**: CC0 1.0 Universal (Public Domain Dedication)
- **Attribution required**: no (CC0) — credited anyway with thanks
- **Local source folder**: `~/Downloads/Downtown City MegaKit[Standard]`
- **Original file names**: buildings `Building_Medium_2_001.gltf`,
  `Building_Small_1.gltf`, `Building_Large_2.gltf`; props `Prop_ACUnit.gltf`,
  `Prop_Bollard.gltf`, `Prop_Planter_Single.gltf`, `Prop_ManholeCover.gltf`,
  `Prop_Drain.gltf` (+ `.bin` buffers and shared PNG textures) from
  `Exports/glTF (Godot)/`
- **Converted file names**: `quaternius_building_medium_2.glb`,
  `quaternius_building_small_1.glb`, `quaternius_building_large_2.glb`,
  `quaternius_prop_acunit.glb`, `quaternius_prop_bollard.glb`,
  `quaternius_prop_plantersingle.glb`, `quaternius_prop_manholecover.glb`,
  `quaternius_prop_drain.glb`
- **Optimization notes**: converted to self-contained GLB with
  `@gltf-transform/cli optimize` — textures resized (1024px buildings,
  512px props) and compressed to WebP, no draco/meshopt (so three.js needs
  no external decoders). Buildings: 35–44 MB each → 1.6–2.9 MB (6.4 MB
  total). Props: 8–21 MB each → 45–112 KB (~0.43 MB total).
- **Date added**: 2026-07-03
- **Modified or unmodified**: modified (format conversion + texture
  optimization only; geometry and design unchanged)
- **Used asset ids**: `building_apartment_01`, `building_gym_01`,
  `building_office_01`, `building_tower_01`, `prop_ac_unit_01`,
  `prop_bollard_01`, `prop_street_planter_01`, `prop_manhole_01`,
  `prop_drain_01`
- **Proof of license**: `License_Standard.txt` inside the downloaded pack
  states "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication" with a link
  to https://creativecommons.org/publicdomain/zero/1.0/ — 8 of the pack's
  153 models are imported.

## Folder map

- `models/city/` — buildings and city structures (GLB)
- `models/vehicles/` — cars (GLB)
- `models/characters/` — player + NPCs (GLB)
- `models/props/` — lamps, benches, trees, etc. (GLB)
- `textures/sky/`, `textures/ground/` — image textures
- `audio/ambience/`, `audio/sfx/` — sound files

Model files are wired up through `src/game/assets/assetManifest.ts` using the
stable semantic asset ids (e.g. `building_gym_01`, `food_truck_01`). The
manifest also stores per-asset attribution and license metadata.

## Characters

- `models/characters/blocklife_person.glb` — **original BlockLife asset**,
  procedurally authored by `scripts/buildCharacterGlb.mjs` (run
  `node scripts/buildCharacterGlb.mjs` to regenerate deterministically).
  Low-poly rigid-skinned humanoid: 7 bones, ~1.5k triangles, 243 KB, clips
  `Idle` / `Walk` / `Run`, material slots `shirt` / `pants` / `hair` /
  `skin` / `shoes` / `accessory` (a scarf, issue #23) / `eyes`. License: same
  as the project (original work, no third-party IP).

## Issue #38 — Integration Wave 0 (owner-approved 2026-08-31 Meshy sprint)

Five assets from the owner-approved sprint, rebuilt deterministically from pristine sources that
live **outside** this repository and were opened read-only. Reproduce with
`node scripts/asset-intake/buildWave0.mjs`; verify the committed bytes with
`node scripts/asset-intake/buildWave0.mjs --check`. Full per-asset provenance — source paths,
source SHA-256, output SHA-256, exact operations and structure — is in
[`docs/asset-provenance/wave0-provenance.json`](../../docs/asset-provenance/wave0-provenance.json).

- **Creator / attribution:** Meshy AI — generated original assets (owner-approved 2026-08-31 sprint),
  assembled and texture-optimized in-repo.
- **License:** Meshy AI generated asset (meshy.ai terms). Generation rights held by the repository owner.
- **Modified:** yes — per-clip GLBs merged into one production GLB per character; all textures reduced
  2048² → 1024² JPEG; material names normalized; unused payload pruned. Geometry, skin weights, bind
  matrices and the 24-bone `c432d433d51d` hierarchy are unchanged.

| Shipped file | Triangles | Texture | Size | Output SHA-256 | Pristine source(s) |
|---|---|---|---|---|---|
| `assets/models/characters/blocklife_kabir_01.glb` | 10109 | 1024×1024 jpeg | 1149 KB | `f90bc6065985c5d0…` | `kabir-sen-v3-rigged.glb` `34ab5f28df615ad9…`, `kabir-sen-v3-walking.glb` `c4d0bf8fa85b38f5…`, `kabir-sen-v3-running.glb` `42c79ad68861f694…` |
| `assets/models/characters/blocklife_ravi_01.glb` | 10447 | 1024×1024 jpeg | 1008 KB | `f9ac3d5b8606c340…` | `ravi-sharma-rigged.glb` `48306125e15fd16a…`, `ravi-sharma-walking.glb` `9b8eca6912fc1ebb…`, `ravi-sharma-running.glb` `7ac7521cb711296b…` |
| `assets/models/vehicles/compact_sedan_01.glb` | 14906 | 1024×1024 jpeg | 1133 KB | `75bc48b8c41473c2…` | `blocklife_vehicle_compact_sedan.glb` `8ea4d12d0d381b28…` |
| `assets/models/city/arch_office_01.glb` | 16590 | 1024×1024 jpeg | 1122 KB | `fb5b709ac0758d32…` | `office_01.glb` `3fb0acf05d61b712…` |
| `assets/models/props/prop_park_bench_01.glb` | 8473 | 1024×1024 jpeg | 620 KB | `5d663890b1388041…` | `blocklife_prop_park_bench.glb` `01de0881823bb289…` |

Characters carry all three semantic clips (`Idle` / `Walk` / `Run`) in ONE GLB — no duplicate-texture
per-clip files ship.

## Issue #40 — Integration Wave 1 (owner-approved 2026-08-31 Meshy sprint)

The three remaining owner-approved sprint vehicle bodies, completing the four-class owned-vehicle
garage Wave 0 started. **No new generation of any kind** — no Meshy call, paid generation,
enhancement, remesh, retexture, rig or purchase — these are the same 2026-08-31 sprint outputs,
rebuilt deterministically from pristine sources that live **outside** this repository and were
opened read-only. Reproduce with `node scripts/asset-intake/buildWave1.mjs`; verify the committed
bytes with `node scripts/asset-intake/buildWave1.mjs --check`. Full per-asset provenance — source
paths, source SHA-256, output SHA-256, exact operations, measured bounds and structure — is in
[`docs/asset-provenance/wave1-provenance.json`](../../docs/asset-provenance/wave1-provenance.json).

- **Creator / attribution:** Meshy AI — generated original assets (owner-approved 2026-08-31 sprint),
  texture-optimized in-repo.
- **License:** Meshy AI generated asset (meshy.ai terms). Generation rights held by the repository owner.
- **Modified:** textures reduced 2048² PNG → 1024² JPEG and the single material renamed to
  `baked_atlas` — deliberately NOT a paint-slot name (see the paint note below).
  **Geometry, indices, origin and wheel count are unchanged** — the intake
  asserts the mesh digest and bounding box are byte-for-byte identical across the transform and
  refuses to write if either moved.
- **Generation cost this wave: 0 credits.**

| Shipped file | Class | Triangles | Texture | Size | Output SHA-256 | Pristine source |
|---|---|---|---|---|---|---|
| `assets/models/vehicles/scooter_01.glb` | `veh_scooter` | 20401 | 1024×1024 jpeg | 1491 KB | `9f84a52d775b5e98…` | `blocklife_vehicle_scooter.glb` `a187ed98675008c1…` |
| `assets/models/vehicles/utility_van_01.glb` | `veh_van` | 14413 | 1024×1024 jpeg | 1115 KB | `7bc9ae9d54733c7b…` | `blocklife_vehicle_utility_van.glb` `8aa7ef191f958c6f…` |
| `assets/models/vehicles/sports_car_01.glb` | `veh_sports` | 14829 | 1024×1024 jpeg | 897 KB | `e01f1e8191b34df7…` | `blocklife_vehicle_sports_coupe.glb` `948d5878c788ff9b…` |

The scooter is 401 triangles over the sprint's nominal 20k guide — intentional, to preserve its
wheel/spoke geometry — and remains well under the enforced 40k vehicle gate.

**Source paint is retained — these bodies are not recolored.** Each is ONE baked mesh with ONE
material carrying a baked base-colour atlas: windows, lights, tyres and trim live in the same
texture as the panels. Tinting it recolors the whole vehicle, so per issue #40 these bodies
declare **no** recolorable slot and their material is named `baked_atlas`, which is not a
candidate in any default or declared paint slot. The approved source paint therefore ships as
authored. Customization and save state are untouched: a chosen paint is still stored, still shown
in the Garage, and still tints the procedural fallback shell. Re-authoring a body with real
material segmentation is what unlocks a genuine `paint` slot — exactly as with the Wave 0
characters' wardrobe axes.

**Fittings.** Each approved body already contains its own wheels and lamps, so the GLB path
renders only the occupant indicators — the one fitting these models genuinely lack — seated per
asset so the driver and any ride passenger are visible on each body. Procedural wheels,
headlights and brake-light taillights are NOT layered on top; the procedural fallback keeps the
complete historical set, and the brake-light swap still drives every body that has `taillight`
meshes: the fallback and the generic procedural ambient / static parked / stealable city cars.
An OWNED parked vehicle is not one of those — it renders through the same adapter as the active
shell, so its GLB uses the bounded occupants-only profile too. A baked-atlas body's own lamps cannot be lit separately, and its
wheels cannot be tinted, without recoloring the whole vehicle — recorded, not worked around.

**Projection.** Each body is scaled UNIFORMLY — the approved model is never distorted — from its own
measured bounding box against its class footprint in `vehicleRegistry`, filling 97% of whichever of
length or width binds first. `src/game/assets/wave1Contract.test.ts` recomputes every number from
the registry and the committed bytes, so a swapped local X/Z or a wrong yaw cannot pass silently.

### Intake record — issue #42 Integration Wave 2 (2026-09-01)

Three approved 2026-08-31 sprint **street props** now back the existing `street_lamp`,
`hydrant` and `trash_can` prop types. **No Meshy call, paid generation, enhancement, remesh,
retexture, rig, animation or purchase** — these are the same sprint outputs, rebuilt
deterministically from pristine sources that live **outside** this repository and were opened
read-only. Reproduce with `node scripts/asset-intake/buildWave2.mjs`; verify the committed bytes
with `node scripts/asset-intake/buildWave2.mjs --check`. Full per-asset provenance — source
paths, source SHA-256, output SHA-256, exact operations, measured bounds and structure — is in
[`docs/asset-provenance/wave2-provenance.json`](../../docs/asset-provenance/wave2-provenance.json).

- **Creator / attribution:** Meshy AI — generated original assets (owner-approved 2026-08-31
  sprint), texture-optimized in-repo.
- **License:** Meshy AI generated asset (meshy.ai terms). Generation rights held by the repository owner.
- **Modified:** textures reduced 2048² → **512²** JPEG (half the 1024 policy ceiling — these are
  instanced dozens of times across the city and are a few dozen pixels tall at play distance) and
  the single material renamed to `baked_atlas`, deliberately NOT a paint-slot name. The hydrant,
  whose approved source has a **centred** origin (minY −1, because it skipped the remesh stage
  that applies `origin_at: bottom`), was grounded by a **root-node translation of +1 on Y** —
  mesh accessor bytes untouched. **Geometry, indices, topology, triangle count and proportions
  are unchanged**: the intake asserts the mesh digest is identical across the transform and that
  the bounding box moved by exactly the declared grounding offset and by nothing else.
- **Generation cost this wave: 0 credits.**

| Shipped file | Prop type | Triangles | Texture | Size | Output SHA-256 | Pristine source |
|---|---|---|---|---|---|---|
| `assets/models/props/prop_streetlight_01.glb` | `street_lamp` | 6975 | 512×512 jpeg | 375 KB | `de41b5e887a352b2…` | `blocklife_prop_streetlight.glb` `b5cbb22e194d8191…` |
| `assets/models/props/prop_fire_hydrant_01.glb` | `hydrant` | 8133 | 512×512 jpeg | 312 KB | `07036f58f67a09a6…` | `blocklife_prop_fire_hydrant.glb` `1129433f98381b4f…` |
| `assets/models/props/prop_trash_bin_01.glb` | `trash_can` | 7703 | 512×512 jpeg | 426 KB | `aedb4d59f17c7cee…` | `blocklife_prop_trash_bin.glb` `829161b2b1c7898e…` |

**Source colours are retained — these props are not recolored.** Each is ONE baked mesh with ONE
material carrying a baked base-colour atlas. There is no clean recolorable slot to expose, so all
three declare an explicitly **empty** `materialSlots` map and their material is named
`baked_atlas`. A hydrant's authored `PropDef.color` still tints its *procedural* fallback.

**The streetlight GLB is geometry only.** It carries no light, no emissive material and no
`KHR_lights_punctual` — the intake refuses all three, which is what keeps a lamp from self-glowing
in daylight. The repo's own functional night illumination (the shared `lampBulbMaterial` bulb and
`lampGlowMaterial` ground pool that `updateGlowMaterials` drives once per frame for the whole
city) rides along as a bounded sibling of the mounted model, positioned on the model's **measured**
lantern rather than the procedural pole's bulb height. No duplicate pole or lantern geometry is
retained, and a missing or broken model restores the complete procedural lamp — pole and light.

**Projection.** Each body is scaled UNIFORMLY — the approved model is never distorted — as the
largest factor that keeps its measured bounding box entirely inside that prop type's authored
visual envelope in `src/game/world/propPlacement.ts`. That table, every authored placement id,
every `PROP_SOLIDITY` collider and all world-integrity behaviour are unchanged.
`src/game/assets/wave2Contract.test.ts` recomputes every number from the envelope and the
committed bytes, so a hand-edited constant cannot pass silently.
