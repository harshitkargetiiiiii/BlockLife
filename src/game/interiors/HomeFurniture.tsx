import * as THREE from 'three'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useGameStore } from '../store/useGameStore'
import { getInterior } from './interiorRegistry'
import { getFurnitureDef } from '../housing/furnitureCatalog'
import { getAsset, getCurrentPropertyId, getPlacements } from '../housing/housingRuntime'
import { getProperty, getSlot } from '../housing/propertyRegistry'
import type { FurnitureCategory, FurnitureDef, SizeClass } from '../housing/housingTypes'

/**
 * Renders the player's PLACED furniture inside the CURRENT residence (issue #17
 * §6). Data-driven from the housing placements → slot transform → a parametric
 * mesh per category. It re-renders only when `housingVersion` bumps (a place/move/
 * store/replace action), never per frame, and only for the active home's placements
 * — so nothing from another property ever leaks into the current interior.
 */

const COLORS: Record<FurnitureCategory, string> = {
  bed: '#6f7fa8',
  seating: '#7a6a58',
  table: '#8a6b45',
  entertainment: '#33363c',
  storage: '#9a7b53',
  wardrobe: '#7c5233',
  lighting: '#f2c063',
  decor: '#c96f6f',
}
const cache = new Map<string, THREE.MeshStandardMaterial>()
function mat(color: string, opts: { emissive?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = color + (opts.emissive ? ':e' : '')
  let m = cache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.8,
      emissive: opts.emissive ? color : '#000000',
      emissiveIntensity: opts.emissive ? 0.5 : 0,
    })
    cache.set(key, m)
  }
  return m
}

const SIZE_SCALE: Record<SizeClass, number> = { small: 0.85, medium: 1.0, large: 1.2 }

/** A compact parametric mesh for a furniture def (category + size). */
function FurnitureMesh({ def }: { def: FurnitureDef }) {
  const c = COLORS[def.category]
  const s = SIZE_SCALE[def.size]
  switch (def.category) {
    case 'bed':
      return (
        <group>
          <mesh material={mat('#5c4a37')} position={[0, 0.22, 0]} castShadow>
            <boxGeometry args={[1.8 * s, 0.44, 2.7 * s]} />
          </mesh>
          <mesh material={mat(c)} position={[0, 0.5, 0.2]} castShadow>
            <boxGeometry args={[1.6 * s, 0.24, 2.1 * s]} />
          </mesh>
          <mesh material={mat('#f2ede2')} position={[0, 0.55, -0.95 * s]}>
            <boxGeometry args={[1.3 * s, 0.2, 0.6]} />
          </mesh>
        </group>
      )
    case 'seating':
      return (
        <group>
          <mesh material={mat(c)} position={[0, 0.32, 0]} castShadow>
            <boxGeometry args={[def.seating >= 3 ? 2.1 : 0.9 * s, 0.4, 0.85 * s]} />
          </mesh>
          <mesh material={mat(c)} position={[0, 0.62, -0.34 * s]}>
            <boxGeometry args={[def.seating >= 3 ? 2.1 : 0.9 * s, 0.5, 0.16]} />
          </mesh>
        </group>
      )
    case 'table':
      return (
        <group>
          <mesh material={mat(c)} position={[0, def.size === 'large' ? 0.72 : 0.4, 0]} castShadow>
            <boxGeometry args={[1.4 * s, 0.08, 0.8 * s]} />
          </mesh>
          {[-0.6 * s, 0.6 * s].map((ox) =>
            [-0.32 * s, 0.32 * s].map((oz) => (
              <mesh key={`${ox}:${oz}`} material={mat('#5c4a37')} position={[ox, (def.size === 'large' ? 0.72 : 0.4) / 2, oz]}>
                <boxGeometry args={[0.08, def.size === 'large' ? 0.72 : 0.4, 0.08]} />
              </mesh>
            )),
          )}
        </group>
      )
    case 'entertainment':
      return def.size === 'small' ? (
        <mesh material={mat(c)} position={[0, 0.25, 0]} castShadow>
          <boxGeometry args={[0.55, 0.3, 0.35]} />
        </mesh>
      ) : (
        <group>
          <mesh material={mat('#5c4a37')} position={[0, 0.3, 0]} castShadow>
            <boxGeometry args={[1.3, 0.6, 0.4]} />
          </mesh>
          <mesh material={mat(c, { emissive: false })} position={[0, 1.1, -0.05]}>
            <boxGeometry args={[1.4, 0.85, 0.08]} />
          </mesh>
        </group>
      )
    case 'storage':
      return (
        <mesh material={mat(c)} position={[0, (def.size === 'large' ? 1.6 : def.size === 'medium' ? 0.9 : 0.3) / 2 + 0.05, 0]} castShadow>
          <boxGeometry args={[def.size === 'small' ? 0.9 : 1.0, def.size === 'large' ? 1.6 : def.size === 'medium' ? 0.9 : 0.3, 0.5]} />
        </mesh>
      )
    case 'wardrobe':
      return (
        <mesh material={mat(c)} position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[1.0 * s, 2.1, 0.6]} />
        </mesh>
      )
    case 'lighting':
      return (
        <group>
          <mesh material={mat('#5c4a37')} position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.2, 0.24, 0.1, 10]} />
          </mesh>
          <mesh material={mat('#8a8a8a')} position={[0, 0.8, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 1.5, 8]} />
          </mesh>
          <mesh material={mat(c, { emissive: true })} position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.24, 0.3, 0.35, 12]} />
          </mesh>
        </group>
      )
    case 'decor':
      // A low rug-like plane for rugs, a small pot+foliage for plants, else a plaque.
      if (def.id.includes('rug')) {
        return (
          <mesh material={mat(c)} rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
            <planeGeometry args={[1.8 * s, 1.2 * s]} />
          </mesh>
        )
      }
      if (def.id.includes('plant')) {
        return (
          <group>
            <mesh material={mat('#b3573f')} position={[0, 0.2, 0]}>
              <cylinderGeometry args={[0.18, 0.14, 0.4, 10]} />
            </mesh>
            <mesh material={mat('#5e9e4e')} position={[0, 0.7, 0]}>
              <sphereGeometry args={[0.35, 10, 10]} />
            </mesh>
          </group>
        )
      }
      return (
        <mesh material={mat(c)} position={[0, 1.4, 0]}>
          <boxGeometry args={[0.7, 0.5, 0.05]} />
        </mesh>
      )
  }
}

/** Slots + assets → world transforms for the current residence's placements. */
function usePlacedFurniture() {
  useGameStore((s) => s.housingVersion) // re-render on placement changes
  const propertyId = getCurrentPropertyId()
  const property = getProperty(propertyId)
  const interior = property ? getInterior(property.interiorId) : undefined
  if (!interior) return []
  const [ox, oz] = interior.origin
  const out: { key: string; def: FurnitureDef; x: number; z: number; rotationY: number; solid: boolean }[] = []
  for (const [slotId, assetId] of Object.entries(getPlacements())) {
    const slot = getSlot(propertyId, slotId)
    const asset = getAsset(assetId)
    if (!slot || !asset) continue
    const def = getFurnitureDef(asset.defId)
    if (!def) continue
    out.push({
      key: `${slotId}:${assetId}`,
      def,
      x: ox + slot.local[0],
      z: oz + slot.local[1],
      rotationY: asset.rotationY,
      solid: isSolidFurniture(def),
    })
  }
  return out
}

/** Solid pieces get a collider so the player can't walk through them (§6 clearance). */
function isSolidFurniture(def: FurnitureDef): boolean {
  if (def.category === 'bed' || def.category === 'storage' || def.category === 'wardrobe') return true
  if (def.category === 'seating' && def.size !== 'small') return true
  if (def.category === 'table' && def.size === 'large') return true
  if (def.category === 'entertainment' && def.size !== 'small') return true
  return false
}

function solidHalfExtents(def: FurnitureDef): [number, number, number] {
  const s = SIZE_SCALE[def.size]
  switch (def.category) {
    case 'bed':
      return [0.95 * s, 0.5, 1.4 * s]
    case 'seating':
      return [def.seating >= 3 ? 1.1 : 0.5 * s, 0.5, 0.5 * s]
    case 'table':
      return [0.75 * s, 0.4, 0.45 * s]
    case 'wardrobe':
      return [0.55 * s, 1.05, 0.35]
    case 'storage':
      return [0.5, def.size === 'large' ? 0.85 : 0.5, 0.3]
    case 'entertainment':
      return [0.7, 0.6, 0.25]
    default:
      return [0.3, 0.3, 0.3]
  }
}

export function HomeFurniture() {
  const placed = usePlacedFurniture()
  return (
    <group name="home-furniture">
      {placed.map((p) => (
        <group key={p.key} position={[p.x, 0, p.z]} rotation-y={p.rotationY}>
          <FurnitureMesh def={p.def} />
        </group>
      ))}
    </group>
  )
}

export function HomeFurnitureColliders() {
  const placed = usePlacedFurniture().filter((p) => p.solid)
  return (
    <RigidBody type="fixed" colliders={false}>
      {placed.map((p) => {
        const h = solidHalfExtents(p.def)
        return <CuboidCollider key={p.key} args={h} position={[p.x, h[1], p.z]} rotation={[0, p.rotationY, 0]} />
      })}
    </RigidBody>
  )
}
