import type { SectorAuthoringSpec } from '../authoringTypes'
import { compileSectorAuthoringSpec } from '../sectorAuthoring'

/**
 * Main Street North (sector s1_-2) — dense commercial continuation of the
 * downtown corridor. The avenue forks EAST at Waterfront Drive's north
 * terminus: its forward lane starts on the node (50, -300) and the return
 * lane rejoins at (46, -300) (the drive's back-lane start) through a merge
 * arc — the proven Main Street East attachment pattern, one block north.
 */
export const MAIN_STREET_NORTH_SPEC: SectorAuthoringSpec = {
  sectorId: 's1_-2',
  name: 'Main Street North',
  districtIds: ['downtown_north'],
  archetype: 'downtown',
  area: { minX: 74, maxX: 156, minZ: -332, maxZ: -278 },
  wallOpenings: [{ side: 'west', from: -310, to: -294 }],
  roads: [
    {
      localId: 'north_ave',
      templateId: 'avenue_two_way',
      from: [50, -300], // existing node: waterfront drive forward terminus
      to: [150, -300],
      rejoinAt: [46, -300], // existing node: drive back-lane start
      districtId: 'downtown_north',
    },
  ],
  lots: [
    // North side (left of eastbound travel).
    { localId: 'n1', templateId: 'tower_lot', roadLocalId: 'north_ave', side: 'left', at: 0.3, buildingTemplateId: 'office_tower', label: 'North Exchange', labelColor: '#cfe3ff', details: true },
    { localId: 'n2', templateId: 'storefront_lot', roadLocalId: 'north_ave', side: 'left', at: 0.5, buildingTemplateId: 'cafe_shopfront', label: 'North Perk', labelColor: '#ffdf9e', details: true },
    { localId: 'n3', templateId: 'tower_lot', roadLocalId: 'north_ave', side: 'left', at: 0.72, buildingTemplateId: 'mixed_use_block', details: true },
    // South side (right of eastbound travel).
    { localId: 's1', templateId: 'storefront_lot', roadLocalId: 'north_ave', side: 'right', at: 0.4, buildingTemplateId: 'small_shop', label: 'North Mart', labelColor: '#fff3c9', details: true },
    { localId: 's2', templateId: 'storefront_lot', roadLocalId: 'north_ave', side: 'right', at: 0.6, buildingTemplateId: 'townhouse', details: true },
    { localId: 's3', templateId: 'tower_lot', roadLocalId: 'north_ave', side: 'right', at: 0.85, buildingTemplateId: 'mixed_use_block', details: true },
  ],
  linePropZones: [
    // Tree line softens the north wall against the void.
    { localId: 'tree_line_north', type: 'tree', from: [80, -336], to: [152, -336], spacing: 14 },
  ],
  placedProps: [
    // Morning delivery van outside North Mart.
    { localId: 'delivery_van', type: 'parked_truck', position: [79, -288], rotation: Math.PI / 2 },
  ],
  propZones: [
    {
      localId: 'walk_furniture',
      templateId: 'sidewalk_furniture',
      bounds: { minX: 78, maxX: 148, minZ: -311, maxZ: -293 },
      seed: 'msn-walk-v1',
    },
    {
      localId: 'plaza_decor',
      templateId: 'plaza_decor',
      bounds: { minX: 120, maxX: 152, minZ: -330, maxZ: -318 },
      seed: 'msn-plaza-v1',
    },
    {
      localId: 'north_walk',
      templateId: 'sidewalk_furniture',
      bounds: { minX: 78, maxX: 148, minZ: -322, maxZ: -310 },
      seed: 'msn-north-v1',
    },
  ],
  citizenZones: [
    {
      localId: 'walkers',
      templateId: 'sidewalk_walkers',
      // South sidewalk of the avenue.
      points: [
        [80, -296.5],
        [140, -296.5],
      ],
      bubbleLines: ['uptown keeps growing.', 'coffee first, meetings later.'],
    },
    { localId: 'plaza_idler', templateId: 'plaza_idlers', points: [[136, -324]] },
    {
      localId: 'perk_queue',
      templateId: 'shop_queue',
      points: [
        [99, -309.7],
        [101.2, -309.7],
      ],
      bubbleLines: ['the flat whites here...', 'line moves fast, promise.'],
    },
  ],
  traffic: [
    {
      localId: 'north_row',
      kind: 'destination',
      roadLocalId: 'north_ave',
      lane: 'fwd',
      at: 0.55,
      destinationKind: 'commercial',
      weight: 2,
    },
    {
      localId: 'north_end',
      kind: 'exit',
      roadLocalId: 'north_ave',
      lane: 'fwd',
      at: 0.88,
      destinationKind: 'districtExit',
      weight: 1,
    },
  ],
  plazas: [{ minX: 120, maxX: 152, minZ: -330, maxZ: -318 }],
  greenbelts: [
    // Edge skirt around the walled area.
    { minX: 62, maxX: 168, minZ: -344, maxZ: -266 },
  ],
  map: {
    label: 'Main St North',
    order: 4,
    labelAnchor: [115, -316],
    landmarks: [{ localId: 'exchange', label: 'North Exchange', icon: '🏢', position: [80, -316] }],
  },
  ambienceKey: 'downtown',
}

/** Compiled once at module load; consumed by cityLayout/roadGraphData/etc. */
export const MAIN_STREET_NORTH = compileSectorAuthoringSpec(MAIN_STREET_NORTH_SPEC)
