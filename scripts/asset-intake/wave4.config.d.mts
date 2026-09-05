/** Types for the issue #47 Wave 4 intake manifest, so contract tests can import it directly. */
export interface Wave4SourceExpectation {
  sha256: string
  bytes: number
}

export interface Wave4CharacterSource {
  id: string
  label: string
  /** The ONE NPC runtime slot this body is allowed to fill (strict 1:1 — no swapping/reuse). */
  npc: string
  out: string
  heightMeters: number
  sources: Record<string, string>
  expect: Record<string, Wave4SourceExpectation>
  base: string
  attribution: string
  license: string
}

export interface Wave4VehicleSource {
  id: string
  label: string
  /** Authored prop type whose placements this body projects onto. */
  propType: 'parked_car' | 'parked_truck'
  src: string
  out: string
  expect: Wave4SourceExpectation & { triangles: number }
  materialName: string
  ground?: boolean
  attribution: string
  license: string
}

export interface Wave4BuildingSource {
  id: string
  label: string
  /** Authored building ids this body projects onto (provenance; runtime wiring lives in src/). */
  placements: string[]
  src: string
  out: string
  expect: Wave4SourceExpectation & { triangles: number }
  materialName: string
  ground?: boolean
  attribution: string
  license: string
}

export interface Wave4PropEnvelope {
  halfX: number
  halfZ: number
  maxY: number
}

export declare const INTAKE_ROOT: string
export declare const MAX_TEXTURE: number
export declare const TEXTURE_FORMAT: string
export declare const TEXTURE_QUALITY: number
export declare const CHARACTERS: Wave4CharacterSource[]
export declare const VEHICLES: Wave4VehicleSource[]
export declare const BUILDINGS: Wave4BuildingSource[]
export declare const MAX_RENDERED_HEIGHT: number
export declare const BOUNDS_EPSILON: number
export declare const SCALE_DECIMALS: number
export declare const PROP_ENVELOPES: Record<'parked_car' | 'parked_truck', Wave4PropEnvelope>
export declare const PROVENANCE_OUT: string

export declare const RIG_HEIGHT_METERS: number
export declare const RIG_FIT_TOLERANCE_METERS: number
export declare const RIG_FIT: Record<string, { heightMeters: number; sha256: string }>
