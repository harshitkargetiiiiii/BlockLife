# Asset Credits — BlockLife

> ⚠️ **Only use CC0, properly licensed, purchased-with-rights, or original
> assets. Do not use ripped game assets, branded assets, copyrighted logos,
> or unlicensed music.** Never GTA/Rockstar material of any kind.

## Status

The first real asset pack is integrated: **Downtown City MegaKit [Standard]
by Quaternius (CC0-1.0)** now provides four building landmarks. Everything
else (food truck, kiosk, props, characters, vehicles, audio) remains
procedural, and every GLB keeps its procedural fallback — set an entry to
`enabled: false` in `src/game/assets/assetManifest.ts` to restore primitives.

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
| quaternius_building_large_2.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | building_office_01, building_tower_01 |
| quaternius_prop_acunit.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_ac_unit_01 |
| quaternius_prop_bollard.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_bollard_01 |
| quaternius_prop_plantersingle.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_street_planter_01 |
| quaternius_prop_manholecover.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_manhole_01 |
| quaternius_prop_drain.glb | Quaternius | Downtown City MegaKit [Standard], quaternius.com | CC0-1.0 | 2026-07-03 | yes (optimized) | prop_drain_01 |

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
  Low-poly rigid-skinned humanoid: 7 bones, ~1.4k triangles, 235 KB, clips
  `Idle` / `Walk` / `Run`, material slots `shirt` / `pants` / `hair` /
  `skin` / `shoes` / `eyes`. License: same as the project (original work,
  no third-party IP).
