import type { SectorAuthoringSpec } from '../authoringTypes'
import { compileSectorAuthoringSpec } from '../sectorAuthoring'

/**
 * Main Street East (sector s1_-1) — the District Authoring Kit proof
 * sector. Authored almost entirely through templates: one avenue forking
 * east off the Downtown Gateway's north end (existing node (50, -96)),
 * five template buildings on frontage lots, a plaza, seeded prop scatter,
 * one citizen zone and one traffic destination.
 *
 * The forward lane STARTS on the existing graph node at (50, -96)
 * (gate_nb's end) and the return lane REJOINS at (46, -96) (gate_sb's
 * start) — the road attaches to the network by exact node adjacency,
 * touching zero existing segment ids.
 */
export const MAIN_STREET_EAST_SPEC: SectorAuthoringSpec = {
  sectorId: 's1_-1',
  name: 'Main Street East',
  districtIds: ['downtown_gateway'],
  archetype: 'downtown',
  area: { minX: 74, maxX: 126, minZ: -122, maxZ: -76 },
  wallOpenings: [{ side: 'west', from: -104, to: -92 }],
  roads: [
    {
      localId: 'main_st',
      // Painted crosswalk: gateway plaza to the north boulevard sidewalk.
      crossings: [{ localId: 'plaza_walk', at: 0.15 }],
      templateId: 'avenue_two_way',
      from: [50, -96], // existing node: gate_nb end
      to: [118, -96],
      rejoinAt: [46, -96], // existing node: gate_sb start
      districtId: 'downtown_gateway',
    },
  ],
  lots: [
    // North side (left of eastbound travel).
    { localId: 'n1', templateId: 'tower_lot', roadLocalId: 'main_st', side: 'left', at: 0.45, buildingTemplateId: 'office_tower', label: 'Main St Offices', labelColor: '#cfe3ff', details: true },
    { localId: 'n2', templateId: 'storefront_lot', roadLocalId: 'main_st', side: 'left', at: 0.62, buildingTemplateId: 'cafe_shopfront', label: 'Corner Beans', labelColor: '#ffdf9e', details: true },
    { localId: 'n3', templateId: 'tower_lot', roadLocalId: 'main_st', side: 'left', at: 0.82, buildingTemplateId: 'mixed_use_block', details: true },
    // South side (right of eastbound travel).
    { localId: 's1', templateId: 'storefront_lot', roadLocalId: 'main_st', side: 'right', at: 0.52, buildingTemplateId: 'small_shop', label: 'Main St Mart', labelColor: '#fff3c9', details: true },
    { localId: 's2', templateId: 'storefront_lot', roadLocalId: 'main_st', side: 'right', at: 0.72, buildingTemplateId: 'townhouse', details: true },
  ],
  placedProps: [
    // Delivery van tucked behind the office block.
    { localId: 'delivery_van', type: 'parked_truck', position: [78, -120], rotation: Math.PI / 2 },
  ],
  propZones: [
    {
      localId: 'walk_furniture',
      templateId: 'sidewalk_furniture',
      bounds: { minX: 78, maxX: 116, minZ: -107, maxZ: -89 },
      seed: 'main-street-v1',
    },
    {
      localId: 'plaza_decor',
      templateId: 'plaza_decor',
      bounds: { minX: 100, maxX: 122, minZ: -120, maxZ: -110 },
      seed: 'main-plaza-v1',
    },
    {
      localId: 'walk_east',
      templateId: 'sidewalk_furniture',
      bounds: { minX: 100, maxX: 113, minZ: -108, maxZ: -90 },
      seed: 'mse-east-v1',
    },
  ],
  citizenZones: [
    {
      localId: 'walkers',
      templateId: 'sidewalk_walkers',
      // South sidewalk of the avenue.
      points: [
        [80, -92.2],
        [112, -92.2],
      ],
      bubbleLines: ['main street is waking up.', 'new block, who dis?'],
    },
    {
      localId: 'beans_queue',
      templateId: 'shop_queue',
      points: [
        [91, -105.6],
        [93.2, -105.6],
      ],
      bubbleLines: ['double shot. always.'],
    },
  ],
  traffic: [
    {
      localId: 'main_row',
      kind: 'destination',
      roadLocalId: 'main_st',
      lane: 'fwd',
      at: 0.6,
      destinationKind: 'commercial',
      weight: 2,
    },
  ],
  plazas: [{ minX: 100, maxX: 122, minZ: -120, maxZ: -110 }],
  map: {
    label: 'Main St',
    order: 2,
    landmarks: [{ localId: 'beans', label: 'Corner Beans', icon: '☕', position: [92, -110] }],
  },
  ambienceKey: 'commercial',
}

/** Compiled once at module load; consumed by cityLayout/roadGraphData/etc. */
export const MAIN_STREET_EAST = compileSectorAuthoringSpec(MAIN_STREET_EAST_SPEC)
