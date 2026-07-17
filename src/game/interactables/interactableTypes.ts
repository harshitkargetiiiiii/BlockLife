import type { Vec3 } from '../world/worldTypes'

export type InteractableKind =
  | 'apartment'
  | 'food_truck'
  | 'gym'
  | 'job_board'
  | 'npc'
  | 'vehicle'
  /** A parked civilian vehicle the player can steal (Crime v1). */
  | 'steal_vehicle'
  // Apartment interior (Home Base v1)
  | 'bed'
  | 'wardrobe'
  | 'storage'
  | 'apartment_exit'
  /** Mission & Activity Framework v1: a mission giver/fixer (offer + handoff). */
  | 'mission_offer'
  /** Mission & Activity Framework v1: a mission objective point (pickup, etc). */
  | 'mission_objective'

export interface InteractableDef {
  id: string
  kind: InteractableKind
  name: string
  /** Static world position. Dynamic interactables (NPCs, vehicle) resolve at runtime. */
  position?: Vec3
  /** 'npc' reads from the NPC position registry, 'vehicle' from the vehicle body. */
  dynamic?: 'npc' | 'vehicle'
  radius: number
  /** Render a floating marker + ground ring at the position. */
  marker?: boolean
  icon?: string
  markerColor?: string
}

export interface ActivityAction {
  id: string
  label: string
  detail: string
  disabled?: boolean
  disabledReason?: string
}
