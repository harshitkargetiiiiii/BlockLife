import type { Vec2 } from '../worldTypes'
import type { SectorId, WorldBounds } from '../sectors/worldGrid'

/**
 * District Authoring Kit v1 — data model.
 *
 * A SectorAuthoringSpec is a compact, human-writable description of one
 * sector: roads by template, lots along road frontage, buildings by
 * template on lots, prop zones with seeded scatter, citizen zones, traffic
 * anchors and map metadata. `compileSectorAuthoringSpec` resolves it
 * deterministically into the EXACT data shapes the runtime already
 * consumes (BuildingDef, PropDef, SegmentSpec, TrafficDestination,
 * AmbientCitizen, road rects, wall colliders, map shapes) — runtime
 * systems never depend on the kit.
 *
 * Every generated entity carries an AuthoringSourceRef so validation
 * errors read like: "building s1_-1_bld_2 (lot lot_n_1, template
 * office_tower) overlaps road main_street in sector s1_-1".
 */

export type DistrictArchetype =
  | 'downtown'
  | 'commercial'
  | 'residential'
  | 'industrial'
  | 'waterfront'
  | 'suburban'
  | 'park'
  | 'transition'

export interface AuthoringSourceRef {
  sectorId: SectorId
  templateId: string
  localId: string
}

// ---- Templates -------------------------------------------------------------

export interface RoadTemplate {
  id: string
  kind: 'avenue' | 'localLane' | 'connector'
  /** Two one-way lanes (right-hand pair) or a single directed lane. */
  directionPolicy: 'twoWayPair' | 'oneWay'
  /** Full asphalt width. */
  width: number
  sidewalkWidth: number
  laneOffset: number
  defaultSpeedLimit: number
  archetypes: DistrictArchetype[]
}

export interface BuildingTemplate {
  id: string
  /** Footprint [w, d] and height ranges resolved by the lot. */
  size: [number, number, number]
  color: string
  roofColor: string
  accentColor?: string
  windows?: boolean
  labelPolicy: 'required' | 'optional' | 'none'
  archetypes: DistrictArchetype[]
}

export interface LotTemplate {
  id: string
  /** Lot depth measured away from the road edge. */
  depth: number
  /** Frontage width along the road. */
  frontage: number
  /** Gap between the road edge and the building face. */
  setback: number
  allowedBuildings: string[]
  archetypes: DistrictArchetype[]
}

export interface PropScatterTemplate {
  id: string
  /** Existing PropType names with per-type weights. */
  props: { type: string; weight: number }[]
  /** Approx entities per 100 square units. */
  densityPer100: number
  minSpacing: number
}

export interface CitizenZoneTemplate {
  id: string
  archetype: string
  behaviorType: 'loop_walk' | 'visit_spot' | 'idle_stand' | 'sit' | 'queue'
  walkSpeed: number
  activeHours: [number, number]
  weatherBehavior: 'any' | 'avoid_rain' | 'shelter_in_rain' | 'work_rain_or_clear'
  /** Citizens generated per zone. */
  count: number
}

// ---- Authoring spec --------------------------------------------------------

export interface RoadAuthoringSpec {
  localId: string
  templateId: string
  /**
   * Directed centerline: first point may join an EXISTING graph node
   * (exact coordinates) so the new road forks off the current network
   * without touching any existing segment ids.
   */
  from: Vec2
  to: Vec2
  /** Existing node coordinates the return lane rejoins (loop closure). */
  rejoinAt?: Vec2
  /**
   * Offset the lane pair's start this many units along the travel axis and
   * emit a diverge junction arc from the `from` node to the forward lane's
   * start. Required for side streets whose back lane would otherwise end
   * ON a through lane of the corridor being forked (e.g. a west spur at a
   * northbound road's terminus).
   */
  forkGap?: number
  speedLimit?: number
  districtId: string
  /**
   * Unsignalled painted crosswalks across THIS road at fractions of its
   * length (0..1). Pedestrians use safety etiquette (no walk indicator);
   * cars courtesy-yield to waiting pedestrians and always stop for
   * occupied zones — same rules as the legacy painted crossings.
   */
  crossings?: { localId: string; at: number }[]
}

/** An unsignalled kit crosswalk, compiled from a road's `crossings` entry. */
export interface CompiledWalkCrossing {
  id: string
  roadId: string
  center: Vec2
  /** Axis-aligned [x, z] half extents (2.2 along the road, 11 across). */
  halfExtents: Vec2
  waitSpots: [Vec2, Vec2]
}

export interface LotAuthoringSpec {
  localId: string
  templateId: string
  /** Which authored road this lot fronts. */
  roadLocalId: string
  /** 'left'/'right' of the road direction, and distance along it (0..1). */
  side: 'left' | 'right'
  at: number
  buildingTemplateId: string
  label?: string
  labelColor?: string
  /** Emit the building template's FRONT_DETAIL_POLICY props at the door. */
  details?: boolean
}

export interface PropZoneAuthoringSpec {
  localId: string
  templateId: string
  bounds: WorldBounds
  seed: string
  avoid?: 'roadside' | 'none'
  /** Fixed Y rotation for every prop in the zone (aligned parked rows). */
  rotation?: number
}

/** Template building at an explicit position (plazas, promenades) — the
 * door faces `facing` instead of deriving from road frontage. */
export interface FreeLotAuthoringSpec {
  localId: string
  buildingTemplateId: string
  position: Vec2
  facing: 'north' | 'south' | 'east' | 'west'
  label?: string
  labelColor?: string
  /** Emit the building template's FRONT_DETAIL_POLICY props at the door. */
  details?: boolean
}

/** Evenly spaced prop row: railings, lamp rhythms, hedges, barricades. */
export interface LinePropsSpec {
  localId: string
  type: string
  from: Vec2
  to: Vec2
  /** Distance between props along the line. */
  spacing: number
  rotation?: number
}

/** One explicit, validated prop (delivery van, service vehicle, landmark). */
export interface PlacedPropSpec {
  localId: string
  type: string
  position: Vec2
  rotation?: number
}

export interface CitizenZoneAuthoringSpec {
  localId: string
  templateId: string
  /** Waypoint loop for walkers / anchor for idlers. */
  points: Vec2[]
  bubbleLines?: string[]
}

export interface TrafficAnchorSpec {
  localId: string
  kind: 'destination' | 'exit'
  /** Authored road local id + normalized progress + lane ('fwd'/'back'). */
  roadLocalId: string
  lane: 'fwd' | 'back'
  at: number
  destinationKind: 'commercial' | 'residential' | 'industrial' | 'districtExit'
  weight: number
}

export interface SectorAuthoringSpec {
  sectorId: SectorId
  name: string
  districtIds: string[]
  archetype: DistrictArchetype
  /** Walled playable area; openings declared explicitly. */
  area: WorldBounds
  /** Wall gaps: sides with [start, end] ranges left open. */
  wallOpenings: { side: 'north' | 'south' | 'east' | 'west'; from: number; to: number }[]
  roads: RoadAuthoringSpec[]
  lots: LotAuthoringSpec[]
  /** Buildings at explicit positions (off road frontage). */
  freeLots?: FreeLotAuthoringSpec[]
  /** Signalized four-way cross-street intersections (traffic module). */
  crossStreets?: import('../../traffic/intersections/crossIntersection').CrossStreetAuthoringSpec[]
  /** Evenly spaced prop rows (railings, lamp rhythms, hedges, barricades). */
  linePropZones?: LinePropsSpec[]
  /** Explicit validated one-off props (service vehicles, landmarks). */
  placedProps?: PlacedPropSpec[]
  propZones: PropZoneAuthoringSpec[]
  citizenZones: CitizenZoneAuthoringSpec[]
  traffic: TrafficAnchorSpec[]
  plazas: WorldBounds[]
  /** Solid, unwalkable water rectangles (rendered + collided + validated). */
  water?: WorldBounds[]
  /** Extra grass surfaces outside the walled area (road corridors). */
  greenbelts?: WorldBounds[]
  map: {
    label: string
    order?: number
    /** World position for the phone-map label (default: area center). */
    labelAnchor?: Vec2
    /** Named landmarks: phone-map markers (data-driven, no pixel hacks). */
    landmarks?: { localId: string; label: string; icon: string; position: Vec2 }[]
  }
  /**
   * Ambient audio hook (metadata only in v1 — no audio system wiring):
   * a future mixer keys sector ambience loops off this string.
   */
  ambienceKey?: string
}

// ---- Compiled output (runtime-shaped) --------------------------------------

/** Structurally identical to roadGraphData's SegmentSpec input. */
export interface AuthoredSegmentSpec {
  id: string
  kind: 'lane' | 'junction' | 'turnaround'
  points: Vec2[]
  speedLimit: number
  districtId: string
  roadId: string
  laneId: string
  tags?: string[]
  movement?: 'straight' | 'left' | 'right' | 'merge' | 'diverge' | 'loop'
  junctionId?: string
  isConnector?: boolean
  spawn?: boolean
  destination?: boolean
  /** Pedestrian crossing zones this segment passes (cars yield when occupied). */
  crossingZoneIds?: string[]
}

export interface CompiledBuilding {
  id: string
  position: Vec2
  size: [number, number, number]
  color: string
  roofColor: string
  label?: string
  labelColor?: string
  door?: 'north' | 'south' | 'east' | 'west'
  accentColor?: string
  windows?: boolean
}

export interface CompiledProp {
  id: string
  type: string
  position: Vec2
  rotationY?: number
  color?: string
}

export interface CompiledCitizen {
  id: string
  district: string
  archetype: string
  behaviorType: string
  position: Vec2
  waypoints: Vec2[]
  walkSpeed: number
  activeHours: [number, number]
  weatherBehavior: string
  bubbleLines?: string[]
}

export interface CompiledDestination {
  id: string
  districtId: string
  segmentId: string
  progress: number
  kind: 'commercial' | 'residential' | 'industrial' | 'districtExit' | 'parking' | 'throughTraffic'
  weight: number
}

export interface CompiledRect {
  id: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface CompiledWall {
  half: [number, number, number]
  position: [number, number, number]
}

export interface CompiledLot {
  id: string
  bounds: WorldBounds
  sourceRef: AuthoringSourceRef
}

export interface CompiledSectorContent {
  sectorId: SectorId
  spec: SectorAuthoringSpec
  buildings: CompiledBuilding[]
  props: CompiledProp[]
  citizens: CompiledCitizen[]
  segmentSpecs: AuthoredSegmentSpec[]
  destinations: CompiledDestination[]
  roadRects: CompiledRect[]
  /** Solid water rectangles (colliders + scatter/citizen avoidance). */
  waterRects: CompiledRect[]
  /** Visual rectangles: road asphalt / sidewalks / plaza pads / grass / water. */
  surfaces: { id: string; kind: 'road' | 'sidewalk' | 'plaza' | 'grass' | 'water'; rect: WorldBounds }[]
  /** Lane centerline dashes for two-way roads (visual only). */
  laneDashes: { x: number; z: number; rotated: boolean }[]
  walls: CompiledWall[]
  lots: CompiledLot[]
  /** Junction boxes for compiled merge/turn arcs (traffic mutex + tests). */
  junctionBoxes: Record<string, WorldBounds>
  intersections: import('../../traffic/intersections/crossIntersection').CompiledCrossIntersection[]
  /** Unsignalled painted crosswalks authored on plain roads. */
  walkCrossings: CompiledWalkCrossing[]
  sourceRefs: Map<string, AuthoringSourceRef>
  map: {
    label: string
    labelAnchor: Vec2
    roadStrips: WorldBounds[]
    waterStrips: WorldBounds[]
    landmarks: { id: string; label: string; icon: string; position: Vec2 }[]
  }
}
