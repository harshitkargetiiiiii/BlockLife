import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store/useGameStore'
import { getCrimeGameTime } from '../crime/crimeSystem'
import { STEALABLE_VEHICLES } from './vehicleCrimeState'
import { ejectedDriverRuntime, stepEjectedDrivers } from './ejectedDriverRuntime'

/**
 * Live driver + renderer for civilians carjacked out of an occupied vehicle.
 * Each frame it advances every ejected driver's flee (pure runtime step) then
 * maps the active drivers onto a small fixed mesh pool — no per-frame
 * allocation, no React state churn. Pause-aware (the game clock freezes on
 * pause). The mesh pool size is the number of authored occupied vehicles.
 */

const MAX_DRIVERS = STEALABLE_VEHICLES.filter((v) => v.access === 'civilian_occupied').length

const bodyGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8)
const headGeo = new THREE.SphereGeometry(0.2, 12, 12)
const headMat = new THREE.MeshStandardMaterial({ color: '#e8b58f' })

export function EjectedDrivers() {
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const bodyMats = useRef<THREE.MeshStandardMaterial[]>([])

  useFrame(() => {
    const store = useGameStore.getState()
    if (store.worldPaused) {
      // Still map positions so a paused scene renders drivers at rest.
      mapDrivers(groupRefs.current, bodyMats.current)
      return
    }
    const gameTime = getCrimeGameTime()
    stepEjectedDrivers(1 / 60, gameTime)
    mapDrivers(groupRefs.current, bodyMats.current)
  })

  return (
    <group name="ejected-drivers">
      {Array.from({ length: MAX_DRIVERS }).map((_, i) => (
        <group key={i} ref={(el) => (groupRefs.current[i] = el)} visible={false}>
          <mesh geometry={bodyGeo} position={[0, 0.7, 0]} castShadow>
            <meshStandardMaterial ref={(m) => m && (bodyMats.current[i] = m)} color="#5a4632" />
          </mesh>
          <mesh geometry={headGeo} material={headMat} position={[0, 1.2, 0]} />
        </group>
      ))}
    </group>
  )
}

function mapDrivers(
  groups: (THREE.Group | null)[],
  mats: THREE.MeshStandardMaterial[],
): void {
  const drivers = [...ejectedDriverRuntime.drivers.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    if (!g) continue
    const d = drivers[i]
    if (!d) {
      g.visible = false
      continue
    }
    g.visible = true
    g.position.set(d.pos[0], 0, d.pos[1])
    g.rotation.y = d.heading
    if (mats[i]) mats[i].color.set(d.color)
  }
}
