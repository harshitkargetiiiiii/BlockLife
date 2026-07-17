# District Authoring Kit v1 (+ City Expansion Content Pack v1)

Adding a sector to BlockLife is content authoring, not engine work: write a
`SectorAuthoringSpec`, compile, validate, register — ship. The kit was
proven by Main Street East (`s1_-1`) and then scaled by the City Expansion
Content Pack, which authored FOUR more sectors in one sprint: Waterfront
Gateway (`s0_-2`), Main Street North (`s1_-2`), Residential East (`s2_-1`)
and Industrial Yard (`s-1_-2`).

## Philosophy

The kit **compiles into the exact data shapes runtime already consumes**
(`BuildingDef`, `PropDef`, `SegmentSpec`, `TrafficDestination`,
`AmbientCitizen`, road rects, walls, map shapes). Runtime systems never
depend on the kit; compilation runs once at module load; validation is the
primary product — an invalid sector fails the unit suite with a
source-referenced message, never a play session.

## Workflow — the "sector #6 to #12" recipe

Adding one sector is now FOUR files touched, all mechanical:

1. **Spec** — `src/game/world/authoring/sectors/<name>.ts`: a
   `SectorAuthoringSpec` (walled area + wall openings, roads by template,
   frontage lots with building templates, optional freeLots/water/
   greenbelts, seeded prop zones, citizen zones, traffic anchors, map
   label + labelAnchor) and its compiled export:
   `export const X = compileSectorAuthoringSpec(SPEC)`.
2. **Register the compile** — add `X` to `COMPILED_SECTORS` in
   `authoring/compiledSectors.ts`. Everything downstream (road graph,
   buildings/props/citizens arrays, road rects, phone map strips/labels/
   water, debug panel, test API) iterates that list — no other data wiring.
3. **Registry + components** — one `SectorDefinition` in `sectorRegistry`
   and the sector renders through the generic loop in `sectorComponents`
   (it registers every compiled sector automatically).
4. **World glue** — if the sector introduces a new district: add it to the
   `DistrictId` union + `getDistrict()` region in `cityLayout` and to the
   graph validator's `DISTRICTS` whitelist. Add a `TEST_LOCATIONS` entry.
   If a road exits an existing walled sector, split that wall (one-line
   collider change, see the gateway's north/east openings).
5. **Validate** — run the unit suite: kit validation, graph validation
   (24 rule classes + all-pairs reachability), `cityPlacement`,
   `worldOccupancy`, ownership. Update the intentional count assertions
   (destinations, citizens, locations, registry ids, map percentages) —
   growth is visible in the diff by design.
6. **Verify** — E2E (readiness, traffic trip, streaming cycle, save/load)
   and one visual baseline per sector.

## Road attachment geometry (hard-won rules)

- **Collinear continuation is free**: a road whose `from` is the previous
  road's forward terminus puts its return lane's end EXACTLY on the
  previous back-lane node — auto adjacency, zero arcs (North Boulevard →
  Waterfront Drive; Main Street East → Residential East).
- **East spur at a north terminus is clean**: the spur's back lane sits
  beyond the corridor's end; close the loop with `rejoinAt` (Main Street
  North). The compiler extends the spur's asphalt to cover its rejoin arc.
- **West spurs (and any spur whose back lane would land ON a through
  lane) need `forkGap`**: the lane pair starts N units clear of the
  corridor and a diverge junction arc bridges the node (Industrial Yard,
  `forkGap: 6`).
- Content must sit inside the sector's own grid cell — roads may cross
  cells freely (boundary segments get touchedSectorIds automatically),
  so plan the walled area near the far end of the connector road.

## Template catalog

- **Roads**: `avenue_two_way`, `local_lane_two_way`, `service_one_way` —
  emit lane pair + turnaround (+ merge arc when rejoining, + diverge arc
  with `forkGap`), asphalt/sidewalk surfaces, dashes, road rects, map
  strips. `speedLimit` override gives residential streets their pace
  without a new template.
- **Lots**: `storefront_lot`, `tower_lot`, `house_lot`, `industrial_lot` —
  placed by road local-id + side (left/right of TRAVEL direction) +
  normalized position along travel; door faces the road. `freeLots` place
  template buildings at explicit positions with explicit facing
  (promenades, plazas).
- **Buildings**: `small_shop`, `cafe_shopfront`, `office_tower`,
  `mixed_use_block`, `residential_house`, `townhouse`, `warehouse`,
  `depot`, `kiosk_pavilion` — wrap the existing procedural visuals/solidity.
- **Prop scatter**: `sidewalk_furniture`, `plaza_decor`,
  `industrial_clutter`, `waterfront_promenade`, `park_greenery`,
  `residential_greens`, `driveway_parking`, `truck_row` — seeded
  (`hashString(sector:zone:seed)` → mulberry32), density per 100 u², min
  spacing, avoidance of roads/water/buildings/citizen-route corridors
  measured by each prop's REAL solid footprint (a parked car clears far
  more than a lamp). `rotation` aligns parked rows.
- **Citizen zones**: `sidewalk_walkers`, `plaza_idlers`, `freight_workers`.
- **Water**: `water: WorldBounds[]` — stylized flat surface + solid
  collider + validation (no building/prop/citizen waypoint or ROUTE LEG in
  water) + phone-map water strips. Ferry/bridge hook: fork a road from a
  drive-end node across a gap in the band.
- **Greenbelts**: extra grass surfaces for road corridors that run beyond
  any walled area (the global ground plane ends near the old city edge —
  compiled sectors also emit floor COLLIDERS under area + greenbelts +
  full road corridors).

## Validation rules (validateCompiledSectorContent)

Unique sector-prefixed ids; every id has a source ref; buildings inside the
walled area AND their owning grid cell; building↔building and
building↔road overlap; props off roads/buildings; citizen waypoints off
buildings and road interiors; destination progress bounds and lane-kind
anchoring. Plus everything the global suites already enforce (occupancy
sampling, graph on-asphalt/anti-solid/reachability, ownership
completeness). Error style:
`building s1_-1_n1 (from n1, template office_tower) overlaps road …`.

## Tooling

- **Debug panel** — the `authoring kit` section lists every compiled sector
  with content counts and a live `valid ✓ / ⚠ N errors` verdict
  (validation runs once per sector and is cached; compiled data is
  immutable after load). The canonical sector list is
  `authoring/compiledSectors.ts` — new sectors appear automatically.
- **Test API** — `getAuthoringTemplates()`,
  `getCompiledSectorContent(sectorId)`, `validateSectorAuthoring(sectorId)`
  and `getAuthoringSourceRef(contentId)` drive the E2E proofs and are
  available in the console during development.

## Legacy sectors

Central city and Downtown Gateway remain hand-authored data — they flow
through the SAME validation pipeline (placement, occupancy, graph,
ownership suites), which is the compatibility wrapper: one acceptance gate
for both styles. Migrating their coordinates into specs is deliberate
non-work until a change is needed there.

## Determinism & performance

Same spec → byte-identical output (tested by double-compile deep-equal).
No `Math.random`; ids contain no time or file order. Compile runs once at
module load (sub-millisecond for the proof sector — measured in the unit
suite runtime); nothing authoring-related executes per frame.
`graphVersion` changes only when compiled segments change.

## Polish & density vocabulary (City Polish Pass v1)

- **`linePropZones`** — evenly spaced rows: waterfront bollard railings,
  lamp rhythms, street-tree hedges, work-light rows, and cone barricades
  at road-end turnarounds ("under construction" storytelling). Ends land
  exactly on `from`/`to`.
- **`placedProps`** — explicit validated singles: delivery vans by shops,
  a parks-department truck at the drive, dumpsters behind depots.
- **`details: true`** on any lot/freeLot — emits its building template's
  `FRONT_DETAIL_POLICY` at the door (signs, café tables, planters, crates
  by archetype). Policies keep the DOOR STRIP CLEAR — shop queues stand
  there. Every fixed prop carries a source ref (`line_props`,
  `placed_prop`, `front_detail:<template>`); seeded scatter avoids fixed
  props by real footprint.
- **Citizen variety templates** — `bench_sitters` (sit) and `shop_queue`
  (queue) join walkers/idlers/workers; queues point at a shop's door strip.
- **Ambient motion** — the generic renderer animates a pause-aware shimmer
  over every water band and a steam puff above every `kiosk_pavilion`.
  No React state in frame loops; visual tests freeze via `pauseWorld`.
- **Edges** — greenbelt skirts extend grass ~10 u past every wall; tree
  lines outside east/north/west walls soften the horizon (split them
  around any road corridor that crosses); keep all edge props inside the
  sector's own grid cell.
- **`ambienceKey`** — per-sector audio hook (metadata only; no audio
  system yet). `map.landmarks` render as phone-map markers, data-driven.

Lighting: street lamps and lit windows already glow at night — night
identity comes from lamp PLACEMENT (rows along promenades, work lights
behind warehouse docks), not new light sources.

## Surface & facade art layer (Art Polish v1)

Two generated, deterministic, collider-free layers finish the world's
surfaces — new sectors get both automatically:

- **Surface details** (`world/surfaces/surfaceDetails.ts`): manholes,
  drains and patches computed from road rects; expansion seams + curb
  strips from sidewalk rects; tonal grass/dirt patches inside grass areas
  (clear of buildings, water, prop zones); paving bands across plazas
  (they also lift night readability); dashed `zonePaint` strips for
  loading zones. Per-sector sets are cached at module load
  (`sectorSurfaceDetails.ts` — kit sectors derive from compiled content;
  central + gateway from the same cityLayout constants that drive their
  rendering). One shared plane + disc geometry and NINE palette materials
  render everything (`SurfaceDetailLayer`); each detail kind owns a
  distinct height tier so nothing z-fights.
- **Facade details** (`world/surfaces/facadeDetails.ts`): pure policy from
  BuildingDef metadata — style resolves as industrial (windows: false),
  tower (h ≥ 9), shop (labeled, h ≤ 6.5), house (h ≤ 4.5), else block.
  Cornices, door frames, fascia sign bands, display windows, floor bands,
  entrance canopies, porch steps, vents and loading doors — ≤ 6 boxes per
  building, base-y coordinates, clamped inside the envelope (+0.9 u
  overhang max). Rendered INSIDE BuildingMesh's Occludable group, so every
  detail fades with its parent and can never float; colliders are
  untouched.

Rules for future art: keep the palette small (shade() of the building's
own colors + the shared surface palette), never add per-frame logic, keep
decals on their height tier, and prefer policy/table entries over
hand-placed one-offs. Legacy sectors inherit facade polish automatically
(styles derive from data), so central-city baseline changes are expected
and intentional whenever policies change.

## Signalized cross-street intersections (v1)

Author a four-way by (1) ending the main road's two halves at the box
edges (`center ± halfSize` on the travel axis, lanes at `center ± 2`),
(2) authoring each cross arm as a road whose forward lane STARTS on the
box's exit node and whose return lane lands on the entry node (plain
collinear adjacency), and (3) adding one `crossStreets` entry — the kit
compiles 12 explicit movement segments (straight/left/right per
approach), a unioned junction box, per-approach stop lines, four crossing
zones, four phase-lit signal poles, and a deterministic SPLIT-PHASE plan
(one green per approach + one all-walk + all-red clearances, ~46 s cycle).

- Phases are a pure function of the GLOBAL traffic clock: pausing freezes
  them, streaming can never reset them, and the plan is valid even while
  the sector is unloaded (the registry, like the road graph, always loads).
- A red approach clamps routed cars to the stop line through the existing
  decision engine — classified exactly like the central signal, so red
  waits never trigger recovery or replanning; a car already ON a movement
  segment always clears the box.
- Conflict groups are GENERATED from path-crossing geometry and validation
  proves no phase permits two conflicting movements and no walk phase
  coexists with any vehicle group. The split plan makes this trivially
  true; paired NS/EW greens, protected left arrows, adaptive timing,
  emergency/bus priority, flashing night mode and server-authoritative
  signals are documented extension points, not v1 features.
- Proof intersection: **Harbor Cross** at (48,−160) on the North
  Boulevard, with east/west harbor arms and one destination per arm so
  routed traffic exercises real turns.

## Live pedestrian crossings (v1)

Intersection crossings are REAL crosswalks, not decoration: each compiled
crossing registers as a standard `CrosswalkZone` (with curb wait spots
generated clear of the roadway), so citizens run the ONE existing
etiquette — approach → wait at the curb → commit → clear — and cars yield
to any occupied zone through the same decision-engine rule as the painted
central crosswalks. No parallel pedestrian system exists.

- The walk indicator is per-crossing and time-aware: 'walk' only while the
  all-walk remainder plus the trailing all-red still covers that
  crossing's curb-to-curb traverse; 'clearance' after that (committed
  crossers always finish, nobody new enters); 'dont_walk' whenever any
  vehicle group could be served. Validation proves every crossing FITS
  walk + clearance and every wait anchor stands off the roadway.
- Stop lines sit BEHIND the crossing bands (a yielding car must never
  park on pedestrians) and every movement segment names its entry + exit
  crossings, so a green-approach car still holds for an occupied zone —
  including the on-foot PLAYER standing in it. The wait classifies as
  'crosswalk' (benign): no recovery, no replans.
- The jaywalk failsafe scales per crossing (cycle + 12 s): a 38 s
  split-phase red is a normal wait, not a stand-off.
- Proof crowd: six Harbor Cross walkers (two full-rectangle loops that
  thread all four crossings + four one-arm shuttles), so several curbs
  release together at every all-walk. Streaming dormancy freezes them in
  place and the pause-snap parks them deterministically on their curb
  corners for visual tests.

## Crossing-aware citizen destinations (v1)

Selected citizens live DESTINATION-DRIVEN lives instead of fixed loops:
a lightweight, always-loaded pedestrian graph (connector nodes on compiled
sidewalk bands + every crossing's curb anchors + destination anchors
derived from authored buildings/benches/water — nothing hand-duplicated)
carries deterministic Dijkstra trips. Roads are traversed ONLY through
crossing edges: Harbor Cross's signalized crossings or painted
walk-crossings authored per road (`crossings: [{ localId, at }]` on any
kit road — unsignalled: pedestrians use the safety etiquette, cars
courtesy-yield with bounded patience and always stop for occupied zones).

- Destinations carry kind, capacity (claimed O(1) at selection, released
  on departure/dormancy), active hours, weather policy (rain prefers
  indoor destinations and skips avoid_rain spots) and an authoring source
  ref; selection is seeded per citizen+trip and never repeats back-to-back.
- The trip state machine (selecting → walking → performing → leaving,
  with the SHARED crossing etiquette for waits) plans only on selection,
  invalidation, or bounded recovery: re-anchor+replan same destination →
  replan elsewhere → idle fallback; the ladder clears only on arrival, so
  it cannot spin. Legitimate crossing waits never count as no-progress.
- Dormant LOD freezes a trip in place (capacity released, never advancing
  analytically through an intersection) and resumes it intact when the
  claim still fits — otherwise replans from the nearest graph node.
- Proof crowd: 6 new + 1 migrated citizen commuting between the gateway
  plaza, Harbor Cross shops/benches, the waterfront promenade, Main Street
  North's mart, and the Industrial Yard docks.

## Crosswalk surface art & curb furniture (v1)

Every registered crossing compiles ONCE into a visual spec derived from
the crossing registries (never hand-placed): zebra stripes elongated
along vehicle travel and kept inside the band, curb ramps + tactile pads
at both curb anchors, and waiting furniture a side-step off the walking
line. Signalized crossings get the full high-contrast ladder (every 3rd
bar worn) plus pedestrian signal posts whose walk/dont-walk heads read
the SAME global clock as the poles; painted walk-crossings get a sparser
ladder with edge bars and a static crossing sign — no fake signal state.
Eight shared materials, two shared geometries, zero per-frame work except
head colors; art mounts with its owning sector and the registry-driven
spec means streaming can never duplicate it. Validation proves stripes
stay in bounds and run the right way, pads stay off the roadway on their
anchors, posts avoid the roadway/crossing/waiting anchors, signal heads
only attach to signalized crossings, and stop lines stay behind every
band.

## Content density guidance (measured, not guessed)

Per 144-unit sector that felt right in the expansion pack: 3–7 buildings,
15–40 scattered props (waterfront runs high on furniture, residential
low), 2–5 citizens, 1–3 traffic anchors (1 weighted destination + 1
districtExit at each network quiet end). Weight destinations 2 for
"arrivals" districts and 1 for pass-through flavor. Keep citizen zone
waypoints on sidewalks/plazas: sidewalk centerlines sit 1.5 u off the
road rect.

## Scaling the kit

- **Next sectors (→ 12)**: one spec file each (~100 lines), one
  COMPILED_SECTORS entry, one registry entry, one baseline. Complete the
  Main Street corridor (fill s1_-2's east half), chain the waterfront west
  (s-1_-2 already borders it), grow the template catalog only when a
  sector needs a shape twice. Candidates: map zoom/pan, fast-travel
  anchors on TEST_LOCATIONS, more destinations per sector.
- **12 → 25 sectors**: signalized cross-street intersection templates
  (compose from the junction-segment vocabulary — forkGap already proves
  arc emission), parking-lot templates, district style packs (palette per
  archetype), a full waterfront district + suburb ring + university/park
  district, time-of-day traffic demand weights.
- **25 → 50+**: specs are plain JSON-shaped data — a visual editor or
  JSON/YAML importer emits `SectorAuthoringSpec` directly; procedural lot
  filling picks lot/buildings by archetype-weighted seeded choice; asset
  bundles split along sector ids; highway/ring-road + airport + transit
  as dedicated archetypes; statistical dormant simulation for far
  sectors; multiplayer interest management maps directly onto sector ids
  (all ids stable strings).

## What should be automated next

The remaining hand-work per sector is choosing coordinates. The next kit
iteration should add: (1) a `chainFrom` road helper that resolves fork
nodes from a named road's terminus instead of literal coordinates, (2)
auto wall openings where authored roads cross the area perimeter, (3) a
lint that flags spur geometry needing `forkGap` before the graph
validator does, (4) auto TEST_LOCATIONS from a spec `spawn` field.
