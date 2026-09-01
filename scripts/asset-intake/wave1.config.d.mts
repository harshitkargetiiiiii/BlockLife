/** Types for the issue #40 Wave 1 intake manifest, so contract tests can import it directly. */
export interface Wave1VehicleSource {
  id: string
  label: string
  vehicleDefId: string
  src: string
  out: string
  expect: { sha256: string; bytes: number; triangles: number }
  materialName: string
  attribution: string
  license: string
}
export declare const INTAKE_ROOT: string
export declare const MAX_TEXTURE: number
export declare const TEXTURE_FORMAT: string
export declare const TEXTURE_QUALITY: number
export declare const VEHICLES: Wave1VehicleSource[]
export declare const FOOTPRINT_FILL: number
export declare const PROVENANCE_OUT: string
