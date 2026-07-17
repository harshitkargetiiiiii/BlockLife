import type { InteractableDef } from '../game/interactables/interactableTypes'
import { NPC_DEFS } from './npcs'
import { APARTMENT_INTERACTABLE_POSITIONS } from '../game/interiors/apartmentLayout'
import { STEALABLE_VEHICLES } from '../game/vehicles/vehicleCrimeState'
import { getMissionAnchor } from '../game/missions/missionAnchors'

/**
 * Static interaction points sit in front of their building/prop. NPCs and the
 * drivable car resolve their positions from the runtime registry.
 */
export const STATIC_INTERACTABLES: InteractableDef[] = [
  {
    id: 'apartment',
    kind: 'apartment',
    name: 'Your Apartment',
    position: [-12.5, 0, -9],
    radius: 3,
    marker: true,
    icon: '🛏️',
    markerColor: '#f2b263',
  },
  {
    id: 'food_truck_01',
    kind: 'food_truck',
    name: "Maya's Snack Truck",
    position: [1.5, 0, -4.4],
    radius: 2.8,
    marker: true,
    icon: '🌮',
    markerColor: '#ff8f5e',
  },
  {
    id: 'gym',
    kind: 'gym',
    name: 'Block Gym',
    position: [14, 0, -9.2],
    radius: 3,
    marker: true,
    icon: '💪',
    markerColor: '#ffd166',
  },
  {
    id: 'job_board',
    kind: 'job_board',
    name: 'Job Board',
    position: [11, 0, -4.5],
    radius: 2.4,
    marker: true,
    icon: '📋',
    markerColor: '#7fd4c1',
  },
]

/**
 * Apartment interior interaction points (Home Base v1). They live at the
 * interior's remote world coordinates, so the shared proximity system finds
 * them only while the player is actually inside.
 */
export const APARTMENT_INTERACTABLES: InteractableDef[] = [
  {
    id: 'apartment_bed',
    kind: 'bed',
    name: 'Bed',
    position: APARTMENT_INTERACTABLE_POSITIONS.bed,
    radius: 2.4,
    marker: true,
    icon: '🛏️',
    markerColor: '#f2b263',
  },
  {
    id: 'apartment_wardrobe',
    kind: 'wardrobe',
    name: 'Wardrobe & Mirror',
    position: APARTMENT_INTERACTABLE_POSITIONS.wardrobe,
    radius: 2.2,
    marker: true,
    icon: '👕',
    markerColor: '#9a5fc0',
  },
  {
    id: 'apartment_storage',
    kind: 'storage',
    name: 'Storage Chest',
    position: APARTMENT_INTERACTABLE_POSITIONS.storage,
    radius: 2.2,
    marker: true,
    icon: '📦',
    markerColor: '#7fd4c1',
  },
  {
    id: 'apartment_exit',
    kind: 'apartment_exit',
    name: 'Leave Apartment',
    position: APARTMENT_INTERACTABLE_POSITIONS.exit,
    radius: 2.4,
    marker: true,
    icon: '🚪',
    markerColor: '#e07a5f',
  },
]

export const VEHICLE_INTERACTABLE: InteractableDef = {
  id: 'vehicle_compact_car_01',
  kind: 'vehicle',
  name: 'Compact Car',
  dynamic: 'vehicle',
  radius: 3.2,
  icon: '🚗',
}

export const NPC_INTERACTABLES: InteractableDef[] = NPC_DEFS.map((npc) => ({
  id: npc.id,
  kind: 'npc' as const,
  name: npc.name,
  dynamic: 'npc' as const,
  radius: 2.3,
}))

/** Parked civilian vehicles the player can steal (Crime & Law v1). */
export const STEAL_INTERACTABLES: InteractableDef[] = STEALABLE_VEHICLES.map((v) => {
  const occupied = v.access === 'civilian_occupied'
  return {
    id: v.id,
    kind: 'steal_vehicle' as const,
    // The prompt identifies an occupied car so the player knows it's a carjack.
    name: occupied ? 'Occupied Car' : 'Parked Car',
    position: [v.position[0], 0.8, v.position[1]] as [number, number, number],
    radius: 2.6,
    marker: true,
    icon: occupied ? '🚙' : '🚗',
    markerColor: occupied ? '#e8871e' : '#d1495b',
  }
})

/**
 * Mission interaction points (Mission & Activity Framework v1). Their positions
 * derive from the single authored mission anchors — never re-hardcoded here.
 * The courier depot is a lawful pickup; the fixer offers + receives Hot Cargo.
 */
const courierDepotAnchor = getMissionAnchor('courier_depot')!
const fixerAnchor = getMissionAnchor('hotcargo_garage')!
export const MISSION_INTERACTABLES: InteractableDef[] = [
  {
    id: 'courier_depot',
    kind: 'mission_objective',
    name: 'Courier Depot',
    position: [courierDepotAnchor.position[0], 0, courierDepotAnchor.position[2]],
    radius: 2.6,
    marker: true,
    icon: '📦',
    markerColor: '#7fd4c1',
  },
  {
    id: 'hotcargo_fixer',
    kind: 'mission_offer',
    name: "Fixer's Garage",
    position: [fixerAnchor.position[0], 0, fixerAnchor.position[2]],
    radius: 3,
    marker: true,
    icon: '🔧',
    markerColor: '#e8871e',
  },
]

export const ALL_INTERACTABLES: InteractableDef[] = [
  ...STATIC_INTERACTABLES,
  ...APARTMENT_INTERACTABLES,
  VEHICLE_INTERACTABLE,
  ...NPC_INTERACTABLES,
  ...STEAL_INTERACTABLES,
  ...MISSION_INTERACTABLES,
]

export const INTERACTABLE_BY_ID: Record<string, InteractableDef> = Object.fromEntries(
  ALL_INTERACTABLES.map((i) => [i.id, i]),
)
