import type { InteractableDef } from '../game/interactables/interactableTypes'
import { NPC_DEFS } from './npcs'
import { APARTMENT_INTERACTABLE_POSITIONS } from '../game/interiors/apartmentLayout'
import { LOFT_INTERACTABLE_POSITIONS, LOFT_STREET_EXIT } from '../game/interiors/loftLayout'
import { PREMIUM_INTERACTABLE_POSITIONS, PREMIUM_STREET_EXIT } from '../game/interiors/premiumLayout'
import { STEALABLE_VEHICLES } from '../game/vehicles/vehicleCrimeState'
import { getMissionAnchor } from '../game/missions/missionAnchors'
import {
  getInterior,
  STORE_MAINST_INTERIOR,
  STORE_KIOSK_INTERIOR,
} from '../game/interiors/interiorRegistry'

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
  { id: 'apartment_furnish', kind: 'furnish', name: 'Furnish Home', position: APARTMENT_INTERACTABLE_POSITIONS.furnish, radius: 2.2, marker: true, icon: '🛋️', markerColor: '#e6a15e' },
  { id: 'apartment_host', kind: 'home_host', name: 'Host', position: APARTMENT_INTERACTABLE_POSITIONS.host, radius: 2.2, marker: true, icon: '🎉', markerColor: '#e07a5f' },
]

/**
 * Housing v1 (issue #17): the two upgrade-home city entrances + their interior
 * anchors (bed/wardrobe/storage/furnish/exit). The Starter Studio reuses the
 * existing `apartment` door + APARTMENT_INTERACTABLES. Interior anchors sit at each
 * home's far-off-grid coords, so the shared proximity system finds them only while
 * the player is inside that home. Furnish stations are wired in the furnishing slice.
 */
export const HOME_INTERACTABLES: InteractableDef[] = [
  {
    id: 'loft_entrance',
    kind: 'property_entrance',
    name: 'City Loft',
    position: [LOFT_STREET_EXIT[0], 0, LOFT_STREET_EXIT[2]],
    radius: 3,
    marker: true,
    icon: '🏙️',
    markerColor: '#7fb0d4',
    propertyId: 'city_loft',
  },
  {
    id: 'premium_entrance',
    kind: 'property_entrance',
    name: 'Premium Apartment',
    position: [PREMIUM_STREET_EXIT[0], 0, PREMIUM_STREET_EXIT[2]],
    radius: 3,
    marker: true,
    icon: '🏢',
    markerColor: '#c9a227',
    propertyId: 'premium_apartment',
  },
  // City Loft interior anchors.
  { id: 'loft_bed', kind: 'bed', name: 'Bed', position: LOFT_INTERACTABLE_POSITIONS.bed, radius: 2.4, marker: true, icon: '🛏️', markerColor: '#f2b263' },
  { id: 'loft_wardrobe', kind: 'wardrobe', name: 'Wardrobe', position: LOFT_INTERACTABLE_POSITIONS.wardrobe, radius: 2.2, marker: true, icon: '👕', markerColor: '#9a5fc0' },
  { id: 'loft_storage', kind: 'storage', name: 'Storage', position: LOFT_INTERACTABLE_POSITIONS.storage, radius: 2.2, marker: true, icon: '📦', markerColor: '#7fd4c1' },
  { id: 'loft_furnish', kind: 'furnish', name: 'Furnish Home', position: LOFT_INTERACTABLE_POSITIONS.furnish, radius: 2.4, marker: true, icon: '🛋️', markerColor: '#e6a15e' },
  { id: 'loft_host', kind: 'home_host', name: 'Host', position: LOFT_INTERACTABLE_POSITIONS.host, radius: 2.4, marker: true, icon: '🎉', markerColor: '#e07a5f' },
  { id: 'loft_exit', kind: 'apartment_exit', name: 'Leave Home', position: LOFT_INTERACTABLE_POSITIONS.exit, radius: 2.4, marker: true, icon: '🚪', markerColor: '#e07a5f' },
  // Premium Apartment interior anchors.
  { id: 'premium_bed', kind: 'bed', name: 'Bed', position: PREMIUM_INTERACTABLE_POSITIONS.bed, radius: 2.4, marker: true, icon: '🛏️', markerColor: '#f2b263' },
  { id: 'premium_wardrobe', kind: 'wardrobe', name: 'Wardrobe', position: PREMIUM_INTERACTABLE_POSITIONS.wardrobe, radius: 2.2, marker: true, icon: '👕', markerColor: '#9a5fc0' },
  { id: 'premium_storage', kind: 'storage', name: 'Storage', position: PREMIUM_INTERACTABLE_POSITIONS.storage, radius: 2.2, marker: true, icon: '📦', markerColor: '#7fd4c1' },
  { id: 'premium_furnish', kind: 'furnish', name: 'Furnish Home', position: PREMIUM_INTERACTABLE_POSITIONS.furnish, radius: 2.4, marker: true, icon: '🛋️', markerColor: '#e6a15e' },
  { id: 'premium_host', kind: 'home_host', name: 'Host', position: PREMIUM_INTERACTABLE_POSITIONS.host, radius: 2.4, marker: true, icon: '🎉', markerColor: '#e07a5f' },
  { id: 'premium_exit', kind: 'apartment_exit', name: 'Leave Home', position: PREMIUM_INTERACTABLE_POSITIONS.exit, radius: 2.4, marker: true, icon: '🚪', markerColor: '#e07a5f' },
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
const shelfDepotAnchor = getMissionAnchor('shelfrun_depot')!
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
  {
    id: 'shelf_depot',
    kind: 'mission_objective',
    name: 'Supply Depot',
    position: [shelfDepotAnchor.position[0], 0, shelfDepotAnchor.position[2]],
    radius: 2.6,
    marker: true,
    icon: '📦',
    markerColor: '#7fd4c1',
  },
]

// --- Store Robbery v1: exterior store doors + interior register/exit points ---
const mainstInterior = getInterior('store_mainst')!
const kioskInterior = getInterior('store_kiosk')!
export const STORE_INTERACTABLES: InteractableDef[] = [
  // Exterior entrances (city sidewalks).
  {
    id: 'store_mainst_entrance',
    kind: 'store_entrance',
    name: 'Main St Convenience',
    position: [mainstInterior.streetExit[0], 0, mainstInterior.streetExit[2]],
    radius: 2.4,
    marker: true,
    icon: '🏪',
    markerColor: '#c7b56a',
    interiorId: 'store_mainst',
  },
  {
    id: 'store_kiosk_entrance',
    kind: 'store_entrance',
    name: 'Waterfront Kiosk',
    position: [kioskInterior.streetExit[0], 0, kioskInterior.streetExit[2]],
    radius: 2.2,
    marker: true,
    icon: '🥤',
    markerColor: '#6ab0c7',
    interiorId: 'store_kiosk',
  },
  // Interior register + exit for the convenience store.
  {
    id: 'store_mainst_register',
    kind: 'store_register',
    name: 'Register',
    position: [STORE_MAINST_INTERIOR.register[0], 0, STORE_MAINST_INTERIOR.register[1]],
    radius: 2.2,
  },
  {
    id: 'store_mainst_exit',
    kind: 'store_exit',
    name: 'Exit',
    position: [mainstInterior.spawn[0], 0, mainstInterior.spawn[2] + 0.8],
    radius: 1.8,
  },
  // Interior register + exit for the kiosk.
  {
    id: 'store_kiosk_register',
    kind: 'store_register',
    name: 'Cashbox',
    position: [STORE_KIOSK_INTERIOR.register[0], 0, STORE_KIOSK_INTERIOR.register[1]],
    radius: 2.0,
  },
  {
    id: 'store_kiosk_exit',
    kind: 'store_exit',
    name: 'Exit',
    position: [kioskInterior.spawn[0], 0, kioskInterior.spawn[2] + 0.8],
    radius: 1.8,
  },
]

export const ALL_INTERACTABLES: InteractableDef[] = [
  ...STATIC_INTERACTABLES,
  ...APARTMENT_INTERACTABLES,
  ...HOME_INTERACTABLES,
  VEHICLE_INTERACTABLE,
  ...NPC_INTERACTABLES,
  ...STEAL_INTERACTABLES,
  ...MISSION_INTERACTABLES,
  ...STORE_INTERACTABLES,
]

export const INTERACTABLE_BY_ID: Record<string, InteractableDef> = Object.fromEntries(
  ALL_INTERACTABLES.map((i) => [i.id, i]),
)
