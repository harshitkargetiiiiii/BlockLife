// Type declarations for the H0 proof rig-inspection script (issue #27) so a typed .ts test can
// import it under the strict build tsconfig.
export interface RigInspection {
  file: string
  bones: number
  hierarchySignature: string
  units: string
  forwardAxisConvention: string
  bindMatrices: number
  skinInfluences: {
    vertices: number
    maxPerVertex: number
    zeroWeightVerts: number
    nanVerts: number
    histogram_0to4: number[]
    distinctBonesUsed: number
  }
  groundedBounds: {
    min: number[]
    max: number[]
    size: number[]
    baseAtGround: boolean
  }
  restTransforms: { name: string; parent: string; t: number[] }[]
  clips: { name: string; tracks: number; duration: number }[]
}

export function inspect(path: string): Promise<RigInspection>
export function hierarchySignature(skeleton: unknown): string
