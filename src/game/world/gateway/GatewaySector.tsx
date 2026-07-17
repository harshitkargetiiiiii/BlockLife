import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { BUILDINGS, GATEWAY, PROPS } from '../cityLayout'
import { Buildings } from '../Buildings'
import { Props } from '../Props'
import { getOwnedIds } from '../sectors/sectorContent'
import { PROP_SOLIDITY } from '../solidFootprints'
import { roadMaterial, sidewalkMaterial } from '../materials'
import { SurfaceDetailLayer } from '../surfaces/SurfaceDetailLayer'
import { getSurfaceDetailsForSector } from '../surfaces/sectorSurfaceDetails'

/**
 * Downtown Gateway (sector s0_-1): the freight arterial continues north
 * into a small downtown block — avenue, paved plaza, five tall buildings.
 *
 * Authoring-contract proof: buildings and props are data-authored into the
 * SAME arrays as the rest of the city (ownership derives from position);
 * this component only adds the sector-local ground planes and walls. Any
 * future sector follows the identical pattern.
 */

const GATEWAY_BUILDINGS = getOwnedIds('s0_-1', 'building')
const GATEWAY_PROPS = getOwnedIds('s0_-1', 'prop')

const road = GATEWAY.road
const plaza = GATEWAY.plaza
const area = GATEWAY.area

export function GatewaySectorVisuals() {
  const roadW = road.maxX - road.minX
  const roadD = road.maxZ - road.minZ
  const cx = (road.minX + road.maxX) / 2
  const cz = (road.minZ + road.maxZ) / 2
  const dashes: number[] = []
  for (let z = road.minZ + 4; z < road.maxZ - 4; z += 6) dashes.push(z)
  return (
    <group name="gateway-sector">
      <SurfaceDetailLayer details={getSurfaceDetailsForSector('s0_-1')} />
      {/* Grass base for the block */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[(area.minX + area.maxX) / 2, 0.005, (area.minZ + area.maxZ) / 2]}
        receiveShadow
      >
        <planeGeometry args={[area.maxX - area.minX, area.maxZ - area.minZ]} />
        <meshStandardMaterial color="#7ba05f" roughness={1} />
      </mesh>
      {/* Avenue asphalt */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0.02, cz]} material={roadMaterial} receiveShadow>
        <planeGeometry args={[roadW, roadD]} />
      </mesh>
      {/* Centerline dashes */}
      {dashes.map((z) => (
        <mesh key={z} rotation-x={-Math.PI / 2} position={[cx, 0.035, z]}>
          <planeGeometry args={[0.35, 2.4]} />
          <meshStandardMaterial color="#d8c46a" />
        </mesh>
      ))}
      {/* Sidewalks flanking the avenue */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[road.minX - 1.5, 0.03, cz]}
        material={sidewalkMaterial}
        receiveShadow
      >
        <planeGeometry args={[3, roadD]} />
      </mesh>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[road.maxX + 1.5, 0.03, cz]}
        material={sidewalkMaterial}
        receiveShadow
      >
        <planeGeometry args={[3, roadD]} />
      </mesh>
      {/* Plaza pad */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[(plaza.minX + plaza.maxX) / 2, 0.03, (plaza.minZ + plaza.maxZ) / 2]}
        material={sidewalkMaterial}
        receiveShadow
      >
        <planeGeometry args={[plaza.maxX - plaza.minX, plaza.maxZ - plaza.minZ]} />
      </mesh>
      {/* Sector-owned buildings + props from the shared data arrays */}
      <Buildings only={GATEWAY_BUILDINGS} />
      <Props only={GATEWAY_PROPS} kiosk={false} />
    </group>
  )
}

export function GatewaySectorColliders() {
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Floor under the North Boulevard corridor this cell HOSTS (the
          road itself is authored by s0_-2). The global slab ends at
          z=-123 and s0_-2's own floors mount only when it streams in —
          a teleport that commits here before the neighbor is warm (the
          coordinator gates on the landing cell only) must still find
          ground. Overlaps the slab and the neighbor's floors at both
          seams. */}
      <CuboidCollider args={[12, 0.5, 51]} position={[50, -0.5, -165]} />
      {/* Buildings */}
      {BUILDINGS.filter((b) => GATEWAY_BUILDINGS.includes(b.id)).map((b) => (
        <CuboidCollider
          key={b.id}
          args={[b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]}
          position={[b.position[0], b.size[1] / 2, b.position[1]]}
        />
      ))}
      {/* Solid props (same PROP_SOLIDITY table as the central city) */}
      {PROPS.filter((p) => GATEWAY_PROPS.includes(p.id)).map((p) => {
        const spec = PROP_SOLIDITY[p.type]
        if (!spec.half) return null
        const [dx, dz] = spec.offset ?? [0, 0]
        return (
          <CuboidCollider
            key={p.id}
            args={spec.half}
            position={[p.position[0] + dx, spec.half[1], p.position[1] + dz]}
            rotation={[0, p.rotationY ?? 0, 0]}
          />
        )
      })}
      {/* Perimeter walls trace the playable area; the south edge abuts the
          central sector's wall line, open only at the corridor mouth
          (x 40..56) to match CityColliders' north-wall gap. */}
      {/* North wall splits around the North Boulevard corridor (x 42..54 —
          the waterfront trunk continues the avenue past the gateway). */}
      <CuboidCollider
        args={[(42 - (area.minX - 2)) / 2, 4, 1]}
        position={[(area.minX - 2 + 42) / 2, 2, area.minZ - 1]}
      />
      <CuboidCollider
        args={[(area.maxX + 2 - 54) / 2, 4, 1]}
        position={[(54 + area.maxX + 2) / 2, 2, area.minZ - 1]}
      />
      <CuboidCollider
        args={[1, 4, (area.maxZ - area.minZ) / 2 + 2]}
        position={[area.minX - 1, 2, (area.minZ + area.maxZ) / 2]}
      />
      {/* East wall splits around the Main Street East corridor (z -104..-92
          — matches the proof sector's declared west wall opening). */}
      <CuboidCollider
        args={[1, 4, (-104 - (area.minZ - 2)) / 2]}
        position={[area.maxX + 1, 2, (area.minZ - 2 + -104) / 2]}
      />
      <CuboidCollider
        args={[1, 4, (area.maxZ + 2 - -92) / 2]}
        position={[area.maxX + 1, 2, (-92 + area.maxZ + 2) / 2]}
      />
      <CuboidCollider
        args={[(GATEWAY.corridorMinX - area.minX) / 2, 4, 1]}
        position={[(area.minX + GATEWAY.corridorMinX) / 2, 2, area.maxZ + 1]}
      />
      <CuboidCollider
        args={[(area.maxX - GATEWAY.corridorMaxX) / 2, 4, 1]}
        position={[(GATEWAY.corridorMaxX + area.maxX) / 2, 2, area.maxZ + 1]}
      />
    </RigidBody>
  )
}
