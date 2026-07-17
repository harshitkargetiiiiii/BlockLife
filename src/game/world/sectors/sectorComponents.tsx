import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { CityBlock } from '../CityBlock'
import { CityColliders } from '../CityColliders'
import { Buildings } from '../Buildings'
import { BUILDINGS } from '../cityLayout'
import { getOwnedIds } from './sectorContent'
import { registerSectorComponents } from './SectorManager'
import { GatewaySectorColliders, GatewaySectorVisuals } from '../gateway/GatewaySector'
import {
  CompiledSectorColliders,
  CompiledSectorVisuals,
} from '../authoring/CompiledSector'
import { COMPILED_SECTORS } from '../authoring/compiledSectors'

/**
 * Sector id → visual/collider component registrations. Importing this
 * module (from CanvasRoot) wires the whole authored world.
 *
 * Authoring contract for a NEW sector: build a Visuals component (meshes
 * only) and a Colliders component (cuboids inside one fixed RigidBody),
 * then register them here against the sector's grid id.
 */

const CENTRAL_BUILDINGS = getOwnedIds('s0_0', 'building')
const WEST_SHELF_BUILDINGS = getOwnedIds('s-1_0', 'building')
const EAST_SHELF_BUILDINGS = getOwnedIds('s1_0', 'building')

/** Backdrop shelf: distant towers only — no props, no gameplay. */
function ShelfVisuals({ ids }: { ids: readonly string[] }) {
  return <Buildings only={ids} />
}

function ShelfColliders({ ids }: { ids: readonly string[] }) {
  return (
    <RigidBody type="fixed" colliders={false}>
      {BUILDINGS.filter((b) => ids.includes(b.id)).map((b) => (
        <CuboidCollider
          key={b.id}
          args={[b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]}
          position={[b.position[0], b.size[1] / 2, b.position[1]]}
        />
      ))}
    </RigidBody>
  )
}

registerSectorComponents('s0_0', {
  Visuals: function CentralVisuals() {
    return <CityBlock buildingIds={CENTRAL_BUILDINGS} />
  },
  Colliders: function CentralColliders() {
    return <CityColliders buildingIds={CENTRAL_BUILDINGS} />
  },
})

registerSectorComponents('s-1_0', {
  Visuals: function WestShelfVisuals() {
    return <ShelfVisuals ids={WEST_SHELF_BUILDINGS} />
  },
  Colliders: function WestShelfColliders() {
    return <ShelfColliders ids={WEST_SHELF_BUILDINGS} />
  },
})

registerSectorComponents('s1_0', {
  Visuals: function EastShelfVisuals() {
    return <ShelfVisuals ids={EAST_SHELF_BUILDINGS} />
  },
  Colliders: function EastShelfColliders() {
    return <ShelfColliders ids={EAST_SHELF_BUILDINGS} />
  },
})

registerSectorComponents('s0_-1', {
  Visuals: GatewaySectorVisuals,
  Colliders: GatewaySectorColliders,
})

// Kit-compiled sectors: the generic renderer needs zero bespoke scene code
// per sector. Registering here is the ONLY per-sector wiring beyond the
// registry entry — everything else flows from COMPILED_SECTORS.
for (const compiled of COMPILED_SECTORS) {
  registerSectorComponents(compiled.sectorId, {
    Visuals: function CompiledVisuals() {
      return <CompiledSectorVisuals compiled={compiled} />
    },
    Colliders: function CompiledColliders() {
      return <CompiledSectorColliders compiled={compiled} />
    },
  })
}
