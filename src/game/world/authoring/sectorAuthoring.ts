import type { Vec2 } from '../worldTypes'
import type { WorldBounds } from '../sectors/worldGrid'
import { worldToSectorId } from '../sectors/worldGrid'
import { createRng, hashString } from '../../traffic/routing/routeRng'
import type {
  AuthoredSegmentSpec,
  AuthoringSourceRef,
  CompiledBuilding,
  CompiledCitizen,
  CompiledDestination,
  CompiledProp,
  CompiledSectorContent,
  LotAuthoringSpec,
  RoadAuthoringSpec,
  SectorAuthoringSpec,
} from './authoringTypes'
import {
  FRONT_DETAIL_POLICIES,
  getBuildingTemplate,
  getCitizenZoneTemplate,
  getLotTemplate,
  getPropScatterTemplate,
  getRoadTemplate,
} from './templates'
import { PROP_SOLIDITY } from '../propSolidity'
import {
  compileCrossIntersection,
  type CompiledCrossIntersection,
} from '../../traffic/intersections/crossIntersection'

/** Largest horizontal half-extent of a prop type (0 for walkable decals).
 * Conservative under zone rotation: uses the larger of the two axes. */
function propHalfExtent(type: string): number {
  const spec = PROP_SOLIDITY[type as keyof typeof PROP_SOLIDITY]
  return spec?.half ? Math.max(spec.half[0], spec.half[2]) : 0
}

/**
 * District Authoring Kit v1 — deterministic compile + validation.
 *
 * compileSectorAuthoringSpec() is pure: same spec → identical output
 * (ids, positions, scatter). It runs ONCE at module load; runtime systems
 * consume its output through the same arrays they always used.
 *
 * v1 geometry contract: authored roads are axis-aligned; `from`/`to`
 * describe the FORWARD lane centerline (so `from` can sit exactly on an
 * existing graph node to fork off the network without touching existing
 * segment ids). The return lane is offset to the opposite side and can
 * `rejoinAt` an existing node through a short merge arc.
 */

const bad = (message: string): never => {
  throw new Error(`[authoring] ${message}`)
}

function axisOf(from: Vec2, to: Vec2): 'x' | 'z' {
  if (from[0] === to[0]) return 'z'
  if (from[1] === to[1]) return 'x'
  return bad(`road from (${from}) to (${to}) must be axis-aligned in v1`)
}

interface CompiledRoad {
  spec: RoadAuthoringSpec
  axis: 'x' | 'z'
  /** Unit forward direction along the travel axis (+1/-1). */
  dir: number
  fwd: { id: string; a: Vec2; b: Vec2 }
  back: { id: string; a: Vec2; b: Vec2 }
  rect: WorldBounds
  sidewalks: WorldBounds[]
  length: number
  laneOffset: number
  width: number
}

function compileRoad(sectorId: string, spec: RoadAuthoringSpec): {
  road: CompiledRoad
  segments: AuthoredSegmentSpec[]
  dashes: { x: number; z: number; rotated: boolean }[]
} {
  const template = getRoadTemplate(spec.templateId) ?? bad(`unknown road template ${spec.templateId}`)
  const axis = axisOf(spec.from, spec.to)
  const speed = spec.speedLimit ?? template.defaultSpeedLimit
  const roadId = `${sectorId}_${spec.localId}`
  // Right-hand rule: heading +x → right is +z; heading -x → right is -z;
  // heading +z → right is -x; heading -z → right is +x.
  const travel = axis === 'x' ? spec.to[0] - spec.from[0] : spec.to[1] - spec.from[1]
  const dir = Math.sign(travel)
  const rightSign = axis === 'x' ? dir : -dir
  const off = template.laneOffset * 2 // back lane offset from fwd (full gap)

  // With forkGap the lane pair starts clear of the corridor being forked;
  // a diverge arc bridges the existing node to the forward lane's start.
  const gap = spec.forkGap ?? 0
  const fwdA: Vec2 =
    axis === 'x'
      ? [spec.from[0] + dir * gap, spec.from[1]]
      : [spec.from[0], spec.from[1] + dir * gap]
  const fwdB: Vec2 = [spec.to[0], spec.to[1]]
  // Back lane sits LEFT of forward travel (opposite side of the pair).
  const backShift = -rightSign * off
  const backA: Vec2 =
    axis === 'x' ? [fwdB[0], fwdB[1] + backShift] : [fwdB[0] + backShift, fwdB[1]]
  const backB: Vec2 =
    axis === 'x' ? [fwdA[0], fwdA[1] + backShift] : [fwdA[0] + backShift, fwdA[1]]

  const segments: AuthoredSegmentSpec[] = []
  if (gap > 0) {
    segments.push({
      id: `${roadId}_fork`,
      kind: 'junction',
      movement: 'diverge',
      junctionId: `${roadId}_fork_box`,
      points: [[spec.from[0], spec.from[1]], fwdA],
      speedLimit: 3.4,
      districtId: spec.districtId,
      roadId,
      laneId: 'fork',
    })
  }
  segments.push(
    {
      id: `${roadId}_fwd`,
      kind: 'lane',
      points: [fwdA, fwdB],
      speedLimit: speed,
      districtId: spec.districtId,
      roadId,
      laneId: 'fwd',
      destination: true,
      spawn: false,
    },
    {
      id: `${roadId}_turn`,
      kind: 'turnaround',
      points: [fwdB, backA],
      speedLimit: 3.4,
      districtId: spec.districtId,
      roadId,
      laneId: 'turn',
    },
    {
      id: `${roadId}_back`,
      kind: 'lane',
      points: [backA, backB],
      speedLimit: speed,
      districtId: spec.districtId,
      roadId,
      laneId: 'back',
      destination: true,
      spawn: false,
    },
  )
  if (spec.rejoinAt) {
    segments.push({
      id: `${roadId}_join`,
      kind: 'junction',
      movement: 'merge',
      junctionId: `${roadId}_join_box`,
      points: [backB, [spec.rejoinAt[0], spec.rejoinAt[1]]],
      speedLimit: 3.4,
      districtId: spec.districtId,
      roadId,
      laneId: 'join',
    })
  }

  // Asphalt rect covers both lanes plus half a lane margin each side.
  const margin = template.width / 2 - template.laneOffset
  const lanesMin = Math.min(fwdA[axis === 'x' ? 1 : 0], backA[axis === 'x' ? 1 : 0])
  const lanesMax = Math.max(fwdA[axis === 'x' ? 1 : 0], backA[axis === 'x' ? 1 : 0])
  // The asphalt extent includes the fork node so a diverge arc never
  // leaves the road surface.
  const alongEnds = [
    axis === 'x' ? fwdA[0] : fwdA[1],
    axis === 'x' ? fwdB[0] : fwdB[1],
    ...(gap > 0 ? [axis === 'x' ? spec.from[0] : spec.from[1]] : []),
  ]
  const alongMin = Math.min(...alongEnds)
  const alongMax = Math.max(...alongEnds)
  const rect: WorldBounds =
    axis === 'x'
      ? { minX: alongMin, maxX: alongMax, minZ: lanesMin - margin, maxZ: lanesMax + margin }
      : { minX: lanesMin - margin, maxX: lanesMax + margin, minZ: alongMin, maxZ: alongMax }
  // A rejoin arc is part of THIS road: its asphalt must reach the node it
  // merges into (graph validation rejects any arc point off asphalt).
  if (spec.rejoinAt) {
    rect.minX = Math.min(rect.minX, backB[0], spec.rejoinAt[0])
    rect.maxX = Math.max(rect.maxX, backB[0], spec.rejoinAt[0])
    rect.minZ = Math.min(rect.minZ, backB[1], spec.rejoinAt[1])
    rect.maxZ = Math.max(rect.maxZ, backB[1], spec.rejoinAt[1])
  }

  const sidewalks: WorldBounds[] =
    template.sidewalkWidth > 0
      ? axis === 'x'
        ? [
            { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ - template.sidewalkWidth, maxZ: rect.minZ },
            { minX: rect.minX, maxX: rect.maxX, minZ: rect.maxZ, maxZ: rect.maxZ + template.sidewalkWidth },
          ]
        : [
            { minX: rect.minX - template.sidewalkWidth, maxX: rect.minX, minZ: rect.minZ, maxZ: rect.maxZ },
            { minX: rect.maxX, maxX: rect.maxX + template.sidewalkWidth, minZ: rect.minZ, maxZ: rect.maxZ },
          ]
      : []

  // Centerline dashes between the lane pair (lane extent only — never
  // across a fork stub, where the junction arc owns the surface).
  const dashes: { x: number; z: number; rotated: boolean }[] = []
  const centerCross = (lanesMin + lanesMax) / 2
  const laneMin = Math.min(axis === 'x' ? fwdA[0] : fwdA[1], axis === 'x' ? fwdB[0] : fwdB[1])
  const laneMax = Math.max(axis === 'x' ? fwdA[0] : fwdA[1], axis === 'x' ? fwdB[0] : fwdB[1])
  for (let s = laneMin + 4; s < laneMax - 4; s += 6) {
    dashes.push(
      axis === 'x'
        ? { x: s, z: centerCross, rotated: true }
        : { x: centerCross, z: s, rotated: false },
    )
  }

  return {
    road: {
      spec,
      axis,
      dir,
      fwd: { id: `${roadId}_fwd`, a: fwdA, b: fwdB },
      back: { id: `${roadId}_back`, a: backA, b: backB },
      rect,
      sidewalks,
      // Lane length (excludes any forkGap stub): lot placement math anchors
      // to the forward lane, not the asphalt extent.
      length: Math.abs((axis === 'x' ? fwdB[0] - fwdA[0] : fwdB[1] - fwdA[1])),
      laneOffset: template.laneOffset,
      width: template.width,
    },
    segments,
    dashes,
  }
}

function compileLot(
  sectorId: string,
  spec: LotAuthoringSpec,
  road: CompiledRoad,
): { bounds: WorldBounds; building: CompiledBuilding } {
  const lot = getLotTemplate(spec.templateId) ?? bad(`unknown lot template ${spec.templateId}`)
  const building =
    getBuildingTemplate(spec.buildingTemplateId) ??
    bad(`unknown building template ${spec.buildingTemplateId}`)
  if (!lot.allowedBuildings.includes(building.id)) {
    bad(`lot ${spec.localId} (${lot.id}) does not allow building template ${building.id}`)
  }

  const axis = road.axis
  // `at` measures along the TRAVEL direction (0 = forward lane start), so
  // lots read the same way on eastbound and westbound roads. Identical to
  // the old axis-min math for every +direction road.
  const startAlong = axis === 'x' ? road.fwd.a[0] : road.fwd.a[1]
  const along = startAlong + spec.at * road.length * road.dir
  // Road EDGE on the requested side (beyond asphalt + sidewalk).
  const template = getRoadTemplate(road.spec.templateId)!
  const rightSign = axis === 'x' ? road.dir : -road.dir
  const sideSign = spec.side === 'right' ? rightSign : -rightSign
  const roadEdge =
    axis === 'x'
      ? sideSign > 0
        ? road.rect.maxZ
        : road.rect.minZ
      : sideSign > 0
        ? road.rect.maxX
        : road.rect.minX
  const lotNear = roadEdge + sideSign * template.sidewalkWidth
  const lotFar = lotNear + sideSign * lot.depth
  const bounds: WorldBounds =
    axis === 'x'
      ? {
          minX: along - lot.frontage / 2,
          maxX: along + lot.frontage / 2,
          minZ: Math.min(lotNear, lotFar),
          maxZ: Math.max(lotNear, lotFar),
        }
      : {
          minX: Math.min(lotNear, lotFar),
          maxX: Math.max(lotNear, lotFar),
          minZ: along - lot.frontage / 2,
          maxZ: along + lot.frontage / 2,
        }

  // Building sits setback from the road edge, centered on frontage; the
  // door faces the road.
  const [w, h, d] = building.size
  const depthCenter = lotNear + sideSign * (lot.setback + (axis === 'x' ? d : w) / 2)
  const position: Vec2 = axis === 'x' ? [along, depthCenter] : [depthCenter, along]
  const door =
    axis === 'x' ? (sideSign > 0 ? 'north' : 'south') : sideSign > 0 ? 'west' : 'east'

  return {
    bounds,
    building: {
      id: `${sectorId}_${spec.localId}`,
      position,
      size: [w, h, d],
      color: building.color,
      roofColor: building.roofColor,
      label: spec.label,
      labelColor: spec.labelColor,
      door,
      accentColor: building.accentColor,
      windows: building.windows,
    },
  }
}

function rectsOverlap(a: WorldBounds, b: WorldBounds, margin = 0): boolean {
  return (
    a.minX < b.maxX + margin &&
    a.maxX > b.minX - margin &&
    a.minZ < b.maxZ + margin &&
    a.maxZ > b.minZ - margin
  )
}

function pointInRect(p: Vec2, r: WorldBounds, margin = 0): boolean {
  return (
    p[0] > r.minX - margin && p[0] < r.maxX + margin && p[1] > r.minZ - margin && p[1] < r.maxZ + margin
  )
}

export function compileSectorAuthoringSpec(spec: SectorAuthoringSpec): CompiledSectorContent {
  const sourceRefs = new Map<string, AuthoringSourceRef>()
  const ref = (localId: string, templateId: string, contentId: string) => {
    sourceRefs.set(contentId, { sectorId: spec.sectorId, templateId, localId })
  }

  // Roads (stable order = spec order).
  const roads: CompiledRoad[] = []
  const segmentSpecs: AuthoredSegmentSpec[] = []
  const laneDashes: CompiledSectorContent['laneDashes'] = []
  const roadRects: CompiledSectorContent['roadRects'] = []
  const surfaces: CompiledSectorContent['surfaces'] = [
    { id: `${spec.sectorId}_grass`, kind: 'grass', rect: spec.area },
  ]
  for (const roadSpec of spec.roads) {
    const compiled = compileRoad(spec.sectorId, roadSpec)
    roads.push(compiled.road)
    segmentSpecs.push(...compiled.segments)
    laneDashes.push(...compiled.dashes)
    roadRects.push({ id: `${spec.sectorId}_${roadSpec.localId}`, ...compiled.road.rect })
    surfaces.push({
      id: `${spec.sectorId}_${roadSpec.localId}_asphalt`,
      kind: 'road',
      rect: compiled.road.rect,
    })
    for (let i = 0; i < compiled.road.sidewalks.length; i++) {
      surfaces.push({
        id: `${spec.sectorId}_${roadSpec.localId}_walk_${i}`,
        kind: 'sidewalk',
        rect: compiled.road.sidewalks[i],
      })
    }
    for (const seg of compiled.segments) ref(roadSpec.localId, roadSpec.templateId, seg.id)
  }
  // Unsignalled painted crosswalks authored on plain roads: a zone across
  // the asphalt with curb wait spots on both sidewalk bands. The road's
  // lane segments carry the zone id, so routed cars run the standard
  // crosswalk etiquette (courtesy for waiting pedestrians on unsignalled
  // streets + unconditional stop for occupied zones).
  const walkCrossings: CompiledSectorContent['walkCrossings'] = []
  for (const roadSpec of spec.roads) {
    for (const crossing of roadSpec.crossings ?? []) {
      const [fx, fz] = roadSpec.from
      const [tx, tz] = roadSpec.to
      if (fx !== tx && fz !== tz) bad(`crossing ${crossing.localId}: road ${roadSpec.localId} is not axis-aligned`)
      const roadLength = Math.hypot(tx - fx, tz - fz)
      if (crossing.at * roadLength < 8 || (1 - crossing.at) * roadLength < 8) {
        bad(`crossing ${crossing.localId}: must sit at least 8u clear of the road ends`)
      }
      // Along-axis position from the authored fraction; across-axis centered
      // on the compiled ASPHALT rect (the road line sits a lane off-center).
      const rect = roads.find((r) => r.spec.localId === roadSpec.localId)!.rect
      const eastWest = fz === tz // road runs east-west → crossing spans north-south
      const cx = eastWest ? fx + (tx - fx) * crossing.at : (rect.minX + rect.maxX) / 2
      const cz = eastWest ? (rect.minZ + rect.maxZ) / 2 : fz + (tz - fz) * crossing.at
      const id = `${spec.sectorId}_${roadSpec.localId}_${crossing.localId}`
      walkCrossings.push({
        id,
        roadId: `${spec.sectorId}_${roadSpec.localId}`,
        center: [cx, cz],
        // Axis-aligned [x, z]: the band is 2.2 thick ALONG the road and
        // spans 11 ACROSS it (asphalt + a step into both sidewalks).
        halfExtents: eastWest ? [1.1, 5.5] : [5.5, 1.1],
        waitSpots: eastWest
          ? [[cx, cz - 7], [cx, cz + 7]]
          : [[cx - 7, cz], [cx + 7, cz]],
      })
      ref(crossing.localId, 'road_crossing', id)
      for (const seg of segmentSpecs) {
        if (seg.roadId === `${spec.sectorId}_${roadSpec.localId}` && seg.kind === 'lane') {
          seg.crossingZoneIds = [...(seg.crossingZoneIds ?? []), id]
        }
      }
    }
  }
  // Signalized cross-street intersections: movement segments join the
  // graph like any junction arcs; the box gets its own asphalt pad and
  // zebra-striped crossings; poles render as props via signalPoles.
  const intersections: CompiledCrossIntersection[] = []
  for (const cross of spec.crossStreets ?? []) {
    const compiledCross = compileCrossIntersection(spec.sectorId, cross)
    segmentSpecs.push(...compiledCross.segments)
    for (const seg of compiledCross.segments) ref(cross.localId, 'cross_street', seg.id)
    roadRects.push({ id: `${spec.sectorId}_${cross.localId}_box`, ...compiledCross.junctionBox })
    surfaces.push({
      id: `${spec.sectorId}_${cross.localId}_asphalt`,
      kind: 'road',
      rect: compiledCross.junctionBox,
    })
    // Approach lanes are resolved against already-compiled roads: any lane
    // segment ENDING on an entry node feeds that approach.
    const entries: Record<string, [number, number]> = {}
    for (const line of compiledCross.intersection.stopLines) {
      const m = compiledCross.intersection.movements.find((mv) => mv.approach === line.approach)!
      entries[line.approach] = m.path[0]
    }
    for (const seg of segmentSpecs) {
      if (seg.kind !== 'lane') continue
      const end = seg.points[seg.points.length - 1]
      for (const [approach, node] of Object.entries(entries)) {
        if (Math.abs(end[0] - node[0]) < 0.01 && Math.abs(end[1] - node[1]) < 0.01) {
          compiledCross.intersection.approachSegments[seg.id] = approach as never
        }
      }
    }
    intersections.push(compiledCross.intersection)
  }

  for (const [i, plaza] of spec.plazas.entries()) {
    surfaces.push({ id: `${spec.sectorId}_plaza_${i}`, kind: 'plaza', rect: plaza })
  }
  for (const [i, belt] of (spec.greenbelts ?? []).entries()) {
    surfaces.push({ id: `${spec.sectorId}_greenbelt_${i}`, kind: 'grass', rect: belt })
  }
  // Water: visual surface + solid rect (collided and avoided by scatter,
  // citizens and buildings — validated below).
  const waterRects: CompiledSectorContent['waterRects'] = []
  for (const [i, water] of (spec.water ?? []).entries()) {
    const id = `${spec.sectorId}_water_${i}`
    surfaces.push({ id, kind: 'water', rect: water })
    waterRects.push({ id, ...water })
  }

  // Lots + buildings.
  const lots: CompiledSectorContent['lots'] = []
  const buildings: CompiledBuilding[] = []
  for (const lotSpec of spec.lots) {
    const road = roads.find((r) => r.spec.localId === lotSpec.roadLocalId)
    if (!road) bad(`lot ${lotSpec.localId}: unknown road ${lotSpec.roadLocalId}`)
    const compiled = compileLot(spec.sectorId, lotSpec, road!)
    lots.push({
      id: `${spec.sectorId}_lot_${lotSpec.localId}`,
      bounds: compiled.bounds,
      sourceRef: { sectorId: spec.sectorId, templateId: lotSpec.templateId, localId: lotSpec.localId },
    })
    buildings.push(compiled.building)
    ref(lotSpec.localId, lotSpec.buildingTemplateId, compiled.building.id)
  }
  // Free lots: template buildings at explicit positions with explicit door
  // facing (promenades, plazas — anywhere off road frontage).
  for (const free of spec.freeLots ?? []) {
    const template =
      getBuildingTemplate(free.buildingTemplateId) ??
      bad(`unknown building template ${free.buildingTemplateId}`)
    const t = template!
    const id = `${spec.sectorId}_${free.localId}`
    buildings.push({
      id,
      position: [free.position[0], free.position[1]],
      size: t.size,
      color: t.color,
      roofColor: t.roofColor,
      label: free.label,
      labelColor: free.labelColor,
      door: free.facing,
      accentColor: t.accentColor,
      windows: t.windows,
    })
    ref(free.localId, free.buildingTemplateId, id)
  }

  // Fixed props: deterministic rows, explicit singles, and building-front
  // details from FRONT_DETAIL_POLICIES. Computed before scatter so seeded
  // placement can keep clear of them.
  const fixedProps: CompiledProp[] = []
  for (const line of spec.linePropZones ?? []) {
    const dx = line.to[0] - line.from[0]
    const dz = line.to[1] - line.from[1]
    const length = Math.hypot(dx, dz)
    const count = Math.max(2, Math.floor(length / line.spacing) + 1)
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      const p: Vec2 = [
        Math.round((line.from[0] + dx * t) * 10) / 10,
        Math.round((line.from[1] + dz * t) * 10) / 10,
      ]
      const id = `${spec.sectorId}_${line.localId}_${i}`
      fixedProps.push(
        line.rotation === undefined
          ? { id, type: line.type, position: p }
          : { id, type: line.type, position: p, rotationY: line.rotation },
      )
      ref(line.localId, 'line_props', id)
    }
  }
  for (const placed of spec.placedProps ?? []) {
    const id = `${spec.sectorId}_${placed.localId}`
    fixedProps.push(
      placed.rotation === undefined
        ? { id, type: placed.type, position: [placed.position[0], placed.position[1]] }
        : {
            id,
            type: placed.type,
            position: [placed.position[0], placed.position[1]],
            rotationY: placed.rotation,
          },
    )
    ref(placed.localId, 'placed_prop', id)
  }
  const detailSources = [
    ...spec.lots.filter((l) => l.details).map((l) => ({ localId: l.localId, template: l.buildingTemplateId })),
    ...(spec.freeLots ?? []).filter((l) => l.details).map((l) => ({ localId: l.localId, template: l.buildingTemplateId })),
  ]
  for (const source of detailSources) {
    const building = buildings.find((b) => b.id === `${spec.sectorId}_${source.localId}`)
    const policy = FRONT_DETAIL_POLICIES[source.template]
    if (!building || !policy || !building.door) continue
    const [w, , d] = building.size
    const face = building.door
    // Door-face center + outward normal + lateral axis.
    const fx = face === 'east' ? building.position[0] + w / 2 : face === 'west' ? building.position[0] - w / 2 : building.position[0]
    const fz = face === 'south' ? building.position[1] + d / 2 : face === 'north' ? building.position[1] - d / 2 : building.position[1]
    const nx = face === 'east' ? 1 : face === 'west' ? -1 : 0
    const nz = face === 'south' ? 1 : face === 'north' ? -1 : 0
    for (const [i, item] of policy.entries()) {
      const p: Vec2 = [
        Math.round((fx + nx * item.out + (nz !== 0 ? item.along : 0)) * 10) / 10,
        Math.round((fz + nz * item.out + (nx !== 0 ? item.along : 0)) * 10) / 10,
      ]
      const id = `${spec.sectorId}_${source.localId}_front_${i}`
      fixedProps.push(
        item.rotation === undefined
          ? { id, type: item.type, position: p }
          : { id, type: item.type, position: p, rotationY: item.rotation },
      )
      ref(source.localId, `front_detail:${source.template}`, id)
    }
  }

  // Citizen zones (compiled BEFORE props so scatter can avoid their routes).
  const citizens: CompiledCitizen[] = []
  for (const zone of spec.citizenZones) {
    const template =
      getCitizenZoneTemplate(zone.templateId) ?? bad(`unknown citizen template ${zone.templateId}`)
    const t = template!
    for (let i = 0; i < t.count; i++) {
      const start = zone.points[i % zone.points.length]
      const id = `${spec.sectorId}_${zone.localId}_${i}`
      citizens.push({
        id,
        district: spec.districtIds[0],
        archetype: t.archetype,
        behaviorType: t.behaviorType,
        position: [start[0], start[1]],
        waypoints: zone.points.map((p) => [p[0], p[1]] as Vec2),
        walkSpeed: t.walkSpeed,
        activeHours: t.activeHours,
        weatherBehavior: t.weatherBehavior,
        bubbleLines: zone.bubbleLines,
      })
      ref(zone.localId, zone.templateId, id)
    }
  }
  /** Distance from a point to the nearest citizen route segment. */
  const distanceToCitizenRoutes = (p: Vec2): number => {
    let best = Infinity
    for (const zone of spec.citizenZones) {
      for (let i = 0; i < zone.points.length; i++) {
        const a = zone.points[i]
        const b = zone.points[(i + 1) % zone.points.length]
        const abx = b[0] - a[0]
        const abz = b[1] - a[1]
        const lenSq = abx * abx + abz * abz
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / lenSq))
        best = Math.min(best, Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t)))
      }
    }
    return best
  }

  // Prop zones: deterministic grid-jitter scatter with avoidance.
  const props: CompiledProp[] = [...fixedProps]
  for (const zone of spec.propZones) {
    const template =
      getPropScatterTemplate(zone.templateId) ?? bad(`unknown prop template ${zone.templateId}`)
    const rng = createRng(hashString(`${spec.sectorId}:${zone.localId}:${zone.seed}`))
    const t = template!
    const area = (zone.bounds.maxX - zone.bounds.minX) * (zone.bounds.maxZ - zone.bounds.minZ)
    const targetCount = Math.round((area / 100) * t.densityPer100)
    const totalWeight = t.props.reduce((s, p) => s + p.weight, 0)
    const placed: Vec2[] = []
    let attempts = 0
    let index = 0
    while (placed.length < targetCount && attempts < targetCount * 12) {
      attempts += 1
      const x = zone.bounds.minX + rng() * (zone.bounds.maxX - zone.bounds.minX)
      const z = zone.bounds.minZ + rng() * (zone.bounds.maxZ - zone.bounds.minZ)
      const p: Vec2 = [Math.round(x * 10) / 10, Math.round(z * 10) / 10]
      // Weighted type pick FIRST: avoidance must respect the picked prop's
      // real solid footprint (a parked car needs far more clearance than a
      // lamp — the parked-car-in-the-living-room bug).
      let roll = rng() * totalWeight
      let type = t.props[0].type
      for (const candidate of t.props) {
        roll -= candidate.weight
        if (roll <= 0) {
          type = candidate.type
          break
        }
      }
      const bodyHalf = propHalfExtent(type)
      // Avoidance: roads, water, buildings (+ margin), spacing to others.
      if (roadRects.some((r) => pointInRect(p, r, 0.6 + bodyHalf))) continue
      if (waterRects.some((r) => pointInRect(p, r, 0.6 + bodyHalf))) continue
      if (
        buildings.some((b) =>
          pointInRect(p, {
            minX: b.position[0] - b.size[0] / 2,
            maxX: b.position[0] + b.size[0] / 2,
            minZ: b.position[1] - b.size[2] / 2,
            maxZ: b.position[1] + b.size[2] / 2,
          }, 1 + bodyHalf),
        )
      ) {
        continue
      }
      if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < t.minSpacing)) continue
      // Keep clear of fixed props (railings, front details, parked singles).
      if (
        fixedProps.some(
          (fp) =>
            Math.hypot(fp.position[0] - p[0], fp.position[1] - p[1]) <
            propHalfExtent(fp.type) + bodyHalf + 0.4,
        )
      ) {
        continue
      }
      // Never block a citizen route corridor (lamp-on-the-walking-path bug).
      if (distanceToCitizenRoutes(p) < 1.6 + bodyHalf) continue
      placed.push(p)
      const id = `${spec.sectorId}_${zone.localId}_${index++}`
      props.push(
        zone.rotation === undefined
          ? { id, type, position: p }
          : { id, type, position: p, rotationY: zone.rotation },
      )
      ref(zone.localId, zone.templateId, id)
    }
  }

  // Traffic anchors.
  const destinations: CompiledDestination[] = []
  for (const anchor of spec.traffic) {
    const road = roads.find((r) => r.spec.localId === anchor.roadLocalId)
    if (!road) bad(`traffic anchor ${anchor.localId}: unknown road ${anchor.roadLocalId}`)
    const segmentId = anchor.lane === 'fwd' ? road!.fwd.id : road!.back.id
    const id = `${anchor.kind === 'exit' ? 'exit' : 'dest'}_${spec.sectorId}_${anchor.localId}`
    destinations.push({
      id,
      districtId: spec.districtIds[0],
      segmentId,
      progress: anchor.at,
      kind: anchor.destinationKind,
      weight: anchor.weight,
    })
    ref(anchor.localId, 'traffic_anchor', id)
  }

  // Perimeter walls with declared openings.
  const walls: CompiledSectorContent['walls'] = []
  const a = spec.area
  const sides = [
    { side: 'north' as const, fixed: a.minZ - 1, from: a.minX, to: a.maxX, horizontal: true },
    { side: 'south' as const, fixed: a.maxZ + 1, from: a.minX, to: a.maxX, horizontal: true },
    { side: 'west' as const, fixed: a.minX - 1, from: a.minZ, to: a.maxZ, horizontal: false },
    { side: 'east' as const, fixed: a.maxX + 1, from: a.minZ, to: a.maxZ, horizontal: false },
  ]
  for (const side of sides) {
    const openings = spec.wallOpenings
      .filter((o) => o.side === side.side)
      .sort((x, y) => x.from - y.from)
    let cursor = side.from - 2
    const spans: [number, number][] = []
    for (const opening of openings) {
      if (opening.from > cursor) spans.push([cursor, opening.from])
      cursor = opening.to
    }
    if (side.to + 2 > cursor) spans.push([cursor, side.to + 2])
    for (const [from, to] of spans) {
      if (to - from < 0.5) continue
      const mid = (from + to) / 2
      const half = (to - from) / 2
      walls.push(
        side.horizontal
          ? { half: [half, 4, 1], position: [mid, 2, side.fixed] }
          : { half: [1, 4, half], position: [side.fixed, 2, mid] },
      )
    }
  }

  // Junction boxes for compiled arcs (bbox + margin, on-asphalt by design).
  const junctionBoxes: Record<string, { minX: number; maxX: number; minZ: number; maxZ: number }> = {}
  for (const seg of segmentSpecs) {
    if (seg.kind !== 'junction' || !seg.junctionId) continue
    const xs = seg.points.map((p) => p[0])
    const zs = seg.points.map((p) => p[1])
    const box = {
      minX: Math.min(...xs) - 2,
      maxX: Math.max(...xs) + 2,
      minZ: Math.min(...zs) - 2,
      maxZ: Math.max(...zs) + 2,
    }
    // Shared junction ids (a cross-street's 12 movements) UNION their
    // boxes — overwriting would leave earlier movements outside the box.
    const existing = junctionBoxes[seg.junctionId]
    junctionBoxes[seg.junctionId] = existing
      ? {
          minX: Math.min(existing.minX, box.minX),
          maxX: Math.max(existing.maxX, box.maxX),
          minZ: Math.min(existing.minZ, box.minZ),
          maxZ: Math.max(existing.maxZ, box.maxZ),
        }
      : box
  }

  return {
    sectorId: spec.sectorId,
    spec,
    buildings,
    props,
    citizens,
    segmentSpecs,
    destinations,
    roadRects,
    waterRects,
    surfaces,
    laneDashes,
    walls,
    lots,
    junctionBoxes,
    intersections,
    walkCrossings,
    sourceRefs,
    map: {
      label: spec.map.label,
      labelAnchor: spec.map.labelAnchor ?? [
        (spec.area.minX + spec.area.maxX) / 2,
        (spec.area.minZ + spec.area.maxZ) / 2,
      ],
      roadStrips: roadRects.map((r) => ({ ...r })),
      waterStrips: waterRects.map((r) => ({ ...r })),
      landmarks: (spec.map.landmarks ?? []).map((l) => ({
        id: `${spec.sectorId}_lm_${l.localId}`,
        label: l.label,
        icon: l.icon,
        position: [l.position[0], l.position[1]] as Vec2,
      })),
    },
  }
}

/** Human-readable validation of compiled content. Empty array = ship it. */
export function validateCompiledSectorContent(compiled: CompiledSectorContent): string[] {
  const errors: string[] = []
  const { spec } = compiled
  const label = (id: string) => {
    const src = compiled.sourceRefs.get(id)
    return src ? `${id} (from ${src.localId}, template ${src.templateId})` : id
  }

  // Unique, sector-prefixed generated ids.
  const seen = new Set<string>()
  for (const id of [
    ...compiled.buildings.map((b) => b.id),
    ...compiled.props.map((p) => p.id),
    ...compiled.citizens.map((c) => c.id),
    ...compiled.segmentSpecs.map((s) => s.id),
    ...compiled.destinations.map((d) => d.id),
  ]) {
    if (seen.has(id)) errors.push(`duplicate generated id ${id} in sector ${spec.sectorId}`)
    seen.add(id)
    if (!compiled.sourceRefs.has(id)) errors.push(`generated id ${id} has no authoring source ref`)
  }

  // Buildings: inside the walled area, inside the owning cell, apart from
  // each other and off every road.
  for (const building of compiled.buildings) {
    const box: WorldBounds = {
      minX: building.position[0] - building.size[0] / 2,
      maxX: building.position[0] + building.size[0] / 2,
      minZ: building.position[1] - building.size[2] / 2,
      maxZ: building.position[1] + building.size[2] / 2,
    }
    if (
      box.minX < spec.area.minX ||
      box.maxX > spec.area.maxX ||
      box.minZ < spec.area.minZ ||
      box.maxZ > spec.area.maxZ
    ) {
      errors.push(`building ${label(building.id)} leaves the sector area`)
    }
    if (worldToSectorId(building.position[0], building.position[1]) !== spec.sectorId) {
      errors.push(
        `building ${label(building.id)} at (${building.position}) is owned by ` +
          `${worldToSectorId(building.position[0], building.position[1])}, not ${spec.sectorId}`,
      )
    }
    for (const rect of compiled.roadRects) {
      if (rectsOverlap(box, rect)) {
        errors.push(`building ${label(building.id)} overlaps road ${rect.id}`)
      }
    }
    for (const rect of compiled.waterRects) {
      if (rectsOverlap(box, rect)) {
        errors.push(`building ${label(building.id)} stands in water ${rect.id}`)
      }
    }
    for (const other of compiled.buildings) {
      if (other.id <= building.id) continue
      const otherBox: WorldBounds = {
        minX: other.position[0] - other.size[0] / 2,
        maxX: other.position[0] + other.size[0] / 2,
        minZ: other.position[1] - other.size[2] / 2,
        maxZ: other.position[1] + other.size[2] / 2,
      }
      if (rectsOverlap(box, otherBox)) {
        errors.push(`building ${label(building.id)} overlaps building ${label(other.id)}`)
      }
    }
  }

  // Props: off roads, off water, off buildings — measured by the prop's
  // REAL solid footprint, not just its anchor point.
  for (const prop of compiled.props) {
    const bodyHalf = propHalfExtent(prop.type)
    for (const rect of compiled.roadRects) {
      if (pointInRect(prop.position, rect, 0.4 + bodyHalf)) {
        errors.push(`prop ${label(prop.id)} sits on road ${rect.id}`)
      }
    }
    for (const rect of compiled.waterRects) {
      if (pointInRect(prop.position, rect, 0.4 + bodyHalf)) {
        errors.push(`prop ${label(prop.id)} floats in water ${rect.id}`)
      }
    }
    for (const building of compiled.buildings) {
      if (
        pointInRect(prop.position, {
          minX: building.position[0] - building.size[0] / 2,
          maxX: building.position[0] + building.size[0] / 2,
          minZ: building.position[1] - building.size[2] / 2,
          maxZ: building.position[1] + building.size[2] / 2,
        }, 0.5 + bodyHalf)
      ) {
        errors.push(`prop ${label(prop.id)} sits inside building ${label(building.id)}`)
      }
    }
  }

  // Citizens: waypoints never inside buildings or road interiors.
  for (const citizen of compiled.citizens) {
    for (const [i, waypoint] of citizen.waypoints.entries()) {
      for (const building of compiled.buildings) {
        if (
          pointInRect(waypoint, {
            minX: building.position[0] - building.size[0] / 2,
            maxX: building.position[0] + building.size[0] / 2,
            minZ: building.position[1] - building.size[2] / 2,
            maxZ: building.position[1] + building.size[2] / 2,
          })
        ) {
          errors.push(
            `citizen ${label(citizen.id)} waypoint ${i} is inside building ${label(building.id)}`,
          )
        }
      }
      for (const rect of compiled.roadRects) {
        if (pointInRect(waypoint, rect, -0.5)) {
          errors.push(`citizen ${label(citizen.id)} waypoint ${i} is on road ${rect.id}`)
        }
      }
      for (const rect of compiled.waterRects) {
        if (pointInRect(waypoint, rect, 0.5)) {
          errors.push(`citizen ${label(citizen.id)} waypoint ${i} is in water ${rect.id}`)
        }
      }
    }
    // Route legs sampled every unit: a dry-endpoint leg must not cross water.
    if (compiled.waterRects.length > 0 && citizen.waypoints.length > 1) {
      for (let i = 0; i < citizen.waypoints.length; i++) {
        const a = citizen.waypoints[i]
        const b = citizen.waypoints[(i + 1) % citizen.waypoints.length]
        const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))
        for (let s = 1; s < steps; s++) {
          const p: Vec2 = [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]
          const wet = compiled.waterRects.find((rect) => pointInRect(p, rect, 0.2))
          if (wet) {
            errors.push(`citizen ${label(citizen.id)} route leg ${i} crosses water ${wet.id}`)
            break
          }
        }
      }
    }
  }

  // Destinations: sane progress, on lane segments, not on turn/join arcs.
  for (const dest of compiled.destinations) {
    if (dest.progress < 0.1 || dest.progress > 0.9) {
      errors.push(`destination ${label(dest.id)} progress ${dest.progress} too near a segment end`)
    }
    const segment = compiled.segmentSpecs.find((s) => s.id === dest.segmentId)
    if (!segment) errors.push(`destination ${label(dest.id)} references missing segment ${dest.segmentId}`)
    else if (segment.kind !== 'lane') {
      errors.push(`destination ${label(dest.id)} sits on ${segment.kind} segment ${segment.id}`)
    }
  }

  return errors
}
