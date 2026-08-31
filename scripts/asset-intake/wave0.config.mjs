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
export const CHARACTERS = [
  {
    id: 'blocklife_kabir_01',
    label: 'Kabir Sen (player)',
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
    label: 'Ravi Sharma (named NPC)',
    out: 'public/assets/models/characters/blocklife_ravi_01.glb',
    heightMeters: 1.76,
    sources: {
      Idle: `${INTAKE_ROOT}/humans-roster/humans/ravi-sharma-rigged.glb`,
      Walk: `${INTAKE_ROOT}/humans-roster/humans/ravi-sharma-walking.glb`,
      Run: `${INTAKE_ROOT}/humans-roster/humans/ravi-sharma-running.glb`,
    },
    base: 'Idle',
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
