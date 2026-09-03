/** Types for the issue #44 Wave 3 intake manifest, so contract tests can import it directly. */
export interface Wave3BuildingSource {
  id: string
  label: string
  /** Authored building ids this body projects onto (provenance; runtime wiring lives in src/). */
  placements: string[]
  src: string
  out: string
  expect: { sha256: string; bytes: number; triangles: number }
  materialName: string
  /** Assert the shipped body's rendered minimum really lands on y = 0. */
  ground?: boolean
  attribution: string
  license: string
}
export declare const INTAKE_ROOT: string
export declare const MAX_TEXTURE: number
export declare const TEXTURE_FORMAT: string
export declare const TEXTURE_QUALITY: number
export declare const BUILDINGS: Wave3BuildingSource[]
export declare const MAX_RENDERED_HEIGHT: number
export declare const BOUNDS_EPSILON: number
export declare const SCALE_DECIMALS: number
export declare const PROVENANCE_OUT: string
