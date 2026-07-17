# BlockLife 🏙

A tiny, living, browser-based open-world **life sandbox** — one dense,
colorful city block rendered as a low-poly 2.5D diorama. Walk around, drive a
little car, eat at the food truck, train at the gym, work a shift, sleep,
befriend the neighbors and finish your first quest, all while the block cycles
through warm mornings, golden evenings and cozy lamp-lit nights.

BlockLife is an **original game**. It contains no third-party IP: no ripped
assets, no branded vehicles, no copyrighted maps or characters. Everything on
screen is procedural, styled primitive geometry.

## Documentation

Developer/architecture docs live in [`docs/`](docs/) — start with the index:

- **[docs/README.md](docs/README.md)** — documentation index & reading order
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — master architecture (state model, frame loop, streaming, module map)
- **[docs/SYSTEMS.md](docs/SYSTEMS.md)** — deep dive per subsystem
- **[docs/CONVENTIONS.md](docs/CONVENTIONS.md)** — patterns & gotchas playbook
- Feature docs: [world foundation](docs/LARGE_CITY_FOUNDATION.md) · [authoring kit](docs/DISTRICT_AUTHORING_KIT.md) · [crime & law enforcement](docs/CRIME_LAW_ENFORCEMENT.md)
- **[CLAUDE.md](CLAUDE.md)** — condensed context primer for coding agents

## Tech stack

- [Vite](https://vitejs.dev) + [React](https://react.dev) + TypeScript
- [three.js](https://threejs.org) via [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber)
- [@react-three/drei](https://github.com/pmndrs/drei) (orthographic camera, HTML labels)
- [@react-three/rapier](https://github.com/pmndrs/react-three-rapier) (physics)
- [zustand](https://github.com/pmndrs/zustand) (game state)
- [idb-keyval](https://github.com/jakearchibald/idb-keyval) (IndexedDB save/load)
- Vitest + React Testing Library + @react-three/test-renderer + Playwright (tests)

## How to run

Requires **Node ≥ 22.12** (pinned in `.nvmrc` — run `nvm use` first; older
Node versions break Vite 7 and jsdom).

```bash
nvm use            # or any Node >= 22.12
npm install
npm run dev        # start the game at http://localhost:5173
npm run build      # type-check + production build
npm run preview    # serve the production build
```

## Controls

| Input | Action |
| ----- | ------ |
| **WASD / arrows** | Walk (screen-relative) |
| **Shift** | Run (drains energy) |
| **E** | Interact / enter & exit car |
| **W / S** (driving) | Accelerate / brake & reverse |
| **A / D** (driving) | Steer |
| **Tab / P** | Toggle the phone (📱 button in the HUD works too) |
| **Esc** | Close open panel |
| **`** (backquote) | Toggle debug panel |
| **Mouse wheel** | Zoom the diorama |

## Current features

- **A six-block city on one aligned street grid** (City Expansion v2): the
  commercial Central Block (apartment, gym, café, shops, offices, food truck,
  job kiosk, park, parking lot), three residential blocks (north street, west
  lane, south promenade), and two industrial zones (market strip + the North
  Freight arterial extension with warehouses and a factory). 40+ buildings,
  100+ props, connected by connector roads and real T-junctions.
- **50 ambient citizens** living data-driven daily lives across all six
  blocks — walkers with full pedestrian etiquette, idlers, sitters, queues,
  active-hours schedules and weather reactions — plus six named NPCs.
- **Solidity everywhere, by architecture**: one footprint table
  ([solidFootprints.ts](src/game/world/solidFootprints.ts)) drives BOTH the
  physics colliders and a universal occupancy validator — every building,
  prop, parked vehicle and street fixture holds exactly one solid footprint.
  Data tests check every pair for overlap, keep solids off asphalt, and
  sample every citizen's full walking route so nobody phases through
  anything, anywhere. The orthographic camera uses a negative near plane, so
  tall buildings between the camera and the player render as intact solids
  instead of hollow near-plane cutaways.
- **Building occlusion & player visibility**
  ([src/game/visibility/](src/game/visibility/)): when a tall building lies
  between the camera and the active subject (player on foot, or the car
  while driving), only that building fades to ~25% opacity — smoothly, with
  hysteresis against corner flicker — and restores when clear. Detection is
  pure analytic math (camera↔subject sight lines vs. layout-derived
  footprints with height validation; no raycasts), materials swap to
  per-building clones only while fading (shared/GLB source materials are
  never mutated; glow-driven windows keep animating mid-fade), colliders
  stay fully solid, shadows switch off below half opacity, and gameplay
  markers/labels stay readable. Indoors the system is dormant; teleports
  clear stale fades instantly. Fade policies are pluggable (`wholeObject`
  today; `roofOnly`/`facadeOnly` are reserved extension points).
- **2.5D orthographic diorama camera** that smoothly follows the player on
  foot or the car while driving. Fixed angle, optional wheel zoom.
- **Day/night cycle**: 1 real minute = 1 in-game hour. Continuous lighting
  interpolation across morning / afternoon / evening / night; street lamps,
  building windows and car headlights glow at night.
- **Life stats**: money, hunger, energy, reputation, strength, day, hour.
  Hunger grows over time, running drains energy, being starved or exhausted
  slows you down.
- **Interactables**: food truck (meal / coffee), gym (train), job board (work
  a shift), apartment (sleep to next morning), NPCs (dialogue), car (drive).
- **Six named NPCs** with data-driven routines, walking patrols, speech
  bubbles and simple persistent memory (greeted, trust, quests completed).
- **One complete quest** — *Coffee for Ravi*: accept → buy coffee from Maya →
  deliver → get paid (+$25, +5 reputation). Fully persisted.
- **Arcade driving** with real collisions against buildings and props.
- **Save / Load / Reset** through IndexedDB (stats, inventory, quest state,
  NPC memory, position, clock).
- **Procedural audio** (city hum, click, engine) behind a Start Audio button —
  no audio files, no autoplay violations.
- **Weather System v1**: clear / cloudy / rain / foggy with a deterministic
  daily schedule (Day 1 always clear). Weather multiplies the day/night mood —
  overcast dims the sun, rain darkens and glosses the roads, spawns gutter
  puddles and cheap camera-relative rain particles, boosts window/lamp glow
  for a cozy rainy-evening look, slows traffic 10–20% and sends some citizens
  indoors or under shelter; fog adds scene-level haze. Persisted in saves
  (older saves load clear) and synthesized rain patter through the audio
  manager.
- **Apartment / Home Base v1**: interact with the apartment entrance to step
  into a cozy studio interior (separate diorama in the same canvas — the city
  keeps simulating outside). Sleep in the bed to wake at 07:00 with full
  energy, customize outfit colors (shirt/pants/hair) at the wardrobe & mirror,
  peek in the storage chest (read-only bag view for now), and leave through
  the door to reappear at the street entrance. The window pane mirrors the
  live sky, so rainy nights look cozy from inside. Outfits persist in saves;
  saving while indoors stores the street entrance so loads always start in
  the city (v1 limitation).
- **Character Model + Animation Pipeline v1**
  ([src/game/characters/](src/game/characters/)): the player renders as an
  original rigged, skinned GLB character (authored programmatically by
  [scripts/buildCharacterGlb.mjs](scripts/buildCharacterGlb.mjs) — 7 bones,
  ~1.4k triangles, baked idle/walk/run clips, ~235 KB) with smooth
  crossfaded idle↔walk↔run driven by *actual* movement speed (position
  deltas + EMA smoothing — physics slides animate, teleports never
  burst-run), playback rates clamped to natural bands, and wardrobe colors
  applied to per-instance isolated materials (shirt/pants/hair). Officer Kim
  patrols on the same asset through the shared `AnimatedCharacter` component
  as the reuse proof; every other NPC stays primitive until opted in via
  `characterAssetId`. Gameplay references semantic clip roles only — clip
  names, scale, forward axis and slots live in the data-driven manifest
  ([characterManifest.ts](src/game/characters/characterManifest.ts)).
  Driving hides the model (the camera follows the car). The primitive
  capsule remains a first-class fallback: load failure, missing clips, or
  the global `characterRenderMode` switch all degrade gracefully.
- **Cross-District Traffic Routing v1**
  ([src/game/traffic/routing/](src/game/traffic/routing/)): the six blocks
  operate as one directed lane-level road graph (107 segments, 134 edges —
  derived from the same road constants that drive rendering, validated to
  coincide exactly with the legacy loop lanes wherever they share asphalt).
  Five of the eight ambient cars now plan deterministic A* routes to
  weighted, data-driven destinations across districts — through the four
  connectors, explicit junction-turn segments and the freight-arterial
  T-junction — while three keep their classic local loops. Routed cars feed
  the SAME decision engine as before (signals, stop signs, crosswalks,
  following, footprint avoidance all unchanged), add junction right-of-way
  (box mutual exclusion + crossing turns yield to approaching traffic), a
  capped congestion snapshot that only influences NEW plans, semantic
  blockage classification (red lights and pedestrians never trigger
  recovery), staged bounded recovery (refresh → replan → lane projection →
  validated respawn), and a through-traffic truck that exits at district
  edges and respawns off-camera. Deterministic under a routing seed; the
  whole layer is inspectable via the debug panel and the dev/test API.
- **Debug panel** with position, location mode, outfit, mode, speed, active
  interactable, quest state, clock, weather/wetness, FPS, a live character
  section and a routing section (graph counts, fleet mix, per-car
  destination/segment/blockage/recovery/trips).

## Testing

```bash
npm run test         # all Vitest tests (unit + UI + R3F component)
npm run test:watch   # Vitest watch mode
npm run test:unit    # Vitest tests under src/
npm run test:e2e     # Playwright end-to-end tests (needs: npx playwright install chromium)
npm run test:visual  # Playwright visual regression tests
npm run test:build   # build + unit + e2e, the full gate
```

Notes:

- Playwright downloads its browser once via `npx playwright install chromium`.
- The **first** `test:visual` run seeds baseline screenshots (Playwright
  writes them and fails once); subsequent runs compare against the baselines.
  Baselines are OS/GPU specific — regenerate with `--update-snapshots` when
  moving between machines.
- E2E tests drive the real game through `window.GAME_TEST_API`, a dev/test
  automation API that is **not** included in production builds.

## Folder structure

```
src/
  app/                 React shell: canvas root, HUD, panels
  data/                Data-driven definitions: NPCs, quests, interactables
  game/
    assets/            Model registry + machine-readable credits
    audio/             Procedural Web Audio manager
    camera/            Orthographic follow camera
    characters/        Rigged character pipeline: manifest, motion, animation
    controls/          Keyboard state
    interactables/     Proximity system, markers, action handlers
    interiors/         Apartment interior: layout data, scene, colliders
    npc/               NPC components, behavior, dialogue system
    player/            Player mesh + physics controller
    quests/            Quest state machine
    save/              IndexedDB save/load
    simulation/        Pure systems: time, needs, economy, world mood
    store/             zustand game store
    test/              window.GAME_TEST_API (dev only)
    traffic/           Signals, crossings, car rules; routing/ = road graph,
                       A* planner, route runtime, recovery, congestion
    vehicles/          Drivable car + arcade controller + shared car mesh
    visibility/        Occlusion: subject resolver, detection, material fades
    weather/           Weather director, rain/fog/puddle effects, wet surfaces
    world/             City layout data, visuals, colliders, lighting, director
  styles/              Game UI CSS
tests/
  e2e/                 Playwright gameplay tests
  visual/              Playwright screenshot regression tests
public/assets/         Future GLB/audio assets + ASSET_CREDITS.md
```

## Asset strategy

The first real asset pack is integrated: **[Quaternius](https://quaternius.com)
Downtown City MegaKit [Standard]** (CC0-1.0). Four landmarks now render real
GLB models — `building_apartment_01`, `building_gym_01`,
`building_office_01` and `building_tower_01` (the office and tower share one
file at different scales). The food truck, job kiosk and everything else
remain procedural, and **every GLB keeps its procedural fallback**: set an
entry's `enabled: false` in `src/game/assets/assetManifest.ts` and the
original primitive building returns.

Five small street props from the same pack (AC units, bollards, concrete
planters, manhole covers, drains) are placed as street props — data lives in
`PROPS` in `cityLayout.ts` and rendering goes through the same `LandmarkAsset`
pipeline with primitive fallbacks. Solidity follows the real world: bollards
and planters (and other standing furniture like crates, barrels, hydrants and
signboards) have colliders in `CityColliders.tsx`, while flat decals (manhole
covers, drains, pallets) and wall-mounted props stay walkable.

**Night window glow on GLB buildings** is procedural: the pack's fake-interior
shader doesn't ship in the exports, so
[WindowOverlays.tsx](src/game/world/WindowOverlays.tsx) adds a small
data-driven grid of instanced emissive planes per visible façade
([windowOverlayData.ts](src/game/world/windowOverlayData.ts) — rows, columns,
spacing, lit ratio, seed per building). One `InstancedMesh` per façade, one
shared unlit material whose opacity follows the lamp-glow curve: invisible by
day, fading in at dusk. Overlays are offset slightly from the façade (no
z-fighting), never touch colliders, and tune per building by editing the data.

To add another model from the pack: pick a `.gltf` from
`Exports/glTF (Godot)/`, convert + optimize it
(`npx @gltf-transform/cli optimize in.gltf out.glb --compress false
--texture-compress webp --texture-size 1024`), drop it under
`public/assets/models/`, record it in ASSET_CREDITS.md, and add/enable its
manifest entry with scale/rotation/offset tuned to the landmark footprint.
For a decorative prop: add a `PropType`, place entries in `PROPS`
(cityLayout), and render the type through `LandmarkAsset` with a primitive
fallback in `Props.tsx`.

The pipeline itself:

- Every major object has a **stable semantic asset id**
  (`building_gym_01`, `food_truck_01`, `prop_job_kiosk_01`, …).
- [assetManifest.ts](src/game/assets/assetManifest.ts) maps ids to optional
  GLB files plus per-asset scale/rotation/offset and license metadata.
- [LandmarkAsset.tsx](src/game/assets/LandmarkAsset.tsx) renders the GLB when
  its manifest entry is enabled, and the procedural fallback in every other
  case — missing file, disabled entry, load in flight, or load error (a
  dev-only console warning is logged; production stays silent).
- Physics uses **simple cuboid colliders** defined from layout data
  (`CityColliders` / `collisionQuery`), fully decoupled from whatever visual
  happens to render — colliders are layout-driven, never mesh-driven, so a
  swapped model can't change gameplay.
- License rules and the **asset intake checklist** live in
  [public/assets/ASSET_CREDITS.md](public/assets/ASSET_CREDITS.md).
- After changing assets, run `npm run test:e2e`, then
  `npm run test:visual -- --update-snapshots` to accept the intentional new
  look, and re-run `npm run test:visual` to confirm stability.

### Adding GLB assets

1. **Place the file** under the matching category folder, e.g.
   `public/assets/models/city/building_gym_01.glb` (vehicles, characters and
   props have their own folders; textures under `public/assets/textures/`,
   audio under `public/assets/audio/`).
2. **Record it** in `public/assets/ASSET_CREDITS.md` using the intake
   checklist — CC0, properly licensed, purchased-with-rights or original
   work only.
3. **Update the manifest** in `src/game/assets/assetManifest.ts`: point
   `glbPath` at the file (path relative to `public/`, must start with
   `assets/`), fill `attribution`/`license`, tune `scale`/`rotation`/
   `positionOffset` so the model fills the same footprint as the fallback,
   then set `enabled: true`. New landmarks: add an entry and wrap the visual
   in `<LandmarkAsset assetId="...">` with the procedural mesh as children.
4. **To fall back to primitives**, set `enabled: false` (or remove the file —
   the game logs a dev warning and renders the fallback; it never crashes).
5. **Verify colliders**: colliders come from `cityLayout.ts`, not the model —
   run `npm run test` (collider/footprint tests) and drive the car into the
   swapped building in `npm run dev`; it must still block you. Keep the model
   visually inside the same footprint so physics feels right.
6. **Re-check visuals**: run `npm run test:e2e`, then
   `npm run test:visual -- --update-snapshots` to accept the intentional new
   look, and re-run `npm run test:visual` to confirm the baselines are stable.

## Licensing note

All code, visuals and audio in this repository are original work. Future
imported assets must be CC0, properly licensed or original — never ripped
content, never GTA/Rockstar material, never branded designs without
permission. See `public/assets/ASSET_CREDITS.md`.

## Future roadmap

- GLB/glTF asset integration through the model registry
- More city blocks & districts
- More NPCs, deeper routines and relationships
- More jobs (deliveries with Leo, café shifts)
- Apartment upgrades
- Boxing / gym mini-game with Coach Bruno
- More vehicles (scooter, delivery van)
- Weather (rain, fog, puddle reflections)
- Better audio (music beds, positional SFX)
- Phone UI (map, messages, quest tracker)
- Relationship & reputation systems that alter dialogue
- Random city events (lost cat, street market, blackout night)
