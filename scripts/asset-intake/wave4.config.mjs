/**
 * Issue #47 — Integration Wave 4 asset intake manifest (declarative, deterministic).
 *
 * Names the EXACT pristine sprint sources for the nine approved Wave-4 bodies:
 *
 *   • FOUR named residents (Maya / Bruno / Officer Kim / Nisha), each assembled from its own
 *     three per-clip sprint GLBs onto ONE production rig, exactly as issue #38 Wave 0 assembled
 *     `blocklife_kabir_01` and `blocklife_ravi_01`. Strict 1:1 — a body is built for, and named
 *     by, the ONE NPC whose approved source it is. Ravi needs no new file: his approved source
 *     was already built into production as `blocklife_ravi_01` in Wave 0, so this wave RECONCILES
 *     that existing body into his runtime slot rather than rebuilding it.
 *   • FOUR parked-vehicle bodies (hatchback / pickup / delivery van / box truck) that project
 *     onto the EXISTING authored `parked_car` / `parked_truck` prop placements.
 *   • ONE building body (the second apartment style) projecting onto the EXISTING
 *     `building_gate_tower_02` placement.
 *
 * Sources live OUTSIDE the repository and are opened read-only; the pipeline never writes to
 * them, and every source's SHA-256 is asserted BEFORE the file is read.
 *
 * Source record:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/FINAL-SPRINT-SUMMARY.md
 * Worker ledgers: humans-roster/LEDGER-HUMANS.md · LEDGER-VEHICLES-PROPS.md · LEDGER-BUILDINGS.md
 *
 * No Meshy call, paid generation, enhancement, remesh, retexture, rig, animation or asset
 * purchase is involved: these are the already-approved 2026-08-31 sprint outputs, reduced and
 * normalized in-repo. Zero credits (the sprint account is reconciled to a balance of 0).
 */

/** Pristine sprint root (outside the repo). Overridable for CI/relocation. */
export const INTAKE_ROOT =
  process.env.BLOCKLIFE_INTAKE_ROOT ?? '/Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31'

/** Max texture edge enforced by scripts/assetReport.mjs. Same policy as Waves 0/1/3. */
export const MAX_TEXTURE = 1024

/**
 * Output textures are JPEG on purpose. assetReport.mjs measures embedded texture dimensions
 * from PNG (IHDR) and JPEG (SOF) headers only — a WebP texture would make that budget check
 * pass VACUOUSLY. JPEG keeps the gate genuinely enforcing. (Same rule as Waves 0, 1, 2 and 3.)
 */
export const TEXTURE_FORMAT = 'jpeg'
export const TEXTURE_QUALITY = 85

/**
 * Every approved vehicle and building body is ONE baked atlas: panels, glass, lights, tyres,
 * walls, windows and roof are painted into the same single texture as the body. There is no
 * clean recolorable slot to expose, and tinting the atlas would recolor everything. Waves 1–3
 * settled this: name the material something that is NOT a slot candidate in
 * DEFAULT_VEHICLE_SLOTS or any manifest declaration, so the approved source paint ships as
 * authored and re-authoring a body with real material segmentation has to opt in consciously.
 */
const BAKED_MATERIAL = 'baked_atlas'

const LICENSE = 'Meshy AI generated asset (meshy.ai terms)'
const ATTRIB_ASSEMBLED =
  'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), assembled + texture-optimized in-repo'
const ATTRIB_STATIC =
  'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo'

/**
 * The four Wave-4 NAMED-RESIDENT bodies.
 *
 * Assembly is byte-for-byte the Wave-0 character path: the three per-clip sprint GLBs for one
 * character share a byte-identical mesh, texture and 24-bone skeleton (the pipeline PROVES that
 * before merging), the Walk/Run clips are grafted onto the base document's own joints BY BONE
 * NAME, and the clips are renamed to the canonical semantic roles `Idle` / `Walk` / `Run` that
 * `CHARACTER_ASSETS` already aliases. Geometry, skin weights, bind matrices and the
 * `c432d433d51d` hierarchy are untouched — only animation and texture payload change. No second
 * character or animation system; the procedural `blocklife_person` stays the fallback.
 *
 * `npc` is the ONE runtime slot this body is allowed to fill. It is provenance, not behaviour
 * (the wiring lives in `src/data/npcs.ts`), and `wave4Contract.test.ts` cross-checks the two so
 * a body can never be re-pointed at a different character: issue #47 permits a strict 1:1
 * mapping and forbids identity swapping or cross-character reuse.
 *
 * `heightMeters` is the roster's rigged height, independently re-measured from the shipped bytes
 * by `scripts/human-proof/inspectRig.mjs` and asserted against `CHARACTER_ASSETS[...].bounds`.
 */
export const CHARACTERS = [
  {
    id: 'blocklife_maya_01',
    label: 'Maya Okafor — named resident body (issue #47 Wave 4)',
    npc: 'npc_maya_01',
    out: 'public/assets/models/characters/blocklife_maya_01.glb',
    heightMeters: 1.7,
    sources: {
      Idle: `${INTAKE_ROOT}/humans-roster/humans/maya-okafor-rigged.glb`,
      Walk: `${INTAKE_ROOT}/humans-roster/humans/maya-okafor-walking.glb`,
      Run: `${INTAKE_ROOT}/humans-roster/humans/maya-okafor-running.glb`,
    },
    expect: {
      Idle: { sha256: '664cc006c186a422e2767bef319a994d8fb5ed490514347e6ab05e810dd76c7a', bytes: 8657620 },
      Walk: { sha256: '00f2fef5a021cb047dddb11ff1a336af3c107394804975570d6cea6564c70eed', bytes: 8670392 },
      Run: { sha256: '9eba1366c778051f680fb92696e95cc04705625f9e35aaca1fc69abbf3edf450', bytes: 8665780 },
    },
    base: 'Idle',
    attribution: ATTRIB_ASSEMBLED,
    license: LICENSE,
  },
  {
    id: 'blocklife_bruno_01',
    label: 'Bruno Castillo — named resident body (issue #47 Wave 4)',
    npc: 'npc_bruno_01',
    out: 'public/assets/models/characters/blocklife_bruno_01.glb',
    heightMeters: 1.84,
    sources: {
      Idle: `${INTAKE_ROOT}/humans-roster/humans/bruno-castillo-rigged.glb`,
      Walk: `${INTAKE_ROOT}/humans-roster/humans/bruno-castillo-walking.glb`,
      Run: `${INTAKE_ROOT}/humans-roster/humans/bruno-castillo-running.glb`,
    },
    expect: {
      Idle: { sha256: '6d08b8963bc0f508d636199fb2d26c22bc1ad6ccb37be41f887abc6dd8421c30', bytes: 9006676 },
      Walk: { sha256: '055bd17963bfacb31c72eaf4fad339d1faa37b28deb8b2ef92d828915a0b4103', bytes: 9019456 },
      Run: { sha256: '2848148253b03053ca4708952fa731a15c3eb2b3f4781dcfed5350f72c134116', bytes: 9014836 },
    },
    base: 'Idle',
    attribution: ATTRIB_ASSEMBLED,
    license: LICENSE,
  },
  {
    id: 'blocklife_kim_01',
    label: 'Officer Kim — named resident body (issue #47 Wave 4)',
    npc: 'npc_kim_01',
    out: 'public/assets/models/characters/blocklife_kim_01.glb',
    heightMeters: 1.71,
    sources: {
      Idle: `${INTAKE_ROOT}/humans-roster/humans/officer-kim-rigged.glb`,
      Walk: `${INTAKE_ROOT}/humans-roster/humans/officer-kim-walking.glb`,
      Run: `${INTAKE_ROOT}/humans-roster/humans/officer-kim-running.glb`,
    },
    expect: {
      Idle: { sha256: 'c5140273f4cc0a78483c659788002f8038d92ccc8a61b9da45137cf0cca3980c', bytes: 7965624 },
      Walk: { sha256: 'bb1e36b6a2799e19d15d67e353317c5622681eff9ed200e36423d4fefc5e0987', bytes: 7978388 },
      Run: { sha256: '34b2731b6b090d3ade8d1dace286f8ef2c6680353ef3f3f0dea5520fb1503627', bytes: 7973780 },
    },
    base: 'Idle',
    attribution: ATTRIB_ASSEMBLED,
    license: LICENSE,
  },
  {
    id: 'blocklife_nisha_01',
    label: 'Nisha Rao — named resident body (issue #47 Wave 4)',
    npc: 'npc_nisha_01',
    out: 'public/assets/models/characters/blocklife_nisha_01.glb',
    heightMeters: 1.7,
    sources: {
      Idle: `${INTAKE_ROOT}/humans-roster/humans/nisha-rao-rigged.glb`,
      Walk: `${INTAKE_ROOT}/humans-roster/humans/nisha-rao-walking.glb`,
      Run: `${INTAKE_ROOT}/humans-roster/humans/nisha-rao-running.glb`,
    },
    expect: {
      Idle: { sha256: '20edd14e27472f2a3c991ec7ea0ef5643e88dab67f6cc80850018398d148bec0', bytes: 8780120 },
      Walk: { sha256: '1fc6fa37997d72cb1028af71954f78af320a7290b786717a947aa8f5c63e6c71', bytes: 8792896 },
      Run: { sha256: '0151c2610a5bdbb42cf2efb97095e63864fa22175e978e6470794be97754c8ed', bytes: 8788284 },
    },
    base: 'Idle',
    attribution: ATTRIB_ASSEMBLED,
    license: LICENSE,
  },
]

/**
 * The four Wave-4 PARKED-VEHICLE bodies.
 *
 * `propType` is the authored prop type whose placements this body projects onto. That type's
 * entry in `src/game/world/propPlacement.ts` is the AUTHORED VISUAL ENVELOPE — the silhouette
 * the procedural `CarMesh` / `TruckMesh` already occupies and the one the placement validators
 * measure against — so it is also the box each body is fitted INSIDE. Issue #47 is explicit:
 * reject a body that "exceeds its authored envelope". Nothing about the placements moves:
 * `PROP_SOLIDITY` (collision), positions, rotations, ids and streaming membership are untouched.
 *
 * `ground: true` on all four: every source is already bottom-origin, so the derived offset is 0
 * and no transform is applied — but the flag makes `buildStatic` ASSERT the shipped minimum
 * really is y = 0, which is what a ground-plane prop group requires.
 */
export const VEHICLES = [
  {
    id: 'vehicle_parked_hatchback_01',
    label: 'Parked hatchback body (projected onto authored parked_car placements)',
    propType: 'parked_car',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_hatchback.glb`,
    out: 'public/assets/models/vehicles/parked_hatchback_01.glb',
    expect: { sha256: '9154dad9e00ead70bf9e3afa4183cdb02b59048882fd241ddefde891792cc077', bytes: 5712788, triangles: 14776 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB_STATIC,
    license: LICENSE,
  },
  {
    id: 'vehicle_parked_pickup_01',
    label: 'Parked pickup body (projected onto authored parked_car placements)',
    propType: 'parked_car',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_pickup_truck.glb`,
    out: 'public/assets/models/vehicles/parked_pickup_01.glb',
    expect: { sha256: 'ffb35718a769463170ddecec1aaff2213b03264e84c87609a943b284007a0e0b', bytes: 5990856, triangles: 14107 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB_STATIC,
    license: LICENSE,
  },
  {
    id: 'vehicle_parked_delivery_van_01',
    label: 'Parked delivery-van body (projected onto authored parked_truck placements)',
    propType: 'parked_truck',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_delivery_van.glb`,
    out: 'public/assets/models/vehicles/parked_delivery_van_01.glb',
    expect: { sha256: 'a18001267a81e230aa8a6528fd6ddc0734f8eadaf08c22a1c5a49ee6032a2125', bytes: 6771484, triangles: 13831 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB_STATIC,
    license: LICENSE,
  },
  {
    id: 'vehicle_parked_box_truck_01',
    label: 'Parked box-truck body (projected onto authored parked_truck placements)',
    propType: 'parked_truck',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_box_truck.glb`,
    out: 'public/assets/models/vehicles/parked_box_truck_01.glb',
    expect: { sha256: 'd459e027d0d43621dd87f6e4173332a661df03c655de215de02be271db65879f', bytes: 6772600, triangles: 14653 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB_STATIC,
    license: LICENSE,
  },
]

/**
 * The one Wave-4 BUILDING body.
 *
 * `building_gate_tower_02` is an UNLABELLED, east-door residential-scale tower in the Downtown
 * Gateway, standing beside the labelled "Meridian Tower" and "Gateway Offices". The approved
 * second apartment style is a balconied residential slab whose entrance is measurably on its own
 * +z elevation (see `facades` in the provenance and the Wave-4 cardinal baselines), so no
 * authored role, label or interaction is contradicted and the authored east door is served by a
 * +π/2 yaw. Every other approved building was catalogued and REJECTED — see
 * `docs/ASSET_INTEGRATION_WAVE_4.md` §Rejected.
 */
export const BUILDINGS = [
  {
    id: 'arch_apartment_02',
    label: 'Second apartment style (projected onto the existing building_gate_tower_02 placement)',
    placements: ['building_gate_tower_02'],
    src: `${INTAKE_ROOT}/buildings-worker/glb/apartment_02.glb`,
    out: 'public/assets/models/city/arch_apartment_02.glb',
    expect: { sha256: '1fbf978b14c30d4ec41a3ffed6a3891091120cb56138340a76f1140a623cd7bf', bytes: 4859260, triangles: 19800 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB_STATIC,
    license: LICENSE,
  },
]

/**
 * Camera-engulf ceiling, re-exported from the camera module's own derivation.
 *
 * Issue #46 made this structural: `src/game/camera/cameraGeometry.ts` owns `CAMERA_OFFSET` and
 * DERIVES `MAX_WORLD_RENDER_HEIGHT = CAMERA_EYE_HEIGHT − CAMERA_CLEARANCE` (18 − 3 = 15) from
 * it. The value is repeated here only because this config is plain `.mjs` consumed by a Node
 * script that cannot import the TypeScript module; `wave4Contract.test.ts` asserts the two agree,
 * so a future change to the camera cannot leave this constant stale.
 */
export const MAX_RENDERED_HEIGHT = 15.0

export const BOUNDS_EPSILON = 5e-5
export const SCALE_DECIMALS = 4

/**
 * The authored VISUAL envelopes the parked bodies are fitted inside, transcribed from
 * `PROP_PLACEMENT` in `src/game/world/propPlacement.ts` (`visualHalf` → the lateral/longitudinal
 * half-extents, `vertical[1]` → the maximum rendered height). Repeated here for the same reason
 * as `MAX_RENDERED_HEIGHT`; `wave4Contract.test.ts` asserts they equal the real table.
 *
 * Prop-local axes are the ones `Props.tsx` places into: local X is LATERAL (a car's width) and
 * local Z is LONGITUDINAL (its length) — exactly how `CarMesh`'s 2 × 0.62 × 3.9 body box is
 * authored. Every approved vehicle source is modelled with its LENGTH on model-local X, so each
 * body carries a +π/2 yaw (the same convention `vehicle_compact_car_01` already ships) which
 * puts model X on world Z.
 */
export const PROP_ENVELOPES = {
  parked_car: { halfX: 1.0, halfZ: 2.0, maxY: 1.4 },
  parked_truck: { halfX: 1.15, halfZ: 2.3, maxY: 2.1 },
}

export const PROVENANCE_OUT = 'docs/asset-provenance/wave4-provenance.json'

/**
 * Character height fitting (issue #47 Wave 4).
 *
 * The approved sprint bodies are authored at real-world human height (1.70-1.84 m). The rig they
 * REPLACE is not: `blocklife_person` — which every one of these NPCs rendered as before this wave,
 * and which the PLAYER still renders as — stands 2.930 m from the shipped bytes. Mounting an
 * approved body at scale 1 therefore shrinks that NPC to ~60 % of the player's height. It was
 * caught by the "player beside each named resident" baseline this wave adds, and measured: a
 * 1.674x rendered silhouette ratio between the player and Ravi, against 1.665 predicted from the
 * bytes.
 *
 * So the body is fitted to the rig, never the reverse — the same rule Wave 4 already applies to
 * props, where the authored envelope sizes the body (CONVENTIONS #36). Each named body renders at
 * `RIG_HEIGHT_METERS / heightMeters`, which restores the EXACT rendered height its NPC had before
 * this wave.
 *
 * Every height below is measured from the committed bytes by `scripts/human-proof/inspectRig.mjs`
 * (`groundedBounds.size[1]`), and each is pinned to the sha256 of the file it was measured from, so
 * a re-authored body fails the gate instead of silently keeping a stale scale.
 */
export const RIG_HEIGHT_METERS = 2.93
/** Tolerance on `scale x heightMeters` vs RIG_HEIGHT_METERS — 4 decimal places of scale. */
export const RIG_FIT_TOLERANCE_METERS = 0.001
export const RIG_FIT = {
  blocklife_person: { heightMeters: 2.93, sha256: '7907894ffbac5b39f793cddc5c94ffc31f1b2c623932dd849ad23e9e320b8c1e' },
  blocklife_ravi_01: { heightMeters: 1.76, sha256: 'f9ac3d5b8606c34007de89bfed05a764cfd2a4b843bb000e44fd0713488d6fe4' },
  blocklife_maya_01: { heightMeters: 1.7, sha256: '2b2de77624956433a3f7c65782bf3a315bf5f1ef8169a2b202017c415f8cdd73' },
  blocklife_bruno_01: { heightMeters: 1.84, sha256: '7abc583cf88e3def698b378477aba5dbd89603533756af694e10929b38adcdad' },
  blocklife_kim_01: { heightMeters: 1.71, sha256: '8b2d162eec4c5518993f188a288122404ee7f953f52d3954200f9344e76a3aa8' },
  blocklife_nisha_01: { heightMeters: 1.7, sha256: 'da73025eadeea48016e51aee73bf661b2735151bacc7dc1ea270bd188581a8d3' },
}
