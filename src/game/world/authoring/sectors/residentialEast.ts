import type { SectorAuthoringSpec } from '../authoringTypes'
import { compileSectorAuthoringSpec } from '../sectorAuthoring'

/**
 * Residential East (sector s2_-1) — Main Street keeps going east and turns
 * into a neighborhood. The avenue is a collinear continuation of Main
 * Street East: its forward lane starts on the existing node (118, -96)
 * (MSE's forward terminus) and its return lane lands EXACTLY on
 * (118, -100) (MSE's back-lane start) — zero junction arcs, and MSE's own
 * turnaround remains as the U-turn option. A lower speed limit gives the
 * street its neighborhood pace. Future hook: house interiors reuse the
 * apartment location-mode flow.
 */
export const RESIDENTIAL_EAST_SPEC: SectorAuthoringSpec = {
  sectorId: 's2_-1',
  name: 'Residential East',
  districtIds: ['residential_east'],
  archetype: 'residential',
  area: { minX: 220, maxX: 300, minZ: -124, maxZ: -74 },
  wallOpenings: [{ side: 'west', from: -106, to: -90 }],
  roads: [
    {
      localId: 'east_ave',
      templateId: 'avenue_two_way',
      from: [118, -96], // existing node: Main Street East forward terminus
      to: [290, -96],
      speedLimit: 4.2,
      districtId: 'residential_east',
    },
  ],
  lots: [
    // North side (left of eastbound travel).
    { localId: 'n1', templateId: 'house_lot', roadLocalId: 'east_ave', side: 'left', at: 0.63, buildingTemplateId: 'residential_house', details: true },
    { localId: 'n2', templateId: 'house_lot', roadLocalId: 'east_ave', side: 'left', at: 0.7, buildingTemplateId: 'residential_house', details: true },
    { localId: 'n3', templateId: 'house_lot', roadLocalId: 'east_ave', side: 'left', at: 0.77, buildingTemplateId: 'residential_house', details: true },
    { localId: 'n4', templateId: 'storefront_lot', roadLocalId: 'east_ave', side: 'left', at: 0.85, buildingTemplateId: 'townhouse', details: true },
    // South side (right of eastbound travel).
    { localId: 's1', templateId: 'house_lot', roadLocalId: 'east_ave', side: 'right', at: 0.66, buildingTemplateId: 'residential_house', details: true },
    { localId: 's2', templateId: 'house_lot', roadLocalId: 'east_ave', side: 'right', at: 0.73, buildingTemplateId: 'residential_house', details: true },
    { localId: 's3', templateId: 'house_lot', roadLocalId: 'east_ave', side: 'right', at: 0.8, buildingTemplateId: 'residential_house', details: true },
  ],
  linePropZones: [
    // Street-tree hedges give the neighborhood its green edge.
    { localId: 'hedge_north', type: 'tree', from: [222, -116], to: [294, -116], spacing: 9 },
    { localId: 'hedge_south', type: 'tree', from: [226, -80.5], to: [266, -80.5], spacing: 10 },
    // Tree line softens the east wall against the void.
    { localId: 'tree_line_east', type: 'tree', from: [304, -118], to: [304, -80], spacing: 12 },
    // The avenue ends at a construction barricade — the city keeps growing.
    { localId: 'barricade', type: 'cone', from: [292.5, -101], to: [292.5, -95], spacing: 2 },
  ],
  propZones: [
    {
      localId: 'front_greens',
      templateId: 'residential_greens',
      bounds: { minX: 222, maxX: 296, minZ: -120, maxZ: -108 },
      seed: 'res-greens-v1',
    },
    {
      localId: 'park',
      templateId: 'park_greenery',
      bounds: { minX: 270, maxX: 296, minZ: -90, maxZ: -78 },
      seed: 'res-park-v1',
    },
    {
      // Parallel-parked cars in the front-yard strip between the north
      // sidewalk and the houses — rotated to lie along the street.
      localId: 'driveways',
      templateId: 'driveway_parking',
      bounds: { minX: 224, maxX: 286, minZ: -107.4, maxZ: -105.6 },
      seed: 'res-cars-v1',
      rotation: Math.PI / 2,
    },
    {
      localId: 'driveways_south',
      templateId: 'driveway_parking',
      bounds: { minX: 228, maxX: 276, minZ: -87.2, maxZ: -85.8 },
      seed: 'res-cars-south-v1',
      rotation: Math.PI / 2,
    },
  ],
  citizenZones: [
    {
      localId: 'walkers_north',
      templateId: 'sidewalk_walkers',
      points: [
        [224, -103.5],
        [288, -103.5],
      ],
      bubbleLines: ['quiet out here. love it.', 'the lawns are winning this year.'],
    },
    {
      localId: 'walkers_south',
      templateId: 'sidewalk_walkers',
      points: [
        [226, -92.5],
        [284, -92.5],
      ],
    },
    { localId: 'park_idler', templateId: 'plaza_idlers', points: [[282, -84]] },
    {
      localId: 'park_sitters',
      templateId: 'bench_sitters',
      points: [
        [276, -86],
        [290, -82],
      ],
      bubbleLines: ['best bench in the east.'],
    },
  ],
  traffic: [
    {
      localId: 'homes',
      kind: 'destination',
      roadLocalId: 'east_ave',
      lane: 'back',
      at: 0.35,
      destinationKind: 'residential',
      weight: 2,
    },
    {
      localId: 'east_row',
      kind: 'destination',
      roadLocalId: 'east_ave',
      lane: 'fwd',
      at: 0.75,
      destinationKind: 'residential',
      weight: 1,
    },
    {
      localId: 'east_end',
      kind: 'exit',
      roadLocalId: 'east_ave',
      lane: 'fwd',
      at: 0.9,
      destinationKind: 'districtExit',
      weight: 1,
    },
  ],
  plazas: [],
  greenbelts: [
    // The avenue's corridor between Main Street East and the neighborhood.
    { minX: 114, maxX: 220, minZ: -108, maxZ: -84 },
    // Edge skirt around the walled area.
    { minX: 208, maxX: 312, minZ: -136, maxZ: -66 },
  ],
  map: {
    label: 'Residential East',
    order: 5,
    labelAnchor: [258, -117],
    landmarks: [{ localId: 'green', label: 'The East Green', icon: '🌳', position: [282, -84] }],
  },
  ambienceKey: 'residential',
}

/** Compiled once at module load; consumed by cityLayout/roadGraphData/etc. */
export const RESIDENTIAL_EAST = compileSectorAuthoringSpec(RESIDENTIAL_EAST_SPEC)
