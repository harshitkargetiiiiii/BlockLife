/** Types for the issue #27 named-resident Idle derivation, so the contract test can import it directly. */
import type * as THREE from 'three'
import type { Document } from '@gltf-transform/core'

/** The intake's registered NodeIO (scripts/asset-intake/lib.mjs, ALL_EXTENSIONS). */
export declare const io: { readBinary(bytes: Uint8Array): Promise<Document> }

export declare const IDLE_DURATION: number
export declare const FPS_KEYS: number
export declare const KEYS: number
export declare const ORIGINAL_IDLE_TIME: number
/** The canonical 24 skin joints, in skin order. */
export declare const JOINTS: string[]
export declare const LOWER_BODY: string[]
/** Joints whose Idle rotation the recipe authors; every other joint's rotation is held bit-exact. */
export declare const AUTHORED_JOINTS: string[]
export declare const BREATH: Record<string, { axis: number[]; amp: number; phase?: number; amp2?: number }>
export declare const HAND_PLANE_SEMANTICS: string
export declare const NAMED_IDLE_OPERATIONS: string[]

export interface NamedIdleKey { translation: number[]; rotation: number[]; scale: number[] }
export interface NamedIdleRig {
  gltf: unknown
  mesh: THREE.SkinnedMesh
  bones: THREE.Bone[]
  root: THREE.Object3D
  J: Record<string, number>
}
export interface NamedIdleInput { keys: Map<number, NamedIdleKey> }
export interface NamedIdleArmParams { upperLateralDeg: number; upperForwardDeg: number; foreLateralDeg: number; foreForwardDeg: number }

export declare function sha256(bytes: Uint8Array): string
export declare function loadRig(bytes: Buffer, id: string): Promise<NamedIdleRig>
export declare function applyKeys(rig: NamedIdleRig, keyOf: (skinIndex: number) => NamedIdleKey): void
export declare function worldPos(rig: NamedIdleRig, joint: string): THREE.Vector3
export declare function frameCheck(rig: NamedIdleRig): Record<string, boolean>
export declare function handPlane(rig: NamedIdleRig, joint: string): { vertices: number; flatness: number; identified: boolean; normalLocal: number[] }
export declare function armParams(upperLateralDeg: number): NamedIdleArmParams
export declare function solveArms(rig: NamedIdleRig, params: NamedIdleArmParams, planes: Record<'Left' | 'Right', unknown>): Record<'Left' | 'Right', Record<string, unknown>>
export declare function snapshot(rig: NamedIdleRig): THREE.Quaternion[]
export declare function breathingKeys(rig: NamedIdleRig, resting: THREE.Quaternion[], input: NamedIdleInput): {
  keys: number[][]
  maxLoopDelta: number
  maxNormDeviationBeforeNormalize: number
  untouchedJointsBitExact: string[]
}
export declare function deriveNamedIdle(inPath: string, outPath: string, spec: { id: string; baseSha256: string; baseBytes: number; upperLateralDeg: number }): Promise<Record<string, unknown>>
export declare function idleInvarianceDigests(doc: unknown): {
  geometry: string
  nodes: string
  skin: string
  materials: string
  /** Decoded material extension values (IOR) and every texture slot's TextureInfo/sampler state. */
  materialSampling: string
  images: string
  walk: string
  run: string
  idle: string
  idleHeld: string
  extensionsUsed: string[]
  nodeCount: number
  heldIdleChannels: number
}
