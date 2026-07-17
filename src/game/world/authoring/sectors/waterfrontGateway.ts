import type { SectorAuthoringSpec } from '../authoringTypes'
import { compileSectorAuthoringSpec } from '../sectorAuthoring'

/**
 * Waterfront Gateway (sector s0_-2) — the city's north shore. Owns the two
 * trunk roads of the northern expansion:
 *
 * - North Boulevard forks from the Downtown Gateway's north end. Its
 *   forward lane STARTS on the existing node (50, -96) (gate_nb's end) and
 *   its return lane lands EXACTLY on (46, -96) (gate_sb's start) by lane
 *   math — a collinear continuation needing zero junction arcs.
 * - Waterfront Drive continues the same way from the boulevard's north
 *   terminus (50, -232) up to the shore.
 *
 * The sector itself is pedestrian-first: a solid water band across the
 * north edge, a boardwalk promenade, free-lot buildings facing the water,
 * and one parking-style destination on the drive. Future ferry/bridge
 * hook: a `water` opening plus a road forking west from node (50, -300).
 */
export const WATERFRONT_GATEWAY_SPEC: SectorAuthoringSpec = {
  sectorId: 's0_-2',
  name: 'Waterfront Gateway',
  districtIds: ['waterfront_north'],
  archetype: 'waterfront',
  area: { minX: -44, maxX: 64, minZ: -336, maxZ: -238 },
  wallOpenings: [{ side: 'south', from: 42, to: 54 }],
  roads: [
    {
      // South half of the boulevard — ends at the Harbor Cross stop line.
      localId: 'boulevard',
      templateId: 'avenue_two_way',
      from: [50, -96], // existing node: gate_nb end
      to: [50, -154], // Harbor Cross south entry node
      districtId: 'waterfront_north',
    },
    {
      // North half — begins at the intersection's north exit node; the
      // straight movement segments bridge the two halves.
      localId: 'boulevard_n',
      templateId: 'avenue_two_way',
      from: [50, -166],
      to: [50, -232],
      districtId: 'waterfront_north',
    },
    {
      // Harbor Cross east arm: departs at the intersection's east exit,
      // return lane lands exactly on the east entry node.
      localId: 'harbor_e',
      templateId: 'avenue_two_way',
      from: [54, -158],
      to: [96, -158],
      speedLimit: 4.6,
      districtId: 'waterfront_north',
    },
    {
      localId: 'harbor_w',
      templateId: 'avenue_two_way',
      from: [42, -162],
      to: [-14, -162],
      speedLimit: 4.6,
      districtId: 'waterfront_north',
    },
    {
      localId: 'drive',
      templateId: 'avenue_two_way',
      from: [50, -232], // boulevard forward terminus
      to: [50, -300],
      speedLimit: 4.6,
      // Painted crosswalk to the promenade mouth (unsignalled).
      crossings: [{ localId: 'prom_walk', at: 0.88 }],
      districtId: 'waterfront_north',
    },
  ],
  crossStreets: [
    {
      localId: 'harbor_cross',
      center: [48, -160],
      districtId: 'waterfront_north',
    },
  ],
  lots: [],
  freeLots: [
    {
      localId: 'cafe',
      buildingTemplateId: 'cafe_shopfront',
      position: [-16, -289],
      facing: 'north',
      label: 'Shorefront Cafe',
      labelColor: '#ffe1b8',
      details: true,
    },
    {
      localId: 'pavilion',
      buildingTemplateId: 'kiosk_pavilion',
      position: [6, -290],
      facing: 'north',
      label: 'Pier Kiosk',
      labelColor: '#cfeaf4',
      details: true,
    },
    {
      localId: 'shop',
      buildingTemplateId: 'small_shop',
      position: [28, -289],
      facing: 'north',
      label: 'Bay Supply',
      labelColor: '#fff3c9',
      details: true,
    },
  ],
  linePropZones: [
    // Safety railing along the water's edge — the promenade's signature.
    {
      localId: 'railing',
      type: 'bollard',
      from: [-42, -313],
      to: [62, -313],
      spacing: 4,
    },
    // Tree line softens the east wall against the void — split around the
    // Main Street North avenue corridor (its asphalt crosses at z ≈ -300).
    { localId: 'tree_line_ne', type: 'tree', from: [68, -330], to: [68, -314], spacing: 12 },
    { localId: 'tree_line_se', type: 'tree', from: [68, -292], to: [68, -244], spacing: 12 },
  ],
  placedProps: [
    // Parks-department service truck at the drive's shoulder.
    { localId: 'service_truck', type: 'parked_truck', position: [57, -290], rotation: 0 },
  ],
  propZones: [
    {
      localId: 'promenade',
      templateId: 'waterfront_promenade',
      bounds: { minX: -34, maxX: 38, minZ: -311, maxZ: -297 },
      seed: 'wf-prom-v1',
    },
    {
      localId: 'lawn',
      templateId: 'park_greenery',
      bounds: { minX: -40, maxX: -2, minZ: -284, maxZ: -262 },
      seed: 'wf-lawn-v1',
    },
    {
      localId: 'lawn_west',
      templateId: 'park_greenery',
      bounds: { minX: -40, maxX: -8, minZ: -258, maxZ: -242 },
      seed: 'wf-lawn-west-v1',
    },
  ],
  citizenZones: [
    {
      localId: 'prom_walkers',
      templateId: 'sidewalk_walkers',
      points: [
        [-28, -304],
        [32, -304],
      ],
      bubbleLines: ['smell that? sea air.', 'best sunsets in the city.'],
    },
    { localId: 'idler_west', templateId: 'plaza_idlers', points: [[-8, -302]] },
    { localId: 'idler_east', templateId: 'plaza_idlers', points: [[20, -306]] },
    {
      localId: 'sitters',
      templateId: 'bench_sitters',
      points: [
        [-14, -306],
        [26, -303],
      ],
      bubbleLines: ['could watch the water all day.'],
    },
  ],
  traffic: [
    {
      localId: 'harbor_east',
      kind: 'destination',
      roadLocalId: 'harbor_e',
      lane: 'fwd',
      at: 0.5,
      destinationKind: 'commercial',
      weight: 1,
    },
    {
      localId: 'harbor_west',
      kind: 'destination',
      roadLocalId: 'harbor_w',
      lane: 'fwd',
      at: 0.5,
      destinationKind: 'commercial',
      weight: 1,
    },
    {
      localId: 'promenade',
      kind: 'destination',
      roadLocalId: 'drive',
      lane: 'fwd',
      at: 0.5,
      destinationKind: 'commercial',
      weight: 1,
    },
  ],
  plazas: [{ minX: -36, maxX: 40, minZ: -312, maxZ: -296 }],
  water: [{ minX: -44, maxX: 64, minZ: -336, maxZ: -314 }],
  greenbelts: [
    // Grass shoulder along the boulevard corridor between the gateway wall
    // and the waterfront area (the global ground plane ends near z -118).
    { minX: 36, maxX: 64, minZ: -238, maxZ: -114 },
    // Harbor Cross arms' shoulders.
    { minX: -22, maxX: 104, minZ: -172, maxZ: -148 },
    // Edge skirt: the sector never ends at a hard grass cliff.
    { minX: -56, maxX: 76, minZ: -348, maxZ: -236 },
  ],
  map: {
    label: 'Waterfront',
    order: 3,
    labelAnchor: [10, -325],
    landmarks: [{ localId: 'pier_kiosk', label: 'Pier Kiosk', icon: '⛱️', position: [6, -290] }],
  },
  ambienceKey: 'waterfront',
}

/** Compiled once at module load; consumed by cityLayout/roadGraphData/etc. */
export const WATERFRONT_GATEWAY = compileSectorAuthoringSpec(WATERFRONT_GATEWAY_SPEC)
