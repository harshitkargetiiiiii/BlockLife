import type { SectorAuthoringSpec } from '../authoringTypes'
import { compileSectorAuthoringSpec } from '../sectorAuthoring'

/**
 * Industrial Yard (sector s-1_-2) — freight district west of the North
 * Boulevard. The yard road is the kit's first WEST spur: it forks at the
 * boulevard's north terminus (50, -232) with `forkGap`, which emits a
 * diverge arc so the spur's lane pair starts clear of the corridor (a
 * direct attachment would end the return lane ON the boulevard's forward
 * lane). The return lane rejoins at (46, -232), the boulevard's back-lane
 * start. Future hook: delivery jobs target dest_s-1_-2_loading.
 */
export const INDUSTRIAL_YARD_SPEC: SectorAuthoringSpec = {
  sectorId: 's-1_-2',
  name: 'Industrial Yard',
  districtIds: ['industrial_west'],
  archetype: 'industrial',
  area: { minX: -206, maxX: -76, minZ: -296, maxZ: -218 },
  wallOpenings: [{ side: 'east', from: -238, to: -222 }],
  roads: [
    {
      localId: 'yard_rd',
      templateId: 'avenue_two_way',
      from: [50, -232], // existing node: North Boulevard forward terminus
      to: [-190, -232],
      rejoinAt: [46, -232], // existing node: boulevard back-lane start
      forkGap: 6,
      // Painted crosswalk linking the boulevard's west sidewalk to the
      // yard's south walk (workers on foot).
      crossings: [{ localId: 'gate_walk', at: 0.0417 }],
      speedLimit: 5,
      districtId: 'industrial_west',
    },
  ],
  lots: [
    // All frontage on the north side (right of westbound travel) — the
    // south strip is too shallow for industrial lots inside the cell.
    { localId: 'w1', templateId: 'industrial_lot', roadLocalId: 'yard_rd', side: 'right', at: 0.54, buildingTemplateId: 'warehouse', label: 'Yard 12', labelColor: '#ffd27f', details: true },
    { localId: 'w2', templateId: 'industrial_lot', roadLocalId: 'yard_rd', side: 'right', at: 0.63, buildingTemplateId: 'depot', details: true },
    { localId: 'w3', templateId: 'industrial_lot', roadLocalId: 'yard_rd', side: 'right', at: 0.72, buildingTemplateId: 'warehouse', details: true },
    { localId: 'w4', templateId: 'industrial_lot', roadLocalId: 'yard_rd', side: 'right', at: 0.81, buildingTemplateId: 'depot', details: true },
    { localId: 'w5', templateId: 'industrial_lot', roadLocalId: 'yard_rd', side: 'right', at: 0.9, buildingTemplateId: 'warehouse', details: true },
  ],
  linePropZones: [
    // Loading-zone cones pace the dock frontage.
    { localId: 'dock_cones', type: 'cone', from: [-168, -236], to: [-92, -236], spacing: 12 },
    // Work lights behind the warehouse row (night shift).
    { localId: 'work_lights', type: 'street_lamp', from: [-170, -252], to: [-90, -252], spacing: 20 },
    // Tree line softens the west wall against the void.
    { localId: 'tree_line_west', type: 'tree', from: [-210, -290], to: [-210, -224], spacing: 14 },
    // The yard road ends at a construction barricade.
    { localId: 'barricade', type: 'cone', from: [-192.5, -235], to: [-192.5, -225], spacing: 2.5 },
  ],
  placedProps: [
    { localId: 'dumpster_east', type: 'dumpster', position: [-100, -256], rotation: 0 },
    { localId: 'dumpster_west', type: 'dumpster', position: [-146, -258], rotation: Math.PI / 2 },
  ],
  propZones: [
    {
      localId: 'south_clutter',
      templateId: 'industrial_clutter',
      bounds: { minX: -200, maxX: -90, minZ: -222.4, maxZ: -218.4 },
      seed: 'yard-clutter-v1',
    },
    {
      localId: 'north_clutter',
      templateId: 'industrial_clutter',
      bounds: { minX: -200, maxX: -160, minZ: -266, maxZ: -254 },
      seed: 'yard-north-v1',
    },
    {
      // Parked trucks behind the depots, long axis along the yard road.
      localId: 'trucks',
      templateId: 'truck_row',
      bounds: { minX: -158, maxX: -104, minZ: -262, maxZ: -256 },
      seed: 'yard-trucks-v1',
      rotation: Math.PI / 2,
    },
    {
      localId: 'west_yard',
      templateId: 'industrial_clutter',
      bounds: { minX: -202, maxX: -172, minZ: -290, maxZ: -268 },
      seed: 'yard-west-v1',
    },
  ],
  citizenZones: [
    {
      localId: 'freight',
      templateId: 'freight_workers',
      points: [
        [-140, -254],
        [-120, -254],
      ],
      bubbleLines: ['manifest says forty crates.', 'that pallet is NOT mine.'],
    },
    {
      localId: 'dock_walk',
      templateId: 'freight_workers',
      points: [
        [-100, -249.5],
        [-88, -249.5],
      ],
      bubbleLines: ['night shift starts at ten.'],
    },
  ],
  traffic: [
    {
      localId: 'loading',
      kind: 'destination',
      roadLocalId: 'yard_rd',
      lane: 'fwd',
      at: 0.7,
      destinationKind: 'industrial',
      weight: 2,
    },
    {
      localId: 'west_end',
      kind: 'exit',
      roadLocalId: 'yard_rd',
      lane: 'fwd',
      at: 0.88,
      destinationKind: 'districtExit',
      weight: 1,
    },
  ],
  plazas: [],
  greenbelts: [
    // Grass shoulder along the yard-road corridor east of the walled area.
    { minX: -76, maxX: 42, minZ: -244, maxZ: -216 },
    // Edge skirt around the walled area.
    { minX: -214, maxX: -66, minZ: -306, maxZ: -210 },
  ],
  map: {
    label: 'Industrial Yard',
    order: 6,
    labelAnchor: [-140, -282],
    landmarks: [{ localId: 'yard12', label: 'Yard 12', icon: '📦', position: [-166, -244] }],
  },
  ambienceKey: 'industrial',
}

/** Compiled once at module load; consumed by cityLayout/roadGraphData/etc. */
export const INDUSTRIAL_YARD = compileSectorAuthoringSpec(INDUSTRIAL_YARD_SPEC)
