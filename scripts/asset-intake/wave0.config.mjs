/**
 * Issue #38 — Integration Wave 0 asset intake manifest (declarative, deterministic).
 *
 * Names the EXACT pristine sprint sources for the five approved Wave-0 assets and the
 * production outputs they build. Sources live OUTSIDE the repository and are opened
 * read-only; the pipeline never writes to them.
 *
 * Source record: /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/FINAL-SPRINT-SUMMARY.md
 */

/** Pristine sprint root (outside the repo). Overridable for CI/relocation. */
export const INTAKE_ROOT =
  process.env.BLOCKLIFE_INTAKE_ROOT ?? '/Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31'

/** Max texture edge enforced by scripts/assetReport.mjs. */
export const MAX_TEXTURE = 1024

/**
 * Output textures are JPEG on purpose. assetReport.mjs measures embedded texture
 * dimensions from PNG (IHDR) and JPEG (SOF) headers only — a WebP texture would make
 * that budget check pass VACUOUSLY. JPEG keeps the gate genuinely enforcing.
 */
export const TEXTURE_FORMAT = 'jpeg'
export const TEXTURE_QUALITY = 85

const LICENSE = 'Meshy AI generated asset (meshy.ai terms)'
const ATTRIB = 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), assembled + texture-optimized in-repo'

/**
 * Characters are assembled from three per-clip sprint GLBs that share a byte-identical
 * mesh, texture and 24-bone skeleton (verified by the pipeline before merging). The
 * merge is purely additive: clips are grafted onto ONE base by bone name, so geometry,
 * skin weights and bind matrices are unchanged. Clip names are the canonical semantic
 * role names already listed in CHARACTER_ASSETS aliases — no second animation system.
 */
/**
 * Issue #27 — the ONE derivation step allowed on a Wave-0 character output.
 *
 * A `derive` runs AFTER the pristine merge above, on the merge's own bytes: the pipeline asserts
 * `baseSha256` first, so the sprint sources stay the provenance root and the merge contract keeps
 * proving itself, then rewrites only what the recipe names and asserts `outputSha256`. Both hashes
 * are pinned, so neither the base nor the derived result can drift silently.
 *
 * Ravi's shipped Idle is a single static key with the elbows bent 114°, which holds his arms out in
 * front of him. `raviIdle.mjs` replaces ONLY that clip with a 4 s breathing loop. Geometry, skin,
 * rest transforms, materials, textures and the Walk/Run clips are untouched and gated by
 * `src/game/assets/raviIdleContract.test.ts`.
 */
const RAVI_IDLE_V2 = {
  id: 'ravi_idle_v2',
  label: 'Natural idle — arms down, 4 s breathing loop (issue #27)',
  module: './raviIdle.mjs',
  export: 'bakeRaviIdle',
  /** The unmodified Wave-0 merge output this recipe derives FROM. */
  baseSha256: 'f9ac3d5b8606c34007de89bfed05a764cfd2a4b843bb000e44fd0713488d6fe4',
  /** The independently reviewed candidate these bytes must reproduce exactly. */
  outputSha256: '7deab5d70a127e42a2433648906e9cdd6cfdf7415723e5f6d1e13a87e06c56a7',
  operations: [
    'rewrite ONLY the "Idle" clip: 72 channels, 33 keys over 4.000 s, LINEAR',
    'arms re-aimed by world-space rotation (elbow bend 114.3/114.8 deg -> 11.5/11.5, 0.000000 m length drift)',
    'wrist roll solved numerically so the palm faces the thigh',
    'translation/scale tracks hold the ORIGINAL Idle key, so no lower-body joint moves',
    'Walk/Run samplers, geometry, skin, rest transforms, materials and textures untouched',
  ],
  review: 'BlockLife-intake/ravi-idle-pilot-2026-09-09.wpiibR (authoring + structural review), '
    + 'BlockLife-intake/ravi-ingame-validation-2026-09-09.o371fa (in-game/controller validation)',
}

export const CHARACTERS = [
  {
    id: 'blocklife_kabir_01',
    label: 'Kabir Sen (candidate / DEV review only)',
    out: 'public/assets/models/characters/blocklife_kabir_01.glb',
    heightMeters: 1.75,
    sources: {
      Idle: `${INTAKE_ROOT}/humans-roster/humans/kabir-sen-v3-rigged.glb`,
      Walk: `${INTAKE_ROOT}/humans-roster/humans/kabir-sen-v3-walking.glb`,
      Run: `${INTAKE_ROOT}/humans-roster/humans/kabir-sen-v3-running.glb`,
    },
    base: 'Idle',
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'blocklife_ravi_01',
    label: 'Ravi Sharma (Wave 4 named body for npc_ravi_01)',
    out: 'public/assets/models/characters/blocklife_ravi_01.glb',
    heightMeters: 1.76,
    sources: {
      Idle: `${INTAKE_ROOT}/humans-roster/humans/ravi-sharma-rigged.glb`,
      Walk: `${INTAKE_ROOT}/humans-roster/humans/ravi-sharma-walking.glb`,
      Run: `${INTAKE_ROOT}/humans-roster/humans/ravi-sharma-running.glb`,
    },
    base: 'Idle',
    derive: RAVI_IDLE_V2,
    attribution: ATTRIB,
    license: LICENSE,
  },
]

/** Static assets: texture reduction + prune/dedupe only. Geometry untouched. */
export const STATICS = [
  {
    id: 'vehicle_compact_sedan_01',
    label: 'Compact sedan body (projected onto the one drivable shell)',
    src: `${INTAKE_ROOT}/vehicles-worker/final/blocklife_vehicle_compact_sedan.glb`,
    out: 'public/assets/models/vehicles/compact_sedan_01.glb',
    /** Normalized so the existing variant pipeline's `paint` slot keeps working. */
    materialName: 'paint',
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'arch_office_01',
    label: 'Office landmark (projected onto building_office_01)',
    src: `${INTAKE_ROOT}/buildings-worker/glb/office_01.glb`,
    out: 'public/assets/models/city/arch_office_01.glb',
    materialName: 'wall',
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'prop_park_bench_01',
    label: 'Park bench (projected onto the existing bench prop type)',
    src: `${INTAKE_ROOT}/props-worker/final/blocklife_prop_park_bench.glb`,
    out: 'public/assets/models/props/prop_park_bench_01.glb',
    materialName: 'bench',
    attribution: ATTRIB,
    license: LICENSE,
  },
]

export const PROVENANCE_OUT = 'docs/asset-provenance/wave0-provenance.json'
