# Large City Foundation v1

How BlockLife grows from one neighborhood into a large streamed city.

## Architecture

**Grid**: fixed 144×144 world-unit cells anchored at (−72, −72)
([worldGrid.ts](../src/game/world/sectors/worldGrid.ts)). Chosen by
measurement: the whole original six-block city fits in cell `s0_0` with zero
content splits; one cell ≈ one authored neighborhood; the orthographic camera
footprint (~70×55) fits inside a cell so a one-ring warm zone always covers
the view; a fast car crosses half a cell in ~5 s (ample prewarm time). Cells
are half-open (`[min, max)`) — exact boundaries resolve deterministically to
the higher cell. Ids are `s{sx}_{sz}` (network-safe, stable). Floating origin
is unnecessary until authored coordinates approach ~30 000 units.

**Ownership boundaries**

| System | Owns | Streams? |
| --- | --- | --- |
| worldGrid | coordinate ↔ sector math | never |
| sectorRegistry | authored sector definitions (immutable) | never |
| sectorContent | derived, validated content ownership + segment↔sector index | never |
| sectorStreaming | lifecycle, policy, budgeted queue, generation tokens, metrics | is the streamer |
| SectorManager | visual/collider roots per mounted sector, readiness reports | per sector |
| road graph + routeRuntime | ONE global immutable graph, all route state | **never** |
| citizens/NPCs | identity, schedule, memory (global runtimes) | tier-gated per sector |
| save/load | gameplay state only; sector derived from position | n/a |

**Lifecycle**: `unloaded → loading → warm → active`, back through
`cooling → unloading`, plus recoverable `error`. React mounts a sector's
components while it is loading/warm/active/cooling; mounted components report
visual/collider readiness with a generation token (stale reports are ignored).
The current player sector can never unload; cooling delays prevent boundary
thrash; demand returning during cooling reactivates instantly without an
unload/reload cycle.

**The generation is part of React identity — do not "simplify" this.** Sector
roots are keyed `${id}:${generation}` and take `generation` as a *prop* (effect
deps `[id, generation]`), and `getMountedSectorEntries()` carries it into the
sampled key. A reloaded sector is a NEW incarnation that must remount and
re-report. Two bugs lived here until 2026-07-16, both able to wedge a sector in
`loading` **forever** — no colliders, a hole in the world, and teleports into it
silently never commit (the coordinator waits on destination-ready):

1. `key={id}` with deps `[id]` let React coalesce an unload+remount into "no
   change" — the readiness effect never re-ran, so nothing ever reported ready
   for the new generation. Signature: `lifecycle:"loading"`,
   `visualsReady:false`, `staleCompletions:0`, `queue:1`.
2. Readiness reports were generation-guarded only for `ready===true`. React's
   `useEffect` cleanups are passive and flush asynchronously, so generation N's
   cleanup could land *after* generation N+1's mount and clear a live flag.

Both are pinned by regression tests in `sectorStreaming.test.ts`. They surfaced
~1 run in 8, only once a test force-cycled a sector that ambient routed-vehicle
prewarm was concurrently demanding (missions E2E test 12).

**Streaming policy** (pure, deterministic): the player's sector and every
sector whose cell intersects the velocity-led camera box are ACTIVE; the
1-ring neighborhood is WARM; teleport destinations stream at top priority;
the apartment entrance sector and routed-traffic lookahead sectors are
pinned WARM; everything else unloads after its cooling delay.

**Traffic across sectors**: the road graph never fragments. Segments carry a
side index (primary + touched sectors, boundary-crossing flag). Routed cars
whose current segment's sector is unmounted go **dormant**: hidden, no
sensors, advancing analytically at 60 % of the segment limit while keeping
full logical route state (ids, cursor, trips). They **rematerialize** only
into collision-free space when the sector mounts again. Route lookahead
(next 3 segments) feeds sector prewarming. `graphVersion` is untouched by
any streaming lifecycle.

**Simulation tiers**: `full` (active sectors — exactly the pre-foundation
behavior), `reduced` (warm — same logic stepped at ~15 Hz with batched dt),
`dormant` (unmounted — entity hidden, logic paused; identity, position,
schedule phase and memory persist; **no analytic advancement for citizens in
v1 — the pause is the documented policy, not a simulation claim**),
`unloaded` (static definition only). Gates stay inert until the streaming
director's first tick, so standalone component tests see the old behavior.

**Teleports**: every path (test API, save/load placement, apartment exit,
debug) funnels through `registry.teleportPlayer` → the coordinator. Unready
destinations defer the move; SectorDirector commits it the moment visuals +
colliders report ready. The player never lands in a void.

**Save/load**: no schema change. Sector is derived from the saved world
position on load (teleport-coordinated); nothing about lifecycle, queues,
render instances or route runtimes is ever persisted. Old saves load
unchanged.

## Authoring contract — adding a sector

1. **Registry**: add a `SectorDefinition` in
   [sectorRegistry.ts](../src/game/world/sectors/sectorRegistry.ts)
   (grid coord, districts, kind, streaming/simulation policy, map label).
2. **Content**: author buildings/props into the existing data arrays
   (`BUILDINGS`, `PROPS`, citizens, NPCs) with positions inside the cell —
   ownership derives from position and is validated
   ([sectorContent.ts](../src/game/world/sectors/sectorContent.ts)).
3. **Components**: build a `Visuals` component (meshes only) and a
   `Colliders` component (cuboids in one fixed RigidBody, perimeter walls
   with declared corridor gaps), register the pair in
   [sectorComponents.tsx](../src/game/world/sectors/sectorComponents.tsx).
4. **Roads** (optional): append `SegmentSpec`s to
   [roadGraphData.ts](../src/game/traffic/routing/roadGraphData.ts) — new
   lanes join existing endpoints by exact node adjacency (never modify
   existing ids), add destinations, extend `getRoadRects()`. The 24
   validation rule classes + all-pairs district reachability gate the graph.
5. **Map**: the sector's labeled area appears automatically via
   `MAP_BOUNDS`; add its road strip + district label to PhoneMap.
6. **Verify**: unit suites (ownership/registry/graph), sector E2E spec,
   visual baseline for the new sector.

The Downtown Gateway (`s0_-1`) is the reference implementation of all six
steps.

## Growth roadmap

**12 sectors** — fill the ring around `s0_0`: downtown core north of the
gateway, waterfront east, larger residential west/south. Each is steps 1–6
above. Add: fast travel via the existing teleport coordinator (it already
handles readiness), phone-map zoom/pan (worldToMap already supports any
bounds), tune reduced-tier cadences per sector kind.

**25 sectors** — suburbs, university, industrial expansion, parks. Add:
destination `activeHours` demand weighting (typed already), parking
destinations (destination kind exists), streamed interiors reusing the
apartment's entrance-sector contract, district bundles (group sector
definitions per file). Watch: occluder counts (already scale with loaded
sectors only), congestion snapshot domain (already tier-aware).

**50+ sectors** — airport, transit, ring road. Add: asset-bundle splitting +
CDN delivery per sector (GLB sources are globally cached; bundle manifests
per sector), statistical dormant population (replace the documented pause
with analytic schedule advancement), simulation LOD budgets (cap active
mixers/sensors), discovery/fog-of-war on the map, floating origin **only if**
authored coordinates near ~30k units, map-editor output = `SectorDefinition
+ SegmentSpec[] + content arrays` (all plain JSON-shaped data). Multiplayer:
the server owns sectorStreaming per interest region and routeRuntime
globally; clients receive lifecycle + semantic route state; all ids
(sectors, segments, routes) are already stable strings; `graphVersion` +
registry version gate compatibility.

## Status after Crosswalk Surface Art v1 (2026-07-15)

The growth contract held through six more sprints: NINE sectors stream
(six with gameplay content — five kit-compiled), 153 road segments / 110
nodes / 196 edges, 28 traffic destinations, 90 citizens, one signalized
four-way (Harbor Cross: 12 movements, 46 s split-phase plan on the global
clock), 7 registered pedestrian crossings (4 signalized + 3 painted) with
generated zebra/curb/furniture art, a citywide pedestrian graph with
destination-driven citizen trips, and full crossing etiquette shared by
citizens, the player, and vehicles — all added through the District
Authoring Kit with zero engine rewrites. Foundation lessons that landed
as generic features: compiled sectors emit their own FLOOR colliders
(the global slab ends near the old city edge), prop scatter is
footprint-aware, the gateway owns ground under road corridors its cell
hosts (teleports gate only on the landing cell), and every speed clamp
outside the decision engine must propagate its blockage reason. Suites:
559 unit, 122 E2E, 63 visual baselines (stable ×3 per gate). See
docs/DISTRICT_AUTHORING_KIT.md for the sector #6→#12 recipe.

## v1 limitations / deferred debt

- Dormant citizens pause (no analytic schedule advancement).
- Backdrop-tower shelf sectors are visual-only conveniences.
- The streaming work queue schedules lifecycle steps (1/tick); asset
  preloading beyond GLB source caching is future work.
- Reduced-tier traffic uses the full decision engine (cost is already ~50 µs
  per fleet frame; per-sector cadence tuning is deferred until it matters).
- The distant-skyline shell (Part 25) was intentionally skipped — the
  backdrop towers already serve that role.
