/**
 * Issue #44 — Integration Wave 3 asset intake manifest (declarative, deterministic).
 *
 * Names the EXACT pristine sprint sources for the six approved Wave-3 BUILDING bodies, which
 * project onto NINE existing authored building placements through the existing `LandmarkAsset`
 * + `BuildingDef.visual` + procedural `BuildingMesh` fallback architecture. Sources live
 * OUTSIDE the repository and are opened read-only; the pipeline never writes to them.
 *
 * Source record:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/FINAL-SPRINT-SUMMARY.md
 * Worker ledger:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/LEDGER-BUILDINGS.md
 *
 * No Meshy call, paid generation, enhancement, remesh, retexture, rig, animation or asset
 * purchase is involved: these are the already-approved 2026-08-31 sprint outputs, reduced and
 * normalized in-repo. Zero credits.
 */

/** Pristine sprint root (outside the repo). Overridable for CI/relocation. */
export const INTAKE_ROOT =
  process.env.BLOCKLIFE_INTAKE_ROOT ?? '/Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31'

/**
 * Issue #44 keeps the 1024 policy ceiling for buildings — the opposite call from Wave 2's
 * street props. A building fills a large part of the frame from the shipped isometric camera
 * (a 25 m apartment is hundreds of pixels tall), and unlike a lamp post each of these bodies
 * is instanced ONCE or, for the house archetype, four times. Detail is what is visible here,
 * so these sit at the policy maximum `scripts/assetReport.mjs` enforces, not below it.
 */
export const MAX_TEXTURE = 1024

/**
 * Output textures are JPEG on purpose. assetReport.mjs measures embedded texture dimensions
 * from PNG (IHDR) and JPEG (SOF) headers only — a WebP texture would make that budget check
 * pass VACUOUSLY. JPEG keeps the gate genuinely enforcing. (Same rule as Waves 0, 1 and 2.)
 */
export const TEXTURE_FORMAT = 'jpeg'
export const TEXTURE_QUALITY = 85

/**
 * Each approved building is ONE baked atlas: walls, windows, doors, roof and trim are painted
 * into the same single texture as the body. There is no clean recolorable slot to expose, and
 * tinting the atlas would recolor the whole building. Issue #44 is explicit: "Preserve baked
 * source colours. These are single-material assets: do not invent recolour slots." So the
 * material is deliberately named something that is NOT a slot candidate in any manifest
 * declaration — the same honest guard Waves 1 and 2 put on the baked vehicle and prop bodies.
 */
const BAKED_MATERIAL = 'baked_atlas'

const LICENSE = 'Meshy AI generated asset (meshy.ai terms)'
const ATTRIB = 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo'

/**
 * The six Wave-3 building bodies.
 *
 * `expect` pins the owner-approved source identity. SHA-256 is authoritative and is asserted
 * BEFORE the file is read; `bytes` and `triangles` are secondary checks against the issue #44
 * table (all six match exactly).
 *
 * `ground: true` is set on every one of them. All six sources are already bottom-origin, so the
 * derived offset is 0 and no transform is applied — but the flag makes `buildStatic` ASSERT
 * that the shipped minimum really is y = 0 rather than assuming it, which is exactly what
 * issue #44's "Ground every visual at y = 0" requires of a body that will be placed by a
 * ground-plane group.
 *
 * `placements` records which authored building ids this body projects onto. It is provenance,
 * not behaviour: the runtime wiring lives in `assetManifest.ts` / `cityLayout.ts`, and
 * `wave3Contract.test.ts` cross-checks the two against each other.
 */
export const BUILDINGS = [
  {
    id: 'arch_apartment_01',
    label: 'Sunrise Apartments body (projected onto the existing building_apartment_01 placement)',
    placements: ['building_apartment_01'],
    src: `${INTAKE_ROOT}/buildings-worker/glb/apartment_01.glb`,
    out: 'public/assets/models/city/arch_apartment_01.glb',
    expect: { sha256: '772035e2a20306b4427617d62295b3d4bf2f003023314ee9f33e865cb9df23fe', bytes: 9638264, triangles: 20817 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'arch_shop_01',
    label: 'Mini Mart body (projected onto the existing building_shop_01 placement)',
    placements: ['building_shop_01'],
    src: `${INTAKE_ROOT}/buildings-worker/glb/shop_01.glb`,
    out: 'public/assets/models/city/arch_shop_01.glb',
    expect: { sha256: '46fb0e5e133ae852a40c831583bfde663c942448b653760edfa19d32163ca5f8', bytes: 7902184, triangles: 16089 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'arch_house_01',
    label: 'Reusable detached-house archetype (four authored house placements, one per district)',
    placements: ['building_house_01', 'building_house_r2', 'building_house_w2', 'building_house_s2'],
    src: `${INTAKE_ROOT}/buildings-worker/glb/house_01.glb`,
    out: 'public/assets/models/city/arch_house_01.glb',
    expect: { sha256: '8f05a4d8c06c98c27dd4cdaf472f34ceffcf3161f4a5b019074f97371afb43c7', bytes: 9291256, triangles: 17208 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'arch_row_house_01',
    label: 'Townhomes body (projected onto the existing building_townhomes_01 placement)',
    placements: ['building_townhomes_01'],
    src: `${INTAKE_ROOT}/buildings-worker/glb/row_house_01.glb`,
    out: 'public/assets/models/city/arch_row_house_01.glb',
    expect: { sha256: 'a7d1fd629f4e985e0f0b166219607d0a53313cbb344cff5b7d4b824726040a4f', bytes: 5610216, triangles: 18374 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'arch_repair_garage_01',
    label: 'Repair garage body (projected onto the existing building_garage_01 placement)',
    placements: ['building_garage_01'],
    src: `${INTAKE_ROOT}/buildings-worker/glb/repair_garage_01.glb`,
    out: 'public/assets/models/city/arch_repair_garage_01.glb',
    expect: { sha256: 'c67736036e12025dc7b8275e67de743552c4d05b812805f1543f93698a343d19', bytes: 4034328, triangles: 11214 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'arch_hotel_01',
    label: 'Gateway hotel body (projected onto the existing building_gate_hotel_01 placement)',
    placements: ['building_gate_hotel_01'],
    src: `${INTAKE_ROOT}/buildings-worker/glb/hotel_01.glb`,
    out: 'public/assets/models/city/arch_hotel_01.glb',
    expect: { sha256: 'ddc81fd303ad8dcfb349b5a044d748404d56c36cab0e9de1628b44168e97a7f9', bytes: 5430120, triangles: 20520 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
]

/**
 * The Wave-3 projection rule, shared verbatim by the manifest derivation and by
 * `wave3Contract.test.ts`, which recomputes every shipped scale from `BUILDINGS` in
 * `src/game/world/cityLayout.ts` and the measured bounds rather than trusting the manifest's
 * literals.
 *
 * Issue #44 forbids moving a single authored footprint, collider, anchor or coordinate, so the
 * body must be fitted to the LOT rather than the lot to the body — and, since the shipped camera
 * lives 18 m above its target, it must also stay short enough never to contain it. THREE bounds:
 *
 *   s = floor( min( (w/2) / hx , (d/2) / hz , MAX_RENDERED_HEIGHT / sizeY ) * 10^4 ) / 10^4
 *
 * where (w, d) is the placement's authored `def.size` footprint, (hx, hz) are the model's
 * measured X/Z HALF-extents AFTER the canonical-facing yaw that points its front at the authored
 * door (a 90° yaw swaps them — getting that backwards is how a body ends up overhanging its
 * lot on one axis while under-filling the other), and MAX_RENDERED_HEIGHT is the camera-engulf
 * ceiling documented below. Every measured dimension is inflated by BOUNDS_EPSILON first: that
 * epsilon is half of `measureBounds`' 4-dp rounding step, without which a value that rounded
 * DOWN could let the derived scale overhang the lot by up to 5e-5.
 *
 * The scale is UNIFORM, so each approved body ships with its own proportions undistorted. The
 * height bound binds on the apartment and the hotel; the footprint binds on the other four —
 * see the per-entry notes in `assetManifest.ts`. `def.size` remains the authority for colliders,
 * occluder bounds, routing and every other gameplay read; nothing in this wave changes it.
 */
/**
 * Hard ceiling on a projected body's RENDERED height, in world units.
 *
 * `FollowCamera` is not a free camera: it sits at `player + (12, 18, 12)`, i.e. 18 m above its
 * target with a 16.97 m horizontal reach, and `near` is −200 so geometry behind the camera plane
 * is deliberately drawn. Every one of the 47 authored buildings in `cityLayout.ts` is shorter
 * than that — the tallest is `building_tower_04` at 17 m, a backdrop outside the play area — so
 * the shipped city has an UNWRITTEN invariant: no building near a walkable position is tall
 * enough to contain the camera.
 *
 * A pure footprint fit breaks it. The approved apartment is 25 m tall and would render at
 * 24.31 m in its 9 × 9 lot, putting its roof 6.31 m ABOVE the camera. Standing in the central
 * plaza with the DEV orbit at π puts the camera at (−12, 18, −12) — inside that footprint and
 * under that roof — and the frame fills with the inside of the roof. That is not a test
 * artifact: any player walking within ~17 m of the building on that bearing gets the same view.
 * `tests/visual/wave0-asset-visuals.spec.ts` caught it on seven candidate-character shots.
 *
 * 15 m restores the invariant with 3 m of clearance, and is not an arbitrary number: it is
 * EXACTLY the height the Quaternius body this placement is replacing already rendered at
 * (25 m × 0.60), so the apartment's presentation envelope is preserved rather than grown —
 * which is the "already-existing presentation overhang" issue #44 permits. It binds on the
 * apartment alone; the other five bodies are shorter than this before it applies.
 */
export const MAX_RENDERED_HEIGHT = 15.0

export const BOUNDS_EPSILON = 5e-5
export const SCALE_DECIMALS = 4

export const PROVENANCE_OUT = 'docs/asset-provenance/wave3-provenance.json'
