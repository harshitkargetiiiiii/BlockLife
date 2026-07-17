import type { Vec2 } from '../../world/worldTypes'
import type { SectorId } from '../../world/sectors/worldGrid'
import { BUILDINGS, PROPS, getRoadRects } from '../../world/cityLayout'
import { COMPILED_SECTORS } from '../../world/authoring/compiledSectors'
import { INTERSECTIONS } from '../../traffic/intersections/intersectionRegistry'
import { WALK_CROSSINGS } from '../../traffic/walkCrossings'
import { createRng, hashString } from '../../traffic/routing/routeRng'
import { collectSolidFootprints } from '../../world/solidFootprints'

/**
 * Crossing-Aware Citizen Destinations v1.
 *
 * One lightweight, always-loaded pedestrian graph assembled from EXISTING
 * authored data: sidewalk corridors (connector nodes on compiled sidewalk
 * bands), signalized-crossing curb anchors, and destination anchors derived
 * from authored buildings/props/water — no coordinates duplicated where a
 * source object exists. Compiled once at module load; routing runs only on
 * (re)planning, never per frame.
 */

export type DestinationKind =
  | 'shop'
  | 'cafe'
  | 'bench'
  | 'park'
  | 'waterfront'
  | 'workplace'
  | 'home'
  | 'plaza'

export type ArrivalBehavior = 'idle' | 'sit' | 'queue' | 'visit' | 'work'

export interface CitizenDestination {
  id: string
  sectorId: SectorId
  kind: DestinationKind
  position: Vec2
  arrivalBehavior: ArrivalBehavior
  capacity: number
  /** Open interval [from, to) in game hours; omitted = always open. */
  activeHours?: [number, number]
  weatherPolicy: 'all' | 'avoid_rain' | 'indoor_preferred'
  /** Facing while performing the activity (radians), if it matters. */
  arrivalHeading?: number
  /** Authoring provenance: the object this anchor was derived from. */
  sourceRef: { sectorId: string; sourceId: string; derivation: string }
}

export interface PedestrianNode {
  id: string
  position: Vec2
  kind: 'connector' | 'crossing_curb' | 'destination'
}

export interface PedestrianEdge {
  id: string
  a: string
  b: string
  length: number
  /** Set when this edge IS a signalized crossing (road legally crossed). */
  crossingId?: string
}

export interface PedestrianRoutePlan {
  citizenId: string
  originId: string
  destinationId: string
  sidewalkPathIds: string[]
  crossingIds: string[]
  waypoints: Vec2[]
}

// ---------------------------------------------------------------------------
// Destinations, derived from authored objects (asserted at module load).
// ---------------------------------------------------------------------------

function building(id: string) {
  const b = BUILDINGS.find((x) => x.id === id)
  if (!b) throw new Error(`pedestrian destinations: unknown building ${id}`)
  return b
}

function prop(id: string) {
  const p = PROPS.find((x) => x.id === id)
  if (!p) throw new Error(`pedestrian destinations: unknown prop ${id}`)
  return p
}

/** Anchor 1.5u outside the door face of an authored building. */
function doorAnchor(b: ReturnType<typeof building>): Vec2 {
  const [hw, , hd] = [b.size[0] / 2, b.size[1], b.size[2] / 2]
  switch (b.door) {
    case 'north':
      return [b.position[0], b.position[1] - hd - 1.5]
    case 'south':
      return [b.position[0], b.position[1] + hd + 1.5]
    case 'east':
      return [b.position[0] + hw + 1.5, b.position[1]]
    case 'west':
      return [b.position[0] - hw - 1.5, b.position[1]]
    default:
      return [b.position[0], b.position[1] + hd + 1.5]
  }
}

function fromBuilding(
  id: string,
  sectorId: SectorId,
  kind: DestinationKind,
  arrivalBehavior: ArrivalBehavior,
  capacity: number,
  extras: Partial<CitizenDestination> = {},
): CitizenDestination {
  const b = building(id)
  return {
    id: `pdest_${id}`,
    sectorId,
    kind,
    position: doorAnchor(b),
    arrivalBehavior,
    capacity,
    weatherPolicy: 'all',
    sourceRef: { sectorId, sourceId: id, derivation: 'building door anchor' },
    ...extras,
  }
}

function fromBench(id: string, sectorId: SectorId): CitizenDestination {
  const p = prop(id)
  return {
    id: `pdest_${id}`,
    sectorId,
    kind: 'bench',
    // Sit just in front of the bench seat.
    position: [p.position[0], p.position[1] + 0.6],
    arrivalBehavior: 'sit',
    capacity: 1,
    weatherPolicy: 'avoid_rain',
    arrivalHeading: p.rotationY ?? 0,
    sourceRef: { sectorId, sourceId: id, derivation: 'bench prop anchor' },
  }
}

function waterfrontViewpoint(): CitizenDestination {
  const water = COMPILED_SECTORS.find((c) => c.sectorId === 's0_-2')!.waterRects[0]
  if (!water) throw new Error('pedestrian destinations: waterfront has no water rect')
  return {
    id: 'pdest_waterfront_view',
    sectorId: 's0_-2',
    kind: 'waterfront',
    // Two steps back from the water's promenade edge, centered.
    position: [(water.minX + water.maxX) / 2, water.maxZ + 2.5],
    arrivalBehavior: 'visit',
    capacity: 2,
    weatherPolicy: 'avoid_rain',
    arrivalHeading: Math.PI, // face the water (south edge of the map is -z)
    sourceRef: { sectorId: 's0_-2', sourceId: water.id, derivation: 'water rect north edge' },
  }
}

export const CITIZEN_DESTINATIONS: CitizenDestination[] = [
  fromBuilding('s0_-2_cafe', 's0_-2', 'cafe', 'queue', 3, {
    activeHours: [7, 21],
    weatherPolicy: 'indoor_preferred',
  }),
  fromBuilding('s0_-2_shop', 's0_-2', 'shop', 'queue', 3, {
    activeHours: [8, 21],
    weatherPolicy: 'indoor_preferred',
  }),
  fromBuilding('s1_-2_s1', 's1_-2', 'shop', 'queue', 3, {
    activeHours: [8, 21],
    weatherPolicy: 'indoor_preferred',
  }),
  fromBuilding('s-1_-2_w1', 's-1_-2', 'workplace', 'work', 2),
  fromBuilding('s-1_-2_w2', 's-1_-2', 'workplace', 'work', 2),
  fromBench('prop_bench_g1', 's0_-1'),
  fromBench('s0_-2_promenade_4', 's0_-2'),
  waterfrontViewpoint(),
  {
    id: 'pdest_gateway_plaza',
    sectorId: 's0_-1',
    kind: 'plaza',
    position: [62, -88],
    arrivalBehavior: 'idle',
    capacity: 4,
    weatherPolicy: 'all',
    sourceRef: { sectorId: 's0_-1', sourceId: 'gateway_plaza', derivation: 'plaza center' },
  },
]

export const DESTINATIONS_BY_ID = new Map(CITIZEN_DESTINATIONS.map((d) => [d.id, d]))

/**
 * Per-citizen home destination, synthesized from the citizen's authored
 * spawn position (id: pdest_home_<citizenId>). Registered lazily by the
 * trip runtime so only migrated citizens get one.
 */
export function makeHomeDestination(citizenId: string, position: Vec2, sectorId: SectorId): CitizenDestination {
  return {
    id: `pdest_home_${citizenId}`,
    sectorId,
    kind: 'home',
    position: [...position] as Vec2,
    arrivalBehavior: 'idle',
    capacity: 1,
    weatherPolicy: 'all',
    sourceRef: { sectorId, sourceId: citizenId, derivation: 'citizen spawn position' },
  }
}

// ---------------------------------------------------------------------------
// The pedestrian graph: connector nodes on sidewalk bands + crossing curbs
// + destination anchors, with an AUTHORED adjacency list (reviewable) that
// is geometrically validated below.
// ---------------------------------------------------------------------------

/** Connector nodes sit mid-band on compiled sidewalk strips. */
const CONNECTORS: { id: string; position: Vec2 }[] = [
  // North Boulevard east sidewalk (x 52..55); the hotel corner detour
  // keeps the plaza leg off building_gate_hotel_01's footprint.
  { id: 'pn_gate_hotel_w', position: [55.5, -107] },
  { id: 'pn_blvd_e_gate', position: [53.5, -120] },
  { id: 'pn_blvd_e_terminus', position: [53.5, -228] },
  // West sidewalk (x 41..44).
  { id: 'pn_blvd_w_gate', position: [42.5, -120] },
  // Promenade mouth (west of the drive's painted crossing).
  { id: 'pn_prom_entry', position: [38, -299] },
  // North Avenue south sidewalk (z -298..-295) toward Main Street North.
  { id: 'pn_ave_s_mid', position: [72, -296.5] },
  // Harbor west arm north sidewalk (z -156..-153): shopper home street.
  { id: 'pn_harbor_w_walk', position: [10, -154.5] },
  // Industrial Yard warehouse-side sidewalk (z -237..-234).
  { id: 'pn_yard_s_mid', position: [-40, -235.5] },
]

/**
 * Authored adjacency (a, b) — validated for walkability at module load.
 * Roads are only ever traversed through crossing edges (generated from the
 * signalized intersection + the painted walk-crossings, never listed here).
 */
const CONNECTOR_EDGES: [string, string][] = [
  // Gateway plaza cluster → painted crossing over Main Street East.
  ['pdest_gateway_plaza', 'pdest_prop_bench_g1'],
  ['pdest_gateway_plaza', 'pwalk_s1_-1_main_st_plaza_walk_1'],
  ['pdest_prop_bench_g1', 'pwalk_s1_-1_main_st_plaza_walk_1'],
  ['pwalk_s1_-1_main_st_plaza_walk_0', 'pn_gate_hotel_w'],
  ['pn_gate_hotel_w', 'pn_blvd_e_gate'],
  // East spine: gateway → Harbor Cross SE corner → east-arm crossing →
  // NE corner → terminus → the drive's painted crossing → North Avenue.
  ['pn_blvd_e_gate', 'pcurb_s0_-2_harbor_cross_cross_south_1'],
  ['pcurb_s0_-2_harbor_cross_cross_south_1', 'pcurb_s0_-2_harbor_cross_cross_east_1'],
  ['pcurb_s0_-2_harbor_cross_cross_east_0', 'pcurb_s0_-2_harbor_cross_cross_north_1'],
  ['pcurb_s0_-2_harbor_cross_cross_north_1', 'pn_blvd_e_terminus'],
  ['pn_blvd_e_terminus', 'pwalk_s0_-2_drive_prom_walk_1'],
  ['pwalk_s0_-2_drive_prom_walk_1', 'pn_ave_s_mid'],
  ['pn_ave_s_mid', 'pdest_s1_-2_s1'],
  // West spine: gateway → Harbor Cross SW corner → west-arm crossing →
  // NW corner → the yard's painted crossing → warehouse row.
  ['pn_blvd_w_gate', 'pcurb_s0_-2_harbor_cross_cross_south_0'],
  ['pcurb_s0_-2_harbor_cross_cross_south_0', 'pcurb_s0_-2_harbor_cross_cross_west_1'],
  ['pcurb_s0_-2_harbor_cross_cross_west_0', 'pcurb_s0_-2_harbor_cross_cross_north_0'],
  ['pcurb_s0_-2_harbor_cross_cross_north_0', 'pwalk_s-1_-2_yard_rd_gate_walk_1'],
  ['pwalk_s-1_-2_yard_rd_gate_walk_0', 'pn_yard_s_mid'],
  ['pn_yard_s_mid', 'pdest_s-1_-2_w1'],
  ['pdest_s-1_-2_w1', 'pdest_s-1_-2_w2'],
  // Harbor west arm sidewalk: homes west of the box.
  ['pcurb_s0_-2_harbor_cross_cross_west_1', 'pn_harbor_w_walk'],
  // Promenade cluster west of the drive crossing.
  ['pwalk_s0_-2_drive_prom_walk_0', 'pn_prom_entry'],
  ['pn_prom_entry', 'pdest_s0_-2_cafe'],
  ['pn_prom_entry', 'pdest_s0_-2_shop'],
  ['pn_prom_entry', 'pdest_s0_-2_promenade_4'],
  ['pn_prom_entry', 'pdest_waterfront_view'],
  ['pdest_s0_-2_cafe', 'pdest_s0_-2_promenade_4'],
  ['pdest_s0_-2_shop', 'pdest_waterfront_view'],
]

export interface PedestrianGraph {
  nodes: Map<string, PedestrianNode>
  edges: PedestrianEdge[]
  adjacency: Map<string, { edge: PedestrianEdge; to: string }[]>
}

function buildGraph(): PedestrianGraph {
  const nodes = new Map<string, PedestrianNode>()
  for (const c of CONNECTORS) nodes.set(c.id, { id: c.id, position: c.position, kind: 'connector' })
  for (const d of CITIZEN_DESTINATIONS) {
    nodes.set(d.id, { id: d.id, position: d.position, kind: 'destination' })
  }
  // Crossing curb nodes + the crossing edges themselves (the only legal way
  // a route crosses a road): signalized intersection crossings AND painted
  // kit walk-crossings share the mechanism.
  const edges: PedestrianEdge[] = []
  const addCrossing = (prefix: string, id: string, waitSpots: readonly Vec2[]) => {
    const ids = waitSpots.map((spot, i) => {
      const nodeId = `${prefix}_${id}_${i}`
      nodes.set(nodeId, { id: nodeId, position: spot, kind: 'crossing_curb' })
      return nodeId
    })
    edges.push({
      id: `pe_${id}`,
      a: ids[0],
      b: ids[1],
      length: Math.hypot(waitSpots[1][0] - waitSpots[0][0], waitSpots[1][1] - waitSpots[0][1]),
      crossingId: id,
    })
  }
  for (const x of INTERSECTIONS) {
    for (const c of x.crossings) addCrossing('pcurb', c.id, c.waitSpots)
  }
  for (const c of WALK_CROSSINGS) addCrossing('pwalk', c.id, c.waitSpots)
  for (const [a, b] of CONNECTOR_EDGES) {
    const na = nodes.get(a)
    const nb = nodes.get(b)
    if (!na || !nb) throw new Error(`pedestrian graph: edge references unknown node ${a} / ${b}`)
    edges.push({
      id: `pe_${a}__${b}`,
      a,
      b,
      length: Math.hypot(nb.position[0] - na.position[0], nb.position[1] - na.position[1]),
    })
  }
  const adjacency = new Map<string, { edge: PedestrianEdge; to: string }[]>()
  for (const e of edges) {
    if (!adjacency.has(e.a)) adjacency.set(e.a, [])
    if (!adjacency.has(e.b)) adjacency.set(e.b, [])
    adjacency.get(e.a)!.push({ edge: e, to: e.b })
    adjacency.get(e.b)!.push({ edge: e, to: e.a })
  }
  return { nodes, edges, adjacency }
}

export const PEDESTRIAN_GRAPH: PedestrianGraph = buildGraph()

/** Register a synthesized home destination as a graph node + edge. */
export function registerHomeNode(dest: CitizenDestination, attachTo: string): void {
  if (PEDESTRIAN_GRAPH.nodes.has(dest.id)) return
  const anchor = PEDESTRIAN_GRAPH.nodes.get(attachTo)
  if (!anchor) throw new Error(`home node ${dest.id}: unknown attach node ${attachTo}`)
  DESTINATIONS_BY_ID.set(dest.id, dest)
  PEDESTRIAN_GRAPH.nodes.set(dest.id, { id: dest.id, position: dest.position, kind: 'destination' })
  const edge: PedestrianEdge = {
    id: `pe_${dest.id}__${attachTo}`,
    a: dest.id,
    b: attachTo,
    length: Math.hypot(
      anchor.position[0] - dest.position[0],
      anchor.position[1] - dest.position[1],
    ),
  }
  PEDESTRIAN_GRAPH.edges.push(edge)
  if (!PEDESTRIAN_GRAPH.adjacency.has(dest.id)) PEDESTRIAN_GRAPH.adjacency.set(dest.id, [])
  PEDESTRIAN_GRAPH.adjacency.get(dest.id)!.push({ edge, to: attachTo })
  PEDESTRIAN_GRAPH.adjacency.get(attachTo)!.push({ edge, to: dest.id })
}

// ---------------------------------------------------------------------------
// Deterministic routing (Dijkstra — the graph is tiny) + seeded selection.
// ---------------------------------------------------------------------------

export function planPedestrianRoute(
  citizenId: string,
  originId: string,
  destinationId: string,
): PedestrianRoutePlan | null {
  const g = PEDESTRIAN_GRAPH
  if (!g.nodes.has(originId) || !g.nodes.has(destinationId)) return null
  const dist = new Map<string, number>([[originId, 0]])
  const prev = new Map<string, { node: string; edge: PedestrianEdge }>()
  const visited = new Set<string>()
  while (true) {
    let current: string | null = null
    let best = Infinity
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < best) {
        best = d
        current = node
      }
    }
    if (current === null) return null
    if (current === destinationId) break
    visited.add(current)
    for (const { edge, to } of g.adjacency.get(current) ?? []) {
      const d = best + edge.length
      if (d < (dist.get(to) ?? Infinity)) {
        dist.set(to, d)
        prev.set(to, { node: current, edge })
      }
    }
  }
  const pathNodes: string[] = [destinationId]
  const pathEdges: PedestrianEdge[] = []
  let cursor = destinationId
  while (cursor !== originId) {
    const step = prev.get(cursor)
    if (!step) return null
    pathEdges.unshift(step.edge)
    pathNodes.unshift(step.node)
    cursor = step.node
  }
  return {
    citizenId,
    originId,
    destinationId,
    sidewalkPathIds: pathEdges.map((e) => e.id),
    crossingIds: pathEdges.filter((e) => e.crossingId).map((e) => e.crossingId!),
    waypoints: pathNodes.map((n) => [...g.nodes.get(n)!.position] as Vec2),
  }
}

export interface DestinationSelectionInput {
  citizenId: string
  tripIndex: number
  hour: number
  raining: boolean
  lastDestinationId: string | null
  occupancy: (destinationId: string) => number
}

/** Deterministic, filtered destination pick (never Math.random). */
export function selectDestination(input: DestinationSelectionInput): CitizenDestination | null {
  const open = CITIZEN_DESTINATIONS.filter((d) => {
    if (d.id === input.lastDestinationId) return false
    if (input.occupancy(d.id) >= d.capacity) return false
    if (d.activeHours) {
      const [from, to] = d.activeHours
      const inWindow = from <= to ? input.hour >= from && input.hour < to : input.hour >= from || input.hour < to
      if (!inWindow) return false
    }
    if (input.raining && d.weatherPolicy === 'avoid_rain') return false
    return true
  })
  if (open.length === 0) return null
  // Rain prefers indoors when anything indoor is open.
  const pool = input.raining
    ? open.filter((d) => d.weatherPolicy === 'indoor_preferred').length > 0
      ? open.filter((d) => d.weatherPolicy === 'indoor_preferred')
      : open
    : open
  const rng = createRng(hashString(`${input.citizenId}:trip:${input.tripIndex}`))
  return pool[Math.floor(rng() * pool.length)] ?? null
}

// ---------------------------------------------------------------------------
// Validation (run by the unit suite).
// ---------------------------------------------------------------------------

function segmentBlocked(a: Vec2, b: Vec2, allowRoads: boolean): string | null {
  const roads = getRoadRects()
  const solids = collectSolidFootprints()
  const water = COMPILED_SECTORS.flatMap((c) => c.waterRects)
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const steps = Math.max(2, Math.ceil(length / 1.25))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = a[0] + (b[0] - a[0]) * t
    const z = a[1] + (b[1] - a[1]) * t
    if (!allowRoads) {
      for (const r of roads) {
        if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return `road ${r.id} at ${x.toFixed(1)},${z.toFixed(1)}`
      }
    }
    for (const w of water) {
      if (x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ) return `water ${w.id}`
    }
    for (const s of solids) {
      // Interior-only test with a small forgiveness margin: anchors sit
      // NEXT to their source objects (doors, bench seats).
      const dx = Math.abs(x - s.position.x)
      const dz = Math.abs(z - s.position.z)
      if (s.heading === 0 && dx < s.halfWidth - 0.3 && dz < s.halfLength - 0.3) {
        return `solid ${s.id}`
      }
    }
  }
  return null
}

export function validatePedestrianDestinations(): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const d of CITIZEN_DESTINATIONS) {
    if (seen.has(d.id)) errors.push(`${d.id}: duplicate destination id`)
    seen.add(d.id)
    if (!(d.capacity > 0)) errors.push(`${d.id}: capacity must be positive`)
    const blocked = segmentBlocked(d.position, d.position, false)
    if (blocked) errors.push(`${d.id} (${d.sourceRef.sourceId}): anchor stands on ${blocked}`)
    if (!d.sourceRef.sourceId) errors.push(`${d.id}: missing source ref`)
  }
  return errors
}

export function validatePedestrianGraph(): string[] {
  const errors: string[] = []
  const g = PEDESTRIAN_GRAPH
  for (const e of g.edges) {
    const a = g.nodes.get(e.a)
    const b = g.nodes.get(e.b)
    if (!a || !b) {
      errors.push(`${e.id}: dangling edge`)
      continue
    }
    const blocked = segmentBlocked(a.position, b.position, Boolean(e.crossingId))
    if (blocked) errors.push(`${e.id}: passes through ${blocked}`)
    if (e.crossingId) {
      // Crossing edges must connect that crossing's OWN curb nodes
      // (signalized curbs use pcurb_, painted walk-crossings pwalk_).
      const ownCurb = (n: string) =>
        n.startsWith(`pcurb_${e.crossingId}`) || n.startsWith(`pwalk_${e.crossingId}`)
      if (!ownCurb(e.a) || !ownCurb(e.b)) {
        errors.push(`${e.id}: crossing edge joins foreign curbs`)
      }
    }
  }
  // Every proof destination is reachable from the gateway plaza.
  for (const d of CITIZEN_DESTINATIONS) {
    if (d.id === 'pdest_gateway_plaza') continue
    const plan = planPedestrianRoute('validator', 'pdest_gateway_plaza', d.id)
    if (!plan) errors.push(`${d.id}: unreachable from gateway plaza`)
  }
  return errors
}
