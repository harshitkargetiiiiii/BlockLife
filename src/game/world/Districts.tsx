import {
  CONNECTORS,
  INDUSTRIAL,
  INDUSTRIAL_NORTH,
  RESIDENTIAL,
  RESIDENTIAL_SOUTH,
  RESIDENTIAL_WEST,
} from './cityLayout'
import { roadMaterial, sidewalkMaterial } from './materials'
import { Occludable } from '../visibility/Occludable'
import { getLinkedOccluderDescriptor } from '../visibility/occluderData'
import { isGlbBodyRendering } from '../assets/modelRegistry'
import { useGameStore } from '../store/useGameStore'

const MARKING_COLOR = '#e8e4da'
const DASH_COLOR = '#d8c46a'
const CONCRETE_COLOR = '#9b9b96'
const LOADING_COLOR = '#e0b53d'

function RoadPlane({
  x,
  z,
  w,
  d,
}: {
  x: number
  z: number
  w: number
  d: number
}) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[x, 0.02, z]} material={roadMaterial} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  )
}

function Sidewalk({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  return (
    <mesh position={[x, 0.06, z]} material={sidewalkMaterial} receiveShadow castShadow>
      <boxGeometry args={[w, 0.12, d]} />
    </mesh>
  )
}

function Dashes({
  horizontal,
  coord,
  from,
  to,
}: {
  horizontal: boolean
  coord: number
  from: number
  to: number
}) {
  const dashes: number[] = []
  for (let v = from; v <= to; v += 3) dashes.push(v)
  return (
    <>
      {dashes.map((v) => (
        <mesh
          key={v}
          rotation-x={-Math.PI / 2}
          position={horizontal ? [v, 0.03, coord] : [coord, 0.03, v]}
        >
          <planeGeometry args={horizontal ? [1.2, 0.14] : [0.14, 1.2]} />
          <meshStandardMaterial color={DASH_COLOR} />
        </mesh>
      ))}
    </>
  )
}

function CrosswalkStripes({
  x,
  z,
  across,
  span,
}: {
  x: number
  z: number
  across: 'x' | 'z'
  span: number
}) {
  const stripes = [-2.55, -1.7, -0.85, 0, 0.85, 1.7, 2.55].filter(
    (o) => Math.abs(o) <= span / 2,
  )
  return (
    <group name="district-crosswalk">
      {stripes.map((o) => (
        <mesh
          key={o}
          rotation-x={-Math.PI / 2}
          position={across === 'z' ? [x, 0.035, z + o] : [x + o, 0.035, z]}
        >
          <planeGeometry args={across === 'z' ? [2.6, 0.5] : [0.5, 2.6]} />
          <meshStandardMaterial color={MARKING_COLOR} />
        </mesh>
      ))}
    </group>
  )
}

function StopBar({ x, z, horizontal }: { x: number; z: number; horizontal: boolean }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[x, 0.034, z]}>
      <planeGeometry args={horizontal ? [0.5, 2.6] : [2.6, 0.5]} />
      <meshStandardMaterial color={MARKING_COLOR} />
    </mesh>
  )
}

/**
 * City Expansion v1 static visuals: the Residential Street (north), the
 * Industrial / Market Strip (east), the connector roads joining them to the
 * central ring, and background filler. Buildings and props for the new
 * districts flow through the existing data-driven Buildings/Props/colliders.
 */
export function Districts() {
  const r = RESIDENTIAL
  const i = INDUSTRIAL
  const cn = CONNECTORS.north
  const ce = CONNECTORS.east
  const rMidX = (r.roadMinX + r.roadMaxX) / 2
  const rLen = r.roadMaxX - r.roadMinX
  const iMidZ = (i.roadMinZ + i.roadMaxZ) / 2
  const iLen = i.roadMaxZ - i.roadMinZ

  return (
    <group name="districts">
      {/* ---- Residential Street ---- */}
      <group name="district-residential">
        <RoadPlane x={rMidX} z={r.roadCenterZ} w={rLen} d={r.roadHalfWidth * 2} />
        <Dashes horizontal coord={r.roadCenterZ} from={-16} to={-8} />
        <Dashes horizontal coord={r.roadCenterZ} from={4} to={26} />
        {/* Extension toward the industrial arterial (City Expansion v2) */}
        <Dashes horizontal coord={r.roadCenterZ} from={32} to={41} />
        {/* Sidewalks both sides */}
        <Sidewalk x={rMidX} z={-50} w={rLen} d={2} />
        <Sidewalk x={rMidX} z={-40} w={rLen} d={2} />
        {/* Front lawns + back fence span the housing LOTS only — the road
            continues east to the freight junction without garden dressing. */}
        <mesh
          rotation-x={-Math.PI / 2}
          position={[(r.roadMinX + r.lotMaxX) / 2, 0.04, -54.5]}
          receiveShadow
        >
          <planeGeometry args={[r.lotMaxX - r.roadMinX, 7]} />
          <meshStandardMaterial color="#8cc084" />
        </mesh>
        <mesh position={[(r.roadMinX + r.lotMaxX) / 2, 0.5, -58]} castShadow>
          <boxGeometry args={[r.lotMaxX - r.roadMinX, 1, 0.18]} />
          <meshStandardMaterial color="#e8e2d4" />
        </mesh>
        {/* Stop-sign crossing */}
        <CrosswalkStripes x={r.crosswalkX} z={r.roadCenterZ} across="z" span={6} />
        <StopBar x={-5.6} z={-46.4} horizontal />
        <StopBar x={1.6} z={-43.6} horizontal />
        {/* Curb parking markings on the south side */}
        {[-10, 20].map((x) => (
          <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.032, -41.7]}>
            <planeGeometry args={[5.2, 0.14]} />
            <meshStandardMaterial color={MARKING_COLOR} />
          </mesh>
        ))}
      </group>

      {/* ---- North connector ---- */}
      <group name="district-connector-north">
        <RoadPlane
          x={cn.centerX}
          z={(cn.fromZ + cn.toZ) / 2}
          w={cn.halfWidth * 2}
          d={cn.fromZ < cn.toZ ? cn.toZ - cn.fromZ : cn.fromZ - cn.toZ}
        />
        <Dashes horizontal={false} coord={cn.centerX} from={-40} to={-32} />
        <Sidewalk x={8} z={-35.5} w={1.2} d={11} />
        <Sidewalk x={16} z={-35.5} w={1.2} d={11} />
      </group>

      {/* ---- Industrial / Market Strip ---- */}
      <group name="district-industrial">
        <RoadPlane x={i.roadCenterX} z={iMidZ} w={i.roadHalfWidth * 2} d={iLen} />
        <Dashes horizontal={false} coord={i.roadCenterX} from={-12} to={6} />
        <Dashes horizontal={false} coord={i.roadCenterX} from={16} to={22} />
        {/* West sidewalk split around the connector mouth */}
        <Sidewalk x={43} z={-7} w={2} d={18} />
        <Sidewalk x={43} z={18.5} w={2} d={15} />
        {/* East concrete apron: forecourt for warehouse + garage */}
        <mesh rotation-x={-Math.PI / 2} position={[54.5, 0.045, 5]} receiveShadow>
          <planeGeometry args={[5, 42]} />
          <meshStandardMaterial color={CONCRETE_COLOR} />
        </mesh>
        {/* Loading zone: yellow diagonal bay stripes by the warehouse */}
        <group name="loading-zone">
          {[-10, -8, -6, -4, -2].map((z) => (
            <mesh
              key={z}
              rotation-x={-Math.PI / 2}
              rotation-z={Math.PI / 5}
              position={[53.6, 0.05, z]}
            >
              <planeGeometry args={[3.4, 0.3]} />
              <meshStandardMaterial color={LOADING_COLOR} />
            </mesh>
          ))}
          <mesh rotation-x={-Math.PI / 2} position={[53.6, 0.049, -6]}>
            <planeGeometry args={[0.24, 10.4]} />
            <meshStandardMaterial color={LOADING_COLOR} />
          </mesh>
        </group>
        {/* Market curb spaces */}
        {[13.5, 17, 20.5].map((z) => (
          <mesh key={z} rotation-x={-Math.PI / 2} position={[43.2, 0.065, z]}>
            <planeGeometry args={[1.8, 0.14]} />
            <meshStandardMaterial color={MARKING_COLOR} />
          </mesh>
        ))}
        {/* Signalled crossing */}
        <CrosswalkStripes x={i.roadCenterX} z={i.crosswalkZ} across="x" span={7.6} />
        <StopBar x={50} z={8.4} horizontal={false} />
        <StopBar x={46} z={15.6} horizontal={false} />
      </group>

      {/* ---- East connector ---- */}
      <group name="district-connector-east">
        <RoadPlane
          x={(ce.fromX + ce.toX) / 2}
          z={ce.centerZ}
          w={ce.toX - ce.fromX}
          d={ce.halfWidth * 2}
        />
        <Dashes horizontal coord={ce.centerZ} from={33} to={41} />
        <Sidewalk x={36.5} z={2} w={15} d={1.2} />
        <Sidewalk x={36.5} z={10} w={15} d={1.2} />
      </group>

      {/* ---- Residential West (City Expansion v2) ---- */}
      <group name="district-residential-west">
        <RoadPlane
          x={RESIDENTIAL_WEST.roadCenterX}
          z={(RESIDENTIAL_WEST.roadMinZ + RESIDENTIAL_WEST.roadMaxZ) / 2}
          w={RESIDENTIAL_WEST.roadHalfWidth * 2}
          d={RESIDENTIAL_WEST.roadMaxZ - RESIDENTIAL_WEST.roadMinZ}
        />
        <Dashes horizontal={false} coord={RESIDENTIAL_WEST.roadCenterX} from={-18} to={-12} />
        <Dashes horizontal={false} coord={RESIDENTIAL_WEST.roadCenterX} from={-2} to={16} />
        {/* West sidewalk full length; east sidewalk splits around the connector mouth */}
        <Sidewalk x={-52} z={0} w={2} d={40} />
        <Sidewalk x={-44} z={-8.5} w={2} d={23} />
        <Sidewalk x={-44} z={14.5} w={2} d={11} />
        {/* Front lawns + back fences on both sides */}
        <mesh rotation-x={-Math.PI / 2} position={[-57, 0.04, 0]} receiveShadow>
          <planeGeometry args={[8, 40]} />
          <meshStandardMaterial color="#8cc084" />
        </mesh>
        <mesh position={[-61.2, 0.5, 0]} castShadow>
          <boxGeometry args={[0.18, 1, 40]} />
          <meshStandardMaterial color="#e8e2d4" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[-40, 0.04, 0]} receiveShadow>
          <planeGeometry args={[6, 40]} />
          <meshStandardMaterial color="#8cc084" />
        </mesh>
        <CrosswalkStripes
          x={RESIDENTIAL_WEST.roadCenterX}
          z={RESIDENTIAL_WEST.crosswalkZ}
          across="x"
          span={5.6}
        />
      </group>

      {/* ---- West connector ---- */}
      <group name="district-connector-west">
        <RoadPlane
          x={(CONNECTORS.west.fromX + CONNECTORS.west.toX) / 2}
          z={CONNECTORS.west.centerZ}
          w={CONNECTORS.west.toX - CONNECTORS.west.fromX}
          d={CONNECTORS.west.halfWidth * 2}
        />
        <Dashes horizontal coord={CONNECTORS.west.centerZ} from={-41} to={-33} />
        <Sidewalk x={-37} z={2} w={14} d={1.2} />
        <Sidewalk x={-37} z={10} w={14} d={1.2} />
      </group>

      {/* ---- Residential South (City Expansion v2) ---- */}
      <group name="district-residential-south">
        <RoadPlane
          x={(RESIDENTIAL_SOUTH.roadMinX + RESIDENTIAL_SOUTH.roadMaxX) / 2}
          z={RESIDENTIAL_SOUTH.roadCenterZ}
          w={RESIDENTIAL_SOUTH.roadMaxX - RESIDENTIAL_SOUTH.roadMinX}
          d={RESIDENTIAL_SOUTH.roadHalfWidth * 2}
        />
        <Dashes horizontal coord={RESIDENTIAL_SOUTH.roadCenterZ} from={-18} to={2} />
        <Dashes horizontal coord={RESIDENTIAL_SOUTH.roadCenterZ} from={10} to={18} />
        {/* South sidewalk full length; north sidewalk splits around the connector */}
        <Sidewalk x={0} z={52} w={40} d={2} />
        <Sidewalk x={-17.5} z={44} w={5} d={2} />
        <Sidewalk x={5.5} z={44} w={29} d={2} />
        {/* Lawns + back fence */}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, 40.5]} receiveShadow>
          <planeGeometry args={[40, 5]} />
          <meshStandardMaterial color="#8cc084" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, 56.5]} receiveShadow>
          <planeGeometry args={[40, 7]} />
          <meshStandardMaterial color="#8cc084" />
        </mesh>
        <mesh position={[0, 0.5, 60.2]} castShadow>
          <boxGeometry args={[40, 1, 0.18]} />
          <meshStandardMaterial color="#e8e2d4" />
        </mesh>
        <CrosswalkStripes
          x={RESIDENTIAL_SOUTH.crosswalkX}
          z={RESIDENTIAL_SOUTH.roadCenterZ}
          across="z"
          span={5.6}
        />
      </group>

      {/* ---- South connector ---- */}
      <group name="district-connector-south">
        <RoadPlane
          x={CONNECTORS.south.centerX}
          z={(CONNECTORS.south.fromZ + CONNECTORS.south.toZ) / 2}
          w={CONNECTORS.south.halfWidth * 2}
          d={CONNECTORS.south.toZ - CONNECTORS.south.fromZ}
        />
        <Dashes horizontal={false} coord={CONNECTORS.south.centerX} from={33} to={41} />
        <Sidewalk x={-16} z={37} w={1.2} d={12} />
        <Sidewalk x={-8} z={37} w={1.2} d={12} />
      </group>

      {/* ---- Industrial North (City Expansion v2): arterial extension ---- */}
      <group name="district-industrial-north">
        <RoadPlane
          x={INDUSTRIAL_NORTH.roadCenterX}
          z={(INDUSTRIAL_NORTH.roadMinZ + INDUSTRIAL_NORTH.roadMaxZ) / 2}
          w={INDUSTRIAL_NORTH.roadHalfWidth * 2}
          d={INDUSTRIAL_NORTH.roadMaxZ - INDUSTRIAL_NORTH.roadMinZ}
        />
        <Dashes horizontal={false} coord={INDUSTRIAL_NORTH.roadCenterX} from={-50} to={-40} />
        <Dashes horizontal={false} coord={INDUSTRIAL_NORTH.roadCenterX} from={-36} to={-20} />
        {/* East concrete apron for the freight warehouses */}
        <mesh rotation-x={-Math.PI / 2} position={[54.5, 0.045, -35]} receiveShadow>
          <planeGeometry args={[5, 34]} />
          <meshStandardMaterial color={CONCRETE_COLOR} />
        </mesh>
        {/* West sidewalk, split at the residential street junction (z −45) */}
        <Sidewalk x={43} z={-29} w={2} d={18} />
        <Sidewalk x={43} z={-50.5} w={2} d={3} />
      </group>

      <CityDressing />
    </group>
  )
}

// Shared dressing materials — one each for the whole city.
const patchMaterial = { color: '#2b2a31' }
const seamColor = '#c2bcb0'
const rampColor = '#d8d3c8'

const ROAD_PATCHES: [number, number, number, number, number][] = [
  // [x, z, w, d, rotation]
  [-8, -26.8, 2.6, 1.6, 0.1],
  [26.4, 14, 1.8, 2.4, -0.15],
  [12, -33, 2.2, 1.8, 0.2],
  [6, -44.3, 2.4, 1.5, -0.1],
  [47.2, -4, 2.8, 2, 0.12],
]

/** Curb ramps: light pads at each crosswalk end. */
const CURB_RAMPS: [number, number][] = [
  [0, -22.6],
  [0, -29.4],
  [-22.6, 0],
  [-29.4, 0],
  [-2, -41.4],
  [-2, -48.6],
  [43.6, 12],
  [52.4, 12],
]

/** Plaza seam grid lines (subtle pavement texture). */
const PLAZA_SEAMS = [-14, -7, 0, 7, 14]

/**
 * City Life Density v1 dressing: pavement texture, entrance decals for the
 * big industrial faces, and edge scenery so the world reads as continuing
 * past the walls. Purely decorative — no colliders, no interactions.
 */
function CityDressing() {
  // Issue #44 Codex review: the garage's painted rolling door must follow the ACTUAL render
  // branch, so this subscribes to the counter `markGlbBranch` bumps when a GLB commits or
  // fails. Reading the registry alone would never re-render — it is a module singleton.
  useGameStore((st) => st.assetLoadVersion)
  const garageGlbRendering = isGlbBodyRendering('building_garage_01')
  return (
    <group name="city-dressing">
      {/* Road patches: repaired asphalt rectangles */}
      {ROAD_PATCHES.map(([x, z, w, d, rot], i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} rotation-z={rot} position={[x, 0.025, z]}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color={patchMaterial.color} />
        </mesh>
      ))}

      {/* Plaza pavement seams */}
      <group name="plaza-seams">
        {PLAZA_SEAMS.map((v) => (
          <group key={v}>
            <mesh rotation-x={-Math.PI / 2} position={[v, 0.028, 0]}>
              <planeGeometry args={[0.09, 42]} />
              <meshStandardMaterial color={seamColor} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.028, v]}>
              <planeGeometry args={[42, 0.09]} />
              <meshStandardMaterial color={seamColor} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Curb ramps at every crossing */}
      {CURB_RAMPS.map(([x, z], i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.13, z]}>
          <planeGeometry args={[1.8, 1.1]} />
          <meshStandardMaterial color={rampColor} />
        </mesh>
      ))}

      {/* Warehouse shutter + garage rolling-door decals — on the south faces
          so the fixed SE camera actually sees them. Each decal group is a
          LINKED occludable: it mirrors its building's occlusion fade so the
          shutter never floats over a faded warehouse. */}
      <group name="door-decals">
        <Occludable
          descriptor={getLinkedOccluderDescriptor(
            'decals_warehouse_01',
            'building_warehouse_01',
          )}
        >
          <mesh position={[60, 2, -1.44]}>
            <planeGeometry args={[6, 3.6]} />
            <meshStandardMaterial color="#6a7078" />
          </mesh>
          {[0.8, 1.6, 2.4, 3.2].map((y) => (
            <mesh key={y} position={[60, y, -1.42]}>
              <planeGeometry args={[5.6, 0.09]} />
              <meshStandardMaterial color="#565c64" />
            </mesh>
          ))}
        </Occludable>
        {/* Issue #44 Wave 3: the approved repair-garage body carries its OWN pair of roller
            shutters, yawed onto the authored west door, and the −π/2 yaw puts its third
            shutter on this same south wall — so this painted stand-in would be a second,
            contradictory door drawn over a real one.
            
            It keys off the ACTUAL render branch, not the manifest (issue #44 Codex review):
            a registered, enabled GLB still shows the procedural garage when the file is
            missing or corrupt, and that box needs its door back. `assetLoadVersion` is what
            re-renders this group when the branch flips. Exactly one door, either way. */}
        {!garageGlbRendering && (
          <Occludable
            descriptor={getLinkedOccluderDescriptor('decals_garage_01', 'building_garage_01')}
          >
            <mesh position={[59.5, 1.7, 11.56]}>
              <planeGeometry args={[4.2, 3]} />
              <meshStandardMaterial color="#57616e" />
            </mesh>
            {[0.7, 1.4, 2.1, 2.8].map((y) => (
              <mesh key={y} position={[59.5, y, 11.58]}>
                <planeGeometry args={[3.8, 0.09]} />
                <meshStandardMaterial color="#46505c" />
              </mesh>
            ))}
          </Occludable>
        )}
        {/* Gym poster next to its door — sits on the GLB's recessed wall
            plane, same depth convention as the window overlays. */}
        <Occludable
          descriptor={getLinkedOccluderDescriptor('decals_gym_01', 'building_gym_01')}
        >
          <mesh position={[16.8, 2.1, -11.0]}>
            <planeGeometry args={[1.2, 1.7]} />
            <meshStandardMaterial color="#ffd166" />
          </mesh>
          <mesh position={[16.8, 1.75, -10.98]}>
            <planeGeometry args={[0.9, 0.55]} />
            <meshStandardMaterial color="#e0684b" />
          </mesh>
        </Occludable>
      </group>

      {/* ---- Edge dressing: the city continues past the walls ---- */}
      <group name="edge-dressing">
        {/* Billboard east of the strip */}
        <group position={[70, 0, -2]} rotation-y={-Math.PI / 2}>
          {[-2.2, 2.2].map((x) => (
            <mesh key={x} position={[x, 2.6, 0]}>
              <cylinderGeometry args={[0.14, 0.16, 5.2, 8]} />
              <meshStandardMaterial color="#3c4048" />
            </mesh>
          ))}
          <mesh position={[0, 4.6, 0]} castShadow>
            <boxGeometry args={[6.4, 2.8, 0.2]} />
            <meshStandardMaterial color="#f2e3c6" />
          </mesh>
          <mesh position={[0, 4.9, 0.12]}>
            <planeGeometry args={[5.6, 1.2]} />
            <meshStandardMaterial color="#e07a5f" />
          </mesh>
          <mesh position={[-1.4, 4, 0.12]}>
            <planeGeometry args={[2.6, 0.5]} />
            <meshStandardMaterial color="#5f9ea0" />
          </mesh>
        </group>

        {/* Hedges along the south + west margins */}
        {[-24, -8, 8, 24].map((x) => (
          <mesh key={`hs${x}`} position={[x, 0.55, 32.6]} castShadow>
            <boxGeometry args={[10, 1.1, 1.2]} />
            <meshStandardMaterial color="#5e8e4e" roughness={1} />
          </mesh>
        ))}
        {[-22, -6, 12].map((z) => (
          <mesh key={`hw${z}`} position={[-32.6, 0.55, z]} castShadow>
            <boxGeometry args={[1.2, 1.1, 10]} />
            <meshStandardMaterial color="#5e8e4e" roughness={1} />
          </mesh>
        ))}

        {/* Utility poles behind the residential fence */}
        {[-12, 4, 22].map((x) => (
          <group key={`up${x}`} position={[x, 0, -59.4]}>
            <mesh position={[0, 2.6, 0]}>
              <cylinderGeometry args={[0.09, 0.12, 5.2, 6]} />
              <meshStandardMaterial color="#6a533c" />
            </mesh>
            <mesh position={[0, 4.6, 0]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.06, 0.06, 1.8, 6]} />
              <meshStandardMaterial color="#6a533c" />
            </mesh>
          </group>
        ))}

        {/* Road continuation stubs: the district streets read as through
            roads instead of dead-ending into grass. */}
        <mesh rotation-x={-Math.PI / 2} position={[-26.5, 0.02, -45]}>
          <planeGeometry args={[13, 6]} />
          <meshStandardMaterial color="#33323a" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[35, 0.02, -45]}>
          <planeGeometry args={[10, 6]} />
          <meshStandardMaterial color="#33323a" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[48, 0.02, -20]}>
          <planeGeometry args={[8, 8]} />
          <meshStandardMaterial color="#33323a" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[48, 0.02, 30]}>
          <planeGeometry args={[8, 8]} />
          <meshStandardMaterial color="#33323a" />
        </mesh>
      </group>
    </group>
  )
}
