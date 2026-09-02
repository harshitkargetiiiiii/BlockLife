/** Types for the issue #42 Wave 2 intake manifest, so contract tests can import it directly. */
export interface Wave2PropSource {
  id: string
  label: string
  propType: string
  src: string
  out: string
  expect: { sha256: string; bytes: number; triangles: number }
  materialName: string
  /** Centred-origin source: grounded by a root-node translation during intake. */
  ground?: boolean
  /** Measure where this body's light-emitting head sits (streetlight only). */
  measureEmitter?: boolean
  attribution: string
  license: string
}
export declare const INTAKE_ROOT: string
export declare const MAX_TEXTURE: number
export declare const TEXTURE_FORMAT: string
export declare const TEXTURE_QUALITY: number
export declare const PROPS: Wave2PropSource[]
export declare const BOUNDS_EPSILON: number
export declare const SCALE_DECIMALS: number
export declare const PROVENANCE_OUT: string
