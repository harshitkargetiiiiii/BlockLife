/**
 * Issue #40 — Integration Wave 1 asset intake manifest (declarative, deterministic).
 *
 * Names the EXACT pristine sprint sources for the three approved Wave-1 vehicle bodies —
 * the scooter, utility van and sports coupe that complete the four-class owned-vehicle
 * garage Wave 0 started with the compact sedan. Sources live OUTSIDE the repository and are
 * opened read-only; the pipeline never writes to them.
 *
 * Source record:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/FINAL-SPRINT-SUMMARY.md
 * Worker ledger:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/LEDGER-VEHICLES-PROPS.md
 *
 * No Meshy call, paid generation, enhancement, remesh, retexture or purchase is involved:
 * these are the already-approved 2026-08-31 sprint outputs, reduced and normalized in-repo.
 */

/** Pristine sprint root (outside the repo). Overridable for CI/relocation. */
export const INTAKE_ROOT =
  process.env.BLOCKLIFE_INTAKE_ROOT ?? '/Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31'

/** Max texture edge enforced by scripts/assetReport.mjs. */
export const MAX_TEXTURE = 1024

/**
 * Output textures are JPEG on purpose. assetReport.mjs measures embedded texture dimensions
 * from PNG (IHDR) and JPEG (SOF) headers only — a WebP texture would make that budget check
 * pass VACUOUSLY. JPEG keeps the gate genuinely enforcing. (Same rule as Wave 0.)
 */
export const TEXTURE_FORMAT = 'jpeg'
export const TEXTURE_QUALITY = 85

/**
 * The single material every Wave 1 body carries is ONE BAKED ATLAS: windows, lights, tyres and
 * trim are painted into the same texture as the body panels. Naming it `paint` (as Wave 0 did)
 * makes the §3 variant system bind it as a recolorable body slot, and the selected paint then
 * tints the whole atlas — windows and all. Issue #40 is explicit: "If the baked material cannot
 * expose a clean recolorable body slot without recoloring windows/lights/tires, document that
 * and retain source paint rather than falsely claiming per-panel paint support."
 *
 * So the material is deliberately named something that is NOT a slot candidate in
 * DEFAULT_VEHICLE_SLOTS or any manifest entry. The approved source paint ships as authored, and
 * re-authoring a body with real material segmentation has to opt in consciously.
 */
const BAKED_MATERIAL = 'baked_atlas'

const LICENSE = 'Meshy AI generated asset (meshy.ai terms)'
const ATTRIB = 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo'

/**
 * The three Wave-1 vehicle bodies.
 *
 * `expect` pins the owner-approved source identity. SHA-256 is authoritative and is asserted
 * before the file is read; `bytes` is a secondary human-readable figure recorded from the real
 * file. NOTE: issue #40's table lists 6,576,564 bytes for the van, but the file whose SHA-256
 * matches the approved hash is 6,645,388 bytes. The hash matches exactly, so the source is the
 * approved one and the issue's byte column is a transcription slip — recorded here rather than
 * silently normalized away.
 *
 * Every source is already one mesh / one material / one 2048 texture, bottom-origin, with zero
 * cameras, lights, skins or animations. Intake therefore reduces textures and normalizes the
 * material name ONLY; `buildStatic` asserts the mesh digest and bounds are unchanged.
 */
export const VEHICLES = [
  {
    id: 'vehicle_scooter_01',
    label: 'City Scooter body (projected onto the one drivable shell)',
    vehicleDefId: 'veh_scooter',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_scooter.glb`,
    out: 'public/assets/models/vehicles/scooter_01.glb',
    expect: { sha256: 'a187ed98675008c1e5dc422a274a5bd5942f75b4d67a567bec4dc8fa8314f6bf', bytes: 7799608, triangles: 20401 },
    materialName: BAKED_MATERIAL,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'vehicle_utility_van_01',
    label: 'Utility Van body (projected onto the one drivable shell)',
    vehicleDefId: 'veh_van',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_utility_van.glb`,
    out: 'public/assets/models/vehicles/utility_van_01.glb',
    expect: { sha256: '8aa7ef191f958c6fe83bfecdcad9d7b5da8a84f81042cdb2b30981c9dabbd440', bytes: 6645388, triangles: 14413 },
    materialName: BAKED_MATERIAL,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'vehicle_sports_car_01',
    label: 'Premium Sports Coupe body (projected onto the one drivable shell)',
    vehicleDefId: 'veh_sports',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_sports_coupe.glb`,
    out: 'public/assets/models/vehicles/sports_car_01.glb',
    expect: { sha256: '948d5878c788ff9bd86d4a4ab24c5bd6230951864e35116fd43de606f522f189', bytes: 5592552, triangles: 14829 },
    materialName: BAKED_MATERIAL,
    attribution: ATTRIB,
    license: LICENSE,
  },
]

/**
 * Fraction of the class footprint (2 x halfLength, 2 x halfWidth from vehicleRegistry) the
 * projected body fills. The Wave-0 compact sedan lands at 3.81 of its 3.90 footprint —
 * 97.7% — so 0.97 keeps the whole garage on one convention and guarantees the visual never
 * overhangs the gameplay footprint it is projected onto.
 */
export const FOOTPRINT_FILL = 0.97

export const PROVENANCE_OUT = 'docs/asset-provenance/wave1-provenance.json'
