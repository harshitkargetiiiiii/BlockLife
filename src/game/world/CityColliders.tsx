import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'
import { BUILDINGS, CITY_BOUNDS, FOOD_TRUCK, JOB_KIOSK, PARK, PROPS } from './cityLayout'
import { PROP_SOLIDITY } from './solidFootprints'

/**
 * Static physics for the central city sector: simple cuboids only,
 * decoupled from the visual meshes so future GLB swaps never touch physics.
 * `buildingIds` scopes the building cuboids to the sector's owned set
 * (backdrop towers collide in their own shelf sectors).
 *
 * The north wall leaves a gap over the Downtown Gateway road corridor
 * (x 40..56) — the gateway sector provides its own perimeter walls.
 */
export function CityColliders({
  buildingIds,
  propIds,
}: {
  buildingIds?: readonly string[]
  propIds?: readonly string[]
}) {
  const northWallY = CITY_BOUNDS.minZ - 1
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Ground slab (covers all three districts) */}
      <CuboidCollider args={[120, 0.5, 110]} position={[16, -0.5, -13]} />

      {/* Invisible walls trace the rectangular CITY_BOUNDS. North wall is
          split around the gateway corridor at x 40..56. */}
      <CuboidCollider
        args={[(40 - (CITY_BOUNDS.minX - 4)) / 2, 4, 1]}
        position={[(CITY_BOUNDS.minX - 4 + 40) / 2, 2, northWallY]}
      />
      <CuboidCollider
        args={[(CITY_BOUNDS.maxX + 4 - 56) / 2, 4, 1]}
        position={[(56 + CITY_BOUNDS.maxX + 4) / 2, 2, northWallY]}
      />
      <CuboidCollider
        args={[(CITY_BOUNDS.maxX - CITY_BOUNDS.minX) / 2 + 4, 4, 1]}
        position={[(CITY_BOUNDS.minX + CITY_BOUNDS.maxX) / 2, 2, CITY_BOUNDS.maxZ + 1]}
      />
      <CuboidCollider
        args={[1, 4, (CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ) / 2 + 4]}
        position={[CITY_BOUNDS.minX - 1, 2, (CITY_BOUNDS.minZ + CITY_BOUNDS.maxZ) / 2]}
      />
      <CuboidCollider
        args={[1, 4, (CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ) / 2 + 4]}
        position={[CITY_BOUNDS.maxX + 1, 2, (CITY_BOUNDS.minZ + CITY_BOUNDS.maxZ) / 2]}
      />

      {/* Buildings */}
      {BUILDINGS.map((b) =>
        buildingIds && !buildingIds.includes(b.id) ? null : (
          <CuboidCollider
            key={b.id}
            args={[b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]}
            position={[b.position[0], b.size[1] / 2, b.position[1]]}
          />
        ),
      )}

      {/* Food truck + job kiosk */}
      <CuboidCollider
        args={[2.6, 1.2, 1.3]}
        position={[FOOD_TRUCK.position[0] - 0.4, 1.2, FOOD_TRUCK.position[1]]}
      />
      <CuboidCollider
        args={[0.3, 1.2, 0.9]}
        position={[JOB_KIOSK.position[0], 1.2, JOB_KIOSK.position[1]]}
      />

      {/* The pond: water is solid for walking — a low curb-height cylinder
          keeps the player (and their car) out of it. */}
      <CylinderCollider
        args={[0.4, PARK.pond.radius + 0.55]}
        position={[PARK.pond.center[0], 0.4, PARK.pond.center[1]]}
      />

      {/* Solid props — footprints come from the single PROP_SOLIDITY table
          (shared with the world-occupancy validator), so physics and
          placement rules can never drift apart. */}
      {PROPS.map((p) => {
        if (propIds && !propIds.includes(p.id)) return null
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
    </RigidBody>
  )
}
