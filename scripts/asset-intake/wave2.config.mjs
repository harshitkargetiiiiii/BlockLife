/**
 * Issue #42 — Integration Wave 2 asset intake manifest (declarative, deterministic).
 *
 * Names the EXACT pristine sprint sources for the three approved Wave-2 street props — the
 * vintage lantern streetlight, the corrected blank-barrel fire hydrant and the trash bin —
 * which project onto the EXISTING `street_lamp`, `hydrant` and `trash_can` prop types. Sources
 * live OUTSIDE the repository and are opened read-only; the pipeline never writes to them.
 *
 * Source record:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/FINAL-SPRINT-SUMMARY.md
 * Worker ledger:  /Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31/LEDGER-VEHICLES-PROPS.md
 *
 * No Meshy call, paid generation, enhancement, remesh, retexture, rig, animation or asset
 * purchase is involved: these are the already-approved 2026-08-31 sprint outputs, reduced and
 * normalized in-repo. Zero credits.
 */

/** Pristine sprint root (outside the repo). Overridable for CI/relocation. */
export const INTAKE_ROOT =
  process.env.BLOCKLIFE_INTAKE_ROOT ?? '/Users/harshitkargeti/BlockLife-intake/asset-sprint-2026-08-31'

/**
 * Issue #42 caps Wave-2 prop textures at 512 — half the 1024 policy ceiling Waves 0/1 used.
 * A street prop is a few dozen pixels tall at play distance and is instanced dozens of times
 * across the city, so it is the payload, not the detail, that is visible.
 */
export const MAX_TEXTURE = 512

/**
 * Output textures are JPEG on purpose. assetReport.mjs measures embedded texture dimensions
 * from PNG (IHDR) and JPEG (SOF) headers only — a WebP texture would make that budget check
 * pass VACUOUSLY. JPEG keeps the gate genuinely enforcing. (Same rule as Waves 0 and 1.)
 */
export const TEXTURE_FORMAT = 'jpeg'
export const TEXTURE_QUALITY = 85

/**
 * Each approved prop is ONE baked atlas: every surface — pole, lantern glass, barrel, caps,
 * lid — is painted into the same single texture as the body. There is no clean recolorable
 * slot to expose, and tinting the atlas would recolor the whole prop. Issue #42 is explicit:
 * "Expose no recolor slot for these one-material baked atlases; retain source colours
 * honestly." So the material is deliberately named something that is NOT a slot candidate in
 * any manifest declaration or default candidate list — the same guard Wave 1 put on the
 * vehicle bodies.
 */
const BAKED_MATERIAL = 'baked_atlas'

const LICENSE = 'Meshy AI generated asset (meshy.ai terms)'
const ATTRIB = 'Meshy AI — generated original asset (owner-approved 2026-08-31 sprint), texture-optimized in-repo'

/**
 * The three Wave-2 street props.
 *
 * `expect` pins the owner-approved source identity. SHA-256 is authoritative and is asserted
 * before the file is read; `bytes` and `triangles` are secondary checks against the issue #42
 * table (all three match exactly — unlike Wave 1's van, there is no transcription slip here).
 *
 * `ground: true` marks a source whose origin is CENTRED rather than at its base. Only the
 * hydrant needs it: it skipped the separate remesh stage where `origin_at: bottom` is applied,
 * so it reports minY = -1. `buildStatic` grounds it with a root-node translation — mesh
 * accessor bytes untouched — and asserts the rendered minimum really lands on y = 0.
 */
export const PROPS = [
  {
    id: 'prop_streetlight_01',
    label: 'Vintage lantern streetlight (projected onto the existing street_lamp prop type)',
    propType: 'street_lamp',
    src: `${INTAKE_ROOT}/props-worker/final/blocklife_prop_streetlight.glb`,
    out: 'public/assets/models/props/prop_streetlight_01.glb',
    expect: { sha256: 'b5cbb22e194d819118318f6f936a7c5bc21c47cdfb2d4defbf6f5ccbb845bbe4', bytes: 5939352, triangles: 6975 },
    materialName: BAKED_MATERIAL,
    /**
     * Geometry only — the GLB carries no light. The FUNCTIONAL night illumination stays in the
     * repo as a bounded sibling, so the pipeline measures where this body's lantern actually is
     * (see `measureEmitter` in buildWave2.mjs) and records it in the provenance. The manifest's
     * `nightLight` is derived from that measurement, never guessed.
     */
    measureEmitter: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'prop_fire_hydrant_01',
    label: 'Fire hydrant, blank-barrel retry (projected onto the existing hydrant prop type)',
    propType: 'hydrant',
    src: `${INTAKE_ROOT}/props-worker/final/blocklife_prop_fire_hydrant.glb`,
    out: 'public/assets/models/props/prop_fire_hydrant_01.glb',
    expect: { sha256: '1129433f98381b4fd10725ee3f412e131f1108a63f016a376233bb5e1d2c6c24', bytes: 3084436, triangles: 8133 },
    materialName: BAKED_MATERIAL,
    ground: true,
    attribution: ATTRIB,
    license: LICENSE,
  },
  {
    id: 'prop_trash_bin_01',
    label: 'Street trash bin (projected onto the existing trash_can prop type)',
    propType: 'trash_can',
    src: `${INTAKE_ROOT}/props-worker/final/blocklife_prop_trash_bin.glb`,
    out: 'public/assets/models/props/prop_trash_bin_01.glb',
    expect: { sha256: '829161b2b1c7898e2e94bd2360bf4c48dac834c130c5c582cf1bb65b45fd6009', bytes: 4977900, triangles: 7703 },
    materialName: BAKED_MATERIAL,
    attribution: ATTRIB,
    license: LICENSE,
  },
]

/**
 * The Wave-2 projection rule, shared verbatim by the manifest derivation and by
 * `wave2Contract.test.ts`, which recomputes every shipped scale from `PROP_PLACEMENT` and the
 * measured bounds rather than trusting the manifest's literals.
 *
 * A prop TYPE already owns an authored visual envelope in `src/game/world/propPlacement.ts`
 * (`visualHalf` in local XZ, `vertical` as [minY, maxY]) which the whole-city placement
 * validators read. Issue #42 forbids changing that table, so the projected body must fit
 * ENTIRELY inside it: the scale is the largest UNIFORM factor that keeps every measured extent
 * within the authored envelope — the same rule Wave 0 used for the park bench, applied to the
 * measured source bbox rather than reusing the bench's constant.
 *
 *   s = floor( min( half_x / ext_x, half_z / ext_z, height / size_y ) * 10^4 ) / 10^4
 *
 * where `ext_*` is the larger of |min| and |max| on that axis (the props are not exactly
 * centred) and every measured dimension is inflated by BOUNDS_EPSILON first. That epsilon is
 * half of `measureBounds`' 4-dp rounding step: without it a value that rounded DOWN could let
 * the derived scale overhang the authored envelope by up to 5e-5 units.
 */
export const BOUNDS_EPSILON = 5e-5
export const SCALE_DECIMALS = 4

export const PROVENANCE_OUT = 'docs/asset-provenance/wave2-provenance.json'
