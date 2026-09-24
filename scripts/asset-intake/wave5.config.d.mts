/** Types for the Integration Wave 5 intake manifest, so contract tests can import it directly. */
export interface Wave5SourceExpectation {
  sha256: string
  bytes: number
  triangles: number
}

export interface Wave5VehicleSource {
  id: string
  label: string
  /** The runtime home whose authored visual envelope this body is fitted inside. */
  envelope: 'cruiser'
  src: string
  out: string
  expect: Wave5SourceExpectation
  materialName: string
  ground?: boolean
  attribution: string
  license: string
}

export declare const INTAKE_ROOT: string
export declare const MAX_TEXTURE: number
export declare const TEXTURE_FORMAT: string
export declare const TEXTURE_QUALITY: number
export declare const CRUISER_ENVELOPE: { halfX: number; halfZ: number; maxY: number }
export declare const VEHICLES: Wave5VehicleSource[]
export declare const BOUNDS_EPSILON: number
export declare const SCALE_DECIMALS: number
export declare const PROVENANCE_OUT: string
