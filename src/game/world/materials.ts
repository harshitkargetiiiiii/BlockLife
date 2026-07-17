import * as THREE from 'three'

/**
 * Shared materials for everything that glows at night. WorldDirector drives
 * `updateGlowMaterials` every frame with the current lamp glow (0..1), so a
 * single uniform update lights every window, lamp and headlight in the city.
 */
export const windowLitMaterial = new THREE.MeshStandardMaterial({
  color: '#2c3644',
  emissive: '#ffb45e',
  emissiveIntensity: 0,
  roughness: 0.4,
  metalness: 0.1,
})

export const windowDimMaterial = new THREE.MeshStandardMaterial({
  color: '#2c3644',
  emissive: '#48607a',
  emissiveIntensity: 0,
  roughness: 0.4,
  metalness: 0.1,
})

export const lampBulbMaterial = new THREE.MeshStandardMaterial({
  color: '#fff2cc',
  emissive: '#ffd27f',
  emissiveIntensity: 0.05,
})

export const lampGlowMaterial = new THREE.MeshBasicMaterial({
  color: '#ffd98a',
  transparent: true,
  opacity: 0,
  depthWrite: false,
})

/**
 * Glow planes overlaid on GLB building façades (their exports have no
 * emissive windows). Unlit + transparent: opacity 0 makes them vanish by
 * day; depthWrite off avoids sorting artifacts against the façade behind.
 */
export const glbWindowGlowMaterial = new THREE.MeshBasicMaterial({
  color: '#ffc87d',
  transparent: true,
  opacity: 0,
  toneMapped: false,
  depthWrite: false,
})

export const headlightMaterial = new THREE.MeshStandardMaterial({
  color: '#fff7d6',
  emissive: '#fff3c2',
  emissiveIntensity: 0.1,
})

export const taillightMaterial = new THREE.MeshStandardMaterial({
  color: '#8f2f2f',
  emissive: '#ff5a4d',
  emissiveIntensity: 0.15,
})

/** Swapped onto taillight meshes while a car brakes/stops — bright and readable. */
export const brakeLightMaterial = new THREE.MeshStandardMaterial({
  color: '#a11f1f',
  emissive: '#ff2e1f',
  emissiveIntensity: 1.4,
  toneMapped: false,
})

/* Traffic signal lamps — shared across every signal head; WorldDirector-free:
   TrafficLights updates intensities from the deterministic signal clock. */
export const signalRedMaterial = new THREE.MeshStandardMaterial({
  color: '#5a1512',
  emissive: '#ff3b30',
  emissiveIntensity: 0.05,
  toneMapped: false,
})
export const signalYellowMaterial = new THREE.MeshStandardMaterial({
  color: '#5a4a10',
  emissive: '#ffc21f',
  emissiveIntensity: 0.05,
  toneMapped: false,
})
export const signalGreenMaterial = new THREE.MeshStandardMaterial({
  color: '#14501e',
  emissive: '#3ddc5a',
  emissiveIntensity: 0.05,
  toneMapped: false,
})
export const pedWalkMaterial = new THREE.MeshStandardMaterial({
  color: '#123c30',
  emissive: '#7fffcf',
  emissiveIntensity: 0.05,
  toneMapped: false,
})
export const pedStopMaterial = new THREE.MeshStandardMaterial({
  color: '#4a2410',
  emissive: '#ff8a3d',
  emissiveIntensity: 0.05,
  toneMapped: false,
})

/* Shared street surfaces so Weather can wet every road/sidewalk in the city
   with a single material update (darker + glossier under rain). */
const ROAD_BASE = new THREE.Color('#33323a')
const SIDEWALK_BASE = new THREE.Color('#b9b4ab')

export const roadMaterial = new THREE.MeshStandardMaterial({
  color: ROAD_BASE.clone(),
  roughness: 0.95,
  metalness: 0,
})

export const sidewalkMaterial = new THREE.MeshStandardMaterial({
  color: SIDEWALK_BASE.clone(),
  roughness: 0.92,
  metalness: 0,
})

/** Wet streets read as darker + reflective; wetness 0 restores the dry look. */
export function updateWetMaterials(wetness: number): void {
  const w = Math.min(1, Math.max(0, wetness))
  roadMaterial.color.copy(ROAD_BASE).multiplyScalar(1 - w * 0.42)
  roadMaterial.roughness = 0.95 - w * 0.62
  roadMaterial.metalness = w * 0.28
  sidewalkMaterial.color.copy(SIDEWALK_BASE).multiplyScalar(1 - w * 0.28)
  sidewalkMaterial.roughness = 0.92 - w * 0.4
  sidewalkMaterial.metalness = w * 0.12
}

export function updateGlowMaterials(glow: number): void {
  windowLitMaterial.emissiveIntensity = glow * 1.95
  windowDimMaterial.emissiveIntensity = glow * 0.18
  lampBulbMaterial.emissiveIntensity = 0.05 + glow * 2.7
  lampGlowMaterial.opacity = glow * 0.34
  glbWindowGlowMaterial.opacity = glow * 0.9
  headlightMaterial.emissiveIntensity = 0.1 + glow * 1.6
  taillightMaterial.emissiveIntensity = 0.15 + glow * 0.9
  brakeLightMaterial.emissiveIntensity = 1.4 + glow * 0.8
}

/** Deterministic pseudo-random in [0, 1) so window lighting is stable across runs. */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Returns `hex` darkened (factor < 1) or lightened (factor > 1) as a css hex string. */
export function shade(hex: string, factor: number): string {
  const c = new THREE.Color(hex)
  c.r = Math.min(1, c.r * factor)
  c.g = Math.min(1, c.g * factor)
  c.b = Math.min(1, c.b * factor)
  return `#${c.getHexString()}`
}
