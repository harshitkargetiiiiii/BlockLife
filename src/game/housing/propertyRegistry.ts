/**
 * Canonical property + slot registry (issue #17 §1/§6). Three meaningful tiers,
 * each a real interior with a distinct entrance, authored furniture slots, fixed
 * fixtures, base metrics, and lease economics. Slot positions are LOCAL to the
 * interior origin (added to `getInterior(...).origin` by the renderer/runtime), so
 * the same authored shape works at any far-off-grid interior.
 *
 * Economics (validated in tests, tuned against the merged career economy — see
 * docs/HOUSING_FURNITURE_AND_PROPERTY.md): shift pay is base×rank×perf with bases
 * $35–50 and rank ×1.0/1.3/1.6/2.0. Rents ($120 / $260 / $500 per 7 game days)
 * stay coverable by the eligible rank WITHOUT inflating pay.
 */
import { ROOM_WIDTH as SS_W, ROOM_DEPTH as SS_D } from '../interiors/apartmentLayout'
import { LOFT_ROOM_WIDTH, LOFT_ROOM_DEPTH } from '../interiors/loftLayout'
import { PREMIUM_ROOM_WIDTH, PREMIUM_ROOM_DEPTH } from '../interiors/premiumLayout'
import { getInterior } from '../interiors/interiorRegistry'
import { RANK_ORDER } from '../careers/careerTypes'
import {
  FURNITURE_CATEGORIES,
  RENT_PERIOD_DAYS,
  RECENT_INCOME_WINDOW_DAYS,
  sizeFits,
  type FixtureDef,
  type FurnitureCategory,
  type PropertyDef,
  type PropertyId,
  type SlotDef,
  type SizeClass,
} from './housingTypes'

const R4 = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
const R2 = [0, Math.PI]

/** Compact slot authoring helper. Positions/clearances are LOCAL to the origin. */
function slot(
  propertyId: PropertyId,
  id: string,
  room: string,
  local: [number, number],
  cats: FurnitureCategory[],
  maxSize: SizeClass,
  clearance: [number, number],
  opts: { baseRotationY?: number; allowedRotations?: number[]; fixtureOnly?: boolean } = {},
): SlotDef {
  return {
    id,
    propertyId,
    room,
    local,
    baseRotationY: opts.baseRotationY ?? 0,
    allowedCategories: cats,
    maxSize,
    allowedRotations: opts.allowedRotations ?? R4,
    clearance,
    fixtureOnly: opts.fixtureOnly,
  }
}

function fixture(id: string, category: FurnitureCategory, comfort: number, style: number, extra: Partial<FixtureDef> = {}): FixtureDef {
  return { id, category, comfort, style, ...extra }
}

// ---- Starter Studio — the migrated/default apartment (interior 'apartment') ----
// The Studio REUSES the hand-authored ApartmentInterior furniture as fixed FIXTURES
// (base comfort/style/sleep — no visual change). Its player-furniture slots sit in the
// open floor so a placed accent piece never overlaps a fixture; the full furnish loop
// (beds/storage/wardrobes) lives in the empty Loft & Premium shells. (issue §4)
const STARTER_SLOTS: SlotDef[] = [
  slot('starter_studio', 'ss_accent_a', 'Living', [-2.2, 1.4], ['lighting', 'decor'], 'small', [0.55, 0.55]),
  slot('starter_studio', 'ss_accent_b', 'Living', [1.4, 2.4], ['seating', 'decor'], 'small', [0.75, 0.75]),
  slot('starter_studio', 'ss_accent_c', 'Living', [-4.0, -0.2], ['lighting', 'decor'], 'small', [0.55, 0.55]),
  slot('starter_studio', 'ss_accent_d', 'Living', [-0.4, 3.0], ['decor'], 'small', [0.5, 0.5]),
]

// ---- City Loft (interior 'city_loft', 14×11) ----
const LOFT_SLOTS: SlotDef[] = [
  slot('city_loft', 'lf_bed', 'Bedroom', [-4.6, -3.5], ['bed'], 'large', [1.4, 2.0]),
  slot('city_loft', 'lf_wardrobe', 'Bedroom', [-1.6, -4.6], ['wardrobe'], 'large', [1.1, 0.5], { allowedRotations: R2 }),
  slot('city_loft', 'lf_bedside', 'Bedroom', [-6.2, 0.6], ['lighting', 'decor', 'storage'], 'small', [0.6, 0.6]),
  slot('city_loft', 'lf_ent', 'Living', [1.4, -4.7], ['entertainment'], 'medium', [1.1, 0.35], { allowedRotations: R2 }),
  slot('city_loft', 'lf_sofa', 'Living', [1.6, -1.4], ['seating'], 'large', [1.4, 1.0]),
  slot('city_loft', 'lf_coffee', 'Living', [1.6, 0.8], ['table'], 'small', [0.9, 0.9]),
  slot('city_loft', 'lf_storage', 'Living', [5.6, -3.0], ['storage'], 'large', [0.9, 0.8]),
  slot('city_loft', 'lf_dining', 'Dining', [4.4, 1.6], ['table'], 'large', [1.3, 1.1]),
  slot('city_loft', 'lf_decor', 'Living', [-5.6, 2.4], ['lighting', 'decor'], 'medium', [0.7, 0.7]),
]

// ---- Premium Apartment (interior 'premium_apartment', 17×13) ----
const PREMIUM_SLOTS: SlotDef[] = [
  slot('premium_apartment', 'pr_bed', 'Bedroom', [-5.6, -4.3], ['bed'], 'large', [1.5, 2.1]),
  slot('premium_apartment', 'pr_wardrobe', 'Bedroom', [-2.0, -5.6], ['wardrobe'], 'large', [1.2, 0.5], { allowedRotations: R2 }),
  slot('premium_apartment', 'pr_bedside', 'Bedroom', [-7.4, -1.6], ['lighting', 'decor', 'storage'], 'small', [0.6, 0.6]),
  slot('premium_apartment', 'pr_ent', 'Living', [1.6, -5.7], ['entertainment'], 'medium', [1.2, 0.35], { allowedRotations: R2 }),
  slot('premium_apartment', 'pr_sofa', 'Living', [1.8, -2.0], ['seating'], 'large', [1.5, 1.1]),
  slot('premium_apartment', 'pr_armchair', 'Living', [4.6, -2.2], ['seating', 'decor'], 'medium', [1.0, 1.0]),
  slot('premium_apartment', 'pr_coffee', 'Living', [1.8, 0.4], ['table'], 'small', [0.9, 0.9]),
  slot('premium_apartment', 'pr_media', 'Living', [-2.0, -2.0], ['entertainment', 'decor'], 'small', [0.7, 0.7]),
  slot('premium_apartment', 'pr_storage', 'Living', [7.0, -3.6], ['storage'], 'large', [1.0, 0.9]),
  slot('premium_apartment', 'pr_dining', 'Dining', [5.2, 2.0], ['table'], 'large', [1.4, 1.2]),
  slot('premium_apartment', 'pr_decor_a', 'Living', [-6.8, 2.8], ['lighting', 'decor'], 'medium', [0.7, 0.7]),
  slot('premium_apartment', 'pr_decor_b', 'Entry', [6.4, 4.2], ['lighting', 'decor'], 'small', [0.6, 0.6]),
]

export const PROPERTY_SLOTS: Record<PropertyId, SlotDef[]> = {
  starter_studio: STARTER_SLOTS,
  city_loft: LOFT_SLOTS,
  premium_apartment: PREMIUM_SLOTS,
}

/** Room inner dims per property (for slot-bounds validation). */
const ROOM_DIMS: Record<PropertyId, { width: number; depth: number }> = {
  starter_studio: { width: SS_W, depth: SS_D },
  city_loft: { width: LOFT_ROOM_WIDTH, depth: LOFT_ROOM_DEPTH },
  premium_apartment: { width: PREMIUM_ROOM_WIDTH, depth: PREMIUM_ROOM_DEPTH },
}

function nonFixtureSlotCount(id: PropertyId): number {
  return PROPERTY_SLOTS[id].filter((s) => !s.fixtureOnly).length
}

export const PROPERTY_DEFS: readonly PropertyDef[] = [
  {
    id: 'starter_studio',
    tier: 'starter',
    displayName: 'Starter Studio',
    description: 'Your compact studio in the central residential blocks. Small, but yours.',
    listingCopy: 'A cozy studio to start out. Low rent, no deposit — a safe first home.',
    district: 'Central Residential',
    interiorId: 'apartment',
    entranceInteractableId: 'apartment',
    baseStorageCapacity: 40,
    maxFurnitureAssets: nonFixtureSlotCount('starter_studio'),
    hostingCapacity: 2,
    baseComfort: 12,
    baseStyle: 8,
    baseSleepQuality: 50,
    deposit: 0,
    rent: 120,
    rentPeriodDays: RENT_PERIOD_DAYS,
    requirement: {},
    tourRequired: false,
    fixtures: [fixture('ss_window', 'decor', 2, 3), fixture('ss_kitchenette', 'decor', 3, 2)],
    sourceRef: { file: 'src/game/housing/propertyRegistry.ts', symbol: 'starter_studio' },
  },
  {
    id: 'city_loft',
    tier: 'loft',
    displayName: 'City Loft',
    description: 'A bright downtown loft with room to actually live — and host.',
    listingCopy: 'Open-plan downtown loft. More space, a real living area, and a dining nook.',
    district: 'Downtown Gateway',
    interiorId: 'city_loft',
    entranceInteractableId: 'loft_entrance',
    baseStorageCapacity: 48,
    maxFurnitureAssets: nonFixtureSlotCount('city_loft'),
    hostingCapacity: 3,
    baseComfort: 20,
    baseStyle: 18,
    baseSleepQuality: 55,
    deposit: 600,
    rent: 260,
    rentPeriodDays: RENT_PERIOD_DAYS,
    requirement: { minRank: 'regular' },
    tourRequired: true,
    fixtures: [
      fixture('lf_windows', 'decor', 3, 6),
      fixture('lf_kitchen', 'decor', 4, 4),
      fixture('lf_balcony', 'decor', 3, 3),
    ],
    sourceRef: { file: 'src/game/housing/propertyRegistry.ts', symbol: 'city_loft' },
  },
  {
    id: 'premium_apartment',
    tier: 'premium',
    displayName: 'Premium Apartment',
    description: 'A high-floor apartment in the east quarter. The view alone sells it.',
    listingCopy: 'Top-tier apartment: floor-to-ceiling glass, ensuite, and space for the whole crew.',
    district: 'East Residential',
    interiorId: 'premium_apartment',
    entranceInteractableId: 'premium_entrance',
    baseStorageCapacity: 60,
    maxFurnitureAssets: nonFixtureSlotCount('premium_apartment'),
    hostingCapacity: 4,
    baseComfort: 30,
    baseStyle: 30,
    baseSleepQuality: 60,
    deposit: 1500,
    rent: 500,
    rentPeriodDays: RENT_PERIOD_DAYS,
    requirement: { minRank: 'experienced', minRecentCareerIncome: 250, recentIncomeWindowDays: RECENT_INCOME_WINDOW_DAYS },
    tourRequired: true,
    fixtures: [
      fixture('pr_windows', 'decor', 4, 8),
      fixture('pr_ensuite', 'decor', 6, 5),
      fixture('pr_island', 'decor', 5, 6),
    ],
    sourceRef: { file: 'src/game/housing/propertyRegistry.ts', symbol: 'premium_apartment' },
  },
]

const BY_ID: Record<string, PropertyDef> = Object.fromEntries(PROPERTY_DEFS.map((p) => [p.id, p]))

export function getProperty(id: PropertyId): PropertyDef | undefined {
  return BY_ID[id]
}

export function getPropertySlots(id: PropertyId): SlotDef[] {
  return PROPERTY_SLOTS[id] ?? []
}

export function getSlot(propertyId: PropertyId, slotId: string): SlotDef | undefined {
  return PROPERTY_SLOTS[propertyId]?.find((s) => s.id === slotId)
}

/** The default/starter property a new or migrated game lives in. */
export const DEFAULT_PROPERTY_ID: PropertyId = 'starter_studio'

/**
 * Validate the whole registry (issue §1 "prove every entrance, interior, fixture,
 * slot, required career rank, and referenced furniture category is valid").
 * Returns the list of problems; empty = valid. Exercised by unit tests. Entrance
 * INTERACTABLE existence is proven separately (validatePropertyEntrances) so this
 * pure check has no dependency on the interactable data graph.
 */
export function validatePropertyRegistry(): string[] {
  const errors: string[] = []
  const seenProp = new Set<string>()
  const seenSlot = new Set<string>()
  for (const p of PROPERTY_DEFS) {
    if (seenProp.has(p.id)) errors.push(`property "${p.id}": duplicate id`)
    seenProp.add(p.id)
    if (!getInterior(p.interiorId)) errors.push(`property "${p.id}": unknown interior ${p.interiorId}`)
    if (typeof p.entranceInteractableId !== 'string' || p.entranceInteractableId.length === 0) {
      errors.push(`property "${p.id}": missing entrance interactable id`)
    }
    if (p.deposit < 0 || p.rent <= 0 || p.rentPeriodDays <= 0) errors.push(`property "${p.id}": bad economics`)
    if (p.hostingCapacity < 0 || p.baseStorageCapacity < 0) errors.push(`property "${p.id}": bad capacity`)
    for (const v of [p.baseComfort, p.baseStyle, p.baseSleepQuality]) {
      if (v < 0 || v > 100) errors.push(`property "${p.id}": base metric out of [0,100]`)
    }
    if (p.requirement.minRank && !(RANK_ORDER as readonly string[]).includes(p.requirement.minRank)) {
      errors.push(`property "${p.id}": unknown required rank ${p.requirement.minRank}`)
    }
    if (p.requirement.minRecentCareerIncome !== undefined && p.requirement.minRecentCareerIncome < 0) {
      errors.push(`property "${p.id}": negative income requirement`)
    }
    // Fixtures must use valid categories.
    for (const f of p.fixtures) {
      if (!(FURNITURE_CATEGORIES as readonly string[]).includes(f.category)) {
        errors.push(`property "${p.id}" fixture "${f.id}": unknown category ${f.category}`)
      }
    }
    // Slots: valid, unique, in-bounds, valid categories, sane maxSize.
    const dims = ROOM_DIMS[p.id]
    const hw = dims.width / 2
    const hd = dims.depth / 2
    const slots = PROPERTY_SLOTS[p.id] ?? []
    if (slots.length === 0) errors.push(`property "${p.id}": no slots`)
    for (const s of slots) {
      if (s.propertyId !== p.id) errors.push(`slot "${s.id}": propertyId mismatch`)
      if (seenSlot.has(s.id)) errors.push(`slot "${s.id}": duplicate id`)
      seenSlot.add(s.id)
      if (s.allowedCategories.length === 0) errors.push(`slot "${s.id}": no allowed categories`)
      for (const c of s.allowedCategories) {
        if (!(FURNITURE_CATEGORIES as readonly string[]).includes(c)) errors.push(`slot "${s.id}": unknown category ${c}`)
      }
      if (s.allowedRotations.length === 0) errors.push(`slot "${s.id}": no allowed rotations`)
      // In-bounds incl. clearance (a placed piece must fit inside the walls).
      if (Math.abs(s.local[0]) + s.clearance[0] > hw + 0.01 || Math.abs(s.local[1]) + s.clearance[1] > hd + 0.01) {
        errors.push(`slot "${s.id}": clearance extends outside the room`)
      }
      if (!(['small', 'medium', 'large'] as SizeClass[]).includes(s.maxSize)) errors.push(`slot "${s.id}": bad maxSize`)
    }
    // Pairwise slot-clearance overlap (no two placeable slots physically collide).
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]
        const b = slots[j]
        const dx = Math.abs(a.local[0] - b.local[0])
        const dz = Math.abs(a.local[1] - b.local[1])
        if (dx < a.clearance[0] + b.clearance[0] - 0.01 && dz < a.clearance[1] + b.clearance[1] - 0.01) {
          errors.push(`slots "${a.id}" and "${b.id}": clearance overlap`)
        }
      }
    }
    if (p.maxFurnitureAssets !== nonFixtureSlotCount(p.id)) {
      errors.push(`property "${p.id}": maxFurnitureAssets ${p.maxFurnitureAssets} != slot count ${nonFixtureSlotCount(p.id)}`)
    }
  }
  return errors
}

/** Prove every property entrance resolves in the interactable graph (Slice 2 wires them). */
export function validatePropertyEntrances(knownInteractableIds: ReadonlySet<string>): string[] {
  const errors: string[] = []
  for (const p of PROPERTY_DEFS) {
    if (!knownInteractableIds.has(p.entranceInteractableId)) {
      errors.push(`property "${p.id}": entrance interactable ${p.entranceInteractableId} not registered`)
    }
  }
  return errors
}

/** Slot compatibility check used by the furnish flow (issue §6). */
export function slotAccepts(slot: SlotDef, category: FurnitureCategory, size: SizeClass): boolean {
  return slot.allowedCategories.includes(category) && sizeFits(size, slot.maxSize)
}
