import { ROAD_CENTER, ROAD_HALF_WIDTH } from './cityLayout'
import { roadMaterial, sidewalkMaterial } from './materials'

const MARKING_COLOR = '#e8e4da'
const GUTTER_COLOR = '#26252c'

const R = ROAD_CENTER
const W = ROAD_HALF_WIDTH * 2

// Gutters hug both edges of each road strip (relative to the centerline).
// (Manholes/drains are GLB street props now — see PROPS in cityLayout.)
const GUTTER_OFFSETS = [-(ROAD_HALF_WIDTH - 0.25), ROAD_HALF_WIDTH - 0.25]

function LaneDashes({ horizontal, coord }: { horizontal: boolean; coord: number }) {
  const dashes: number[] = []
  for (let v = -20; v <= 20; v += 3) dashes.push(v)
  return (
    <>
      {dashes.map((v) => (
        <mesh
          key={v}
          rotation-x={-Math.PI / 2}
          position={horizontal ? [v, 0.03, coord] : [coord, 0.03, v]}
        >
          <planeGeometry args={horizontal ? [1.2, 0.14] : [0.14, 1.2]} />
          <meshStandardMaterial color="#d8c46a" />
        </mesh>
      ))}
    </>
  )
}

function Crosswalk({ x, z, across }: { x: number; z: number; across: 'x' | 'z' }) {
  const stripes = [-2.55, -1.7, -0.85, 0, 0.85, 1.7, 2.55]
  return (
    <group name="crosswalk">
      {stripes.map((o) => (
        <mesh
          key={o}
          rotation-x={-Math.PI / 2}
          position={across === 'z' ? [x, 0.035, z + o] : [x + o, 0.035, z]}
        >
          <planeGeometry args={across === 'z' ? [2.8, 0.5] : [0.5, 2.8]} />
          <meshStandardMaterial color={MARKING_COLOR} />
        </mesh>
      ))}
    </group>
  )
}

function SidewalkRing({
  inner,
  outer,
  y = 0.06,
  northGap,
  eastGap,
}: {
  inner: number
  outer: number
  y?: number
  /** [min, max] span (in x) left open in the north strip — a road mouth. */
  northGap?: [number, number]
  /** [min, max] span (in z) left open in the east strip — a road mouth. */
  eastGap?: [number, number]
}) {
  const mid = (inner + outer) / 2
  const width = outer - inner

  const northSegments: [number, number][] = northGap
    ? [
        [-outer, northGap[0]],
        [northGap[1], outer],
      ]
    : [[-outer, outer]]
  const eastSegments: [number, number][] = eastGap
    ? [
        [-inner, eastGap[0]],
        [eastGap[1], inner],
      ]
    : [[-inner, inner]]

  return (
    <>
      {/* North strip (segmented around connector mouths) & south strip */}
      {northSegments.map(([from, to], i) => (
        <mesh key={`n${i}`} position={[(from + to) / 2, y, -mid]} material={sidewalkMaterial} receiveShadow castShadow>
          <boxGeometry args={[to - from, 0.12, width]} />
        </mesh>
      ))}
      <mesh position={[0, y, mid]} material={sidewalkMaterial} receiveShadow castShadow>
        <boxGeometry args={[outer * 2, 0.12, width]} />
      </mesh>
      {/* East strip (segmented) & west strip */}
      {eastSegments.map(([from, to], i) => (
        <mesh key={`e${i}`} position={[mid, y, (from + to) / 2]} material={sidewalkMaterial} receiveShadow castShadow>
          <boxGeometry args={[width, 0.12, to - from]} />
        </mesh>
      ))}
      <mesh position={[-mid, y, 0]} material={sidewalkMaterial} receiveShadow castShadow>
        <boxGeometry args={[width, 0.12, inner * 2]} />
      </mesh>
    </>
  )
}

/** The ring road with lane dashes, two crosswalks, and inner + outer sidewalks. */
export function Roads() {
  return (
    <group name="roads">
      {/* Horizontal road strips (north / south) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, -R]} material={roadMaterial} receiveShadow>
        <planeGeometry args={[(R + ROAD_HALF_WIDTH) * 2, W]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, R]} material={roadMaterial} receiveShadow>
        <planeGeometry args={[(R + ROAD_HALF_WIDTH) * 2, W]} />
      </mesh>
      {/* Vertical road strips (east / west) between them */}
      <mesh rotation-x={-Math.PI / 2} position={[-R, 0.02, 0]} material={roadMaterial} receiveShadow>
        <planeGeometry args={[W, (R - ROAD_HALF_WIDTH) * 2]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[R, 0.02, 0]} material={roadMaterial} receiveShadow>
        <planeGeometry args={[W, (R - ROAD_HALF_WIDTH) * 2]} />
      </mesh>

      <LaneDashes horizontal coord={-R} />
      <LaneDashes horizontal coord={R} />
      <LaneDashes horizontal={false} coord={-R} />
      <LaneDashes horizontal={false} coord={R} />

      {/* Darker gutter lines along the straight road edges sharpen the
          silhouette; like real markings they break at the intersections. */}
      {GUTTER_OFFSETS.map((edge) =>
        [-R, R].map((side) => (
          <group key={`${edge}-${side}`}>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.026, side + edge]}>
              <planeGeometry args={[(R - ROAD_HALF_WIDTH) * 2, 0.26]} />
              <meshStandardMaterial color={GUTTER_COLOR} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[side + edge, 0.026, 0]}>
              <planeGeometry args={[0.26, (R - ROAD_HALF_WIDTH) * 2]} />
              <meshStandardMaterial color={GUTTER_COLOR} />
            </mesh>
          </group>
        )),
      )}

      <Crosswalk x={0} z={-R} across="z" />
      <Crosswalk x={-R} z={0} across="x" />

      <SidewalkRing inner={21} outer={23} />
      {/* Outer ring: gaps where the district connector roads join. */}
      <SidewalkRing inner={29} outer={31} northGap={[9, 15]} eastGap={[3, 9]} />
    </group>
  )
}
