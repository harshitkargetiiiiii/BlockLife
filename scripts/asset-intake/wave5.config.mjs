/**
 * Integration Wave 5 asset intake manifest (declarative, deterministic) — the live police cruiser.
 *
 * Names the EXACT pristine sprint source for ONE approved body: `blocklife_vehicle_police_car`,
 * drawn on the EXISTING live police cruiser pool (`src/game/police/PoliceUnits.tsx`).
 *
 * Why this home and no other: Wave 4 measured this body inside the parked-car envelope and REJECTED
 * it as a PARKED prop on semantics — "a parked cruiser implies police presence that the live
 * police/pursuit system owns" (docs/ASSET_INTEGRATION_WAVE_4.md §Rejected). The live cruisers ARE
 * that system's presence, and they already draw the same procedural `CarMesh` the parked props do,
 * so the body replaces exactly the thing it depicts. Purely visual: police AI, routing, avoidance
 * boxes, dismount, dispatch caps, occupancy and the siren light bar are untouched, and `CarMesh`
 * stays the fallback.
 *
 * Source record:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/LEDGER-VEHICLES-PROPS.md (row 10)
 * No Meshy call, paid generation, remesh, retexture or purchase: an already-approved 2026-08-31 sprint
 * output, texture-reduced in-repo through the same shared `./lib.mjs` path as Waves 1–4. Zero credits.
 */
export const INTAKE_ROOT =
  process.env.BLOCKLIFE_INTAKE_ROOT ?? '/Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31'

/** Same texture policy as Waves 0–4 (JPEG keeps assetReport's texture gate genuinely enforcing). */
export const MAX_TEXTURE = 1024
export const TEXTURE_FORMAT = 'jpeg'
export const TEXTURE_QUALITY = 85

const BAKED_MATERIAL = 'baked_atlas'
const LICENSE = 'Meshy AI generated asset (meshy.ai terms)'
const ATTRIB_STATIC =
  'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo'

/**
 * The cruiser pool draws `CarMesh` at the unit's ground position, nose on local +Z — the same
 * procedural body, and so the same authored VISUAL envelope, as the `parked_car` prop
 * (`PROP_PLACEMENT.parked_car` in src/game/world/propPlacement.ts: half-width 1.0, half-length
 * 2.0, top 1.4). The body is fitted INSIDE that envelope, never the reverse.
 */
export const CRUISER_ENVELOPE = { halfX: 1.0, halfZ: 2.0, maxY: 1.4 }

export const VEHICLES = [
  {
    id: 'vehicle_police_cruiser_01',
    label: 'Police cruiser body (drawn on the live police cruiser pool)',
    envelope: 'cruiser',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_police_car.glb`,
    out: 'public/assets/models/vehicles/police_cruiser_01.glb',
    expect: { sha256: '9d8a26204a768c0969182325837d79142de433db193cc498cfc5a4b8ae221d34', bytes: 6299576, triangles: 14852 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB_STATIC,
    license: LICENSE,
  },
]

export const BOUNDS_EPSILON = 5e-5
export const SCALE_DECIMALS = 4
export const PROVENANCE_OUT = 'docs/asset-provenance/wave5-provenance.json'
