import { useMemo } from 'react'
import { PROPS } from './cityLayout'
import { createRng, hashString } from '../traffic/routing/routeRng'

/**
 * Central Plaza greenery: low shrubs planted in the plaza's three street planters, which shipped
 * as bare soil and read as drains at the gameplay camera. Purely visual — no collider (each sits
 * inside its planter's existing footprint), no occlusion participation, and it is authored for
 * exactly these placements rather than changing the planter prop everywhere.
 */
const PLAZA_PLANTER_IDS = ['prop_street_planter_01', 'prop_street_planter_02', 'prop_street_planter_03'] as const

// Planter soil height at the planter's 0.55 manifest scale, and the shrub's footprint inside it.
const SOIL_Y = 0.36
const LEAF = ['#5f8f4a', '#6c9c52', '#557f43']
const BLOOM = ['#e8927c', '#ffd166', '#c86b85']

interface Puff {
  pos: [number, number, number]
  r: number
  color: string
}

/** Deterministic puffs for one planter: a leafy mound plus a few blossoms on top. */
function shrubPuffs(id: string): Puff[] {
  const rng = createRng(hashString(`plaza_greenery:${id}`))
  const puffs: Puff[] = []
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.6
    const d = i === 0 ? 0 : 0.2 + rng() * 0.08
    puffs.push({
      pos: [Math.cos(a) * d, SOIL_Y + 0.16 + rng() * 0.08 + (i === 0 ? 0.12 : 0), Math.sin(a) * d],
      r: i === 0 ? 0.3 : 0.2 + rng() * 0.05,
      color: LEAF[Math.floor(rng() * LEAF.length)],
    })
  }
  const bloom = BLOOM[Math.floor(rng() * BLOOM.length)]
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2
    puffs.push({ pos: [Math.cos(a) * 0.18, SOIL_Y + 0.5 + rng() * 0.06, Math.sin(a) * 0.18], r: 0.055, color: bloom })
  }
  return puffs
}

export function PlazaGreenery() {
  const shrubs = useMemo(
    () =>
      PLAZA_PLANTER_IDS.flatMap((id) => {
        const prop = PROPS.find((p) => p.id === id)
        return prop ? [{ id, position: prop.position, puffs: shrubPuffs(id) }] : []
      }),
    [],
  )
  return (
    <group name="plaza-greenery">
      {shrubs.map((s) => (
        <group key={s.id} position={[s.position[0], 0, s.position[1]]}>
          {s.puffs.map((p, i) => (
            <mesh key={i} position={p.pos} castShadow>
              <icosahedronGeometry args={[p.r, 1]} />
              <meshStandardMaterial color={p.color} roughness={0.85} flatShading />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}
