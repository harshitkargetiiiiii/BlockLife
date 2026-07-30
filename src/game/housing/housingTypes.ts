/**
 * Housing, Furniture & Property Progression v1 (issue #17) — the ONE typed
 * vocabulary for the housing platform. Everything here is plain data: ids,
 * scalars, small records. No THREE objects, no runtime handles, no meshes —
 * so every value survives streaming and round-trips through the save.
 *
 * Authorities (issue §2): housing owns leases, eligibility, furniture assets,
 * placements, home metrics, rent periods, and move history. Money is the existing
 * economy authority; purchase pricing/stock the existing commerce; the backpack/
 * storage/wardrobe/appearance their existing owners; invitations/relationships the
 * social system; ranks + verified earnings the career system; due dates game time.
 */
import type { PlayerAppearance } from '../interiors/interiorTypes'
import type { RankId } from '../careers/careerTypes'
import type { Vec2 } from '../world/worldTypes'

// ---- Properties -----------------------------------------------------------

/** Three meaningful tiers (issue §1). Ordered worst → best. */
export type PropertyTier = 'starter' | 'loft' | 'premium'
export const PROPERTY_TIER_ORDER: readonly PropertyTier[] = ['starter', 'loft', 'premium'] as const

/** Stable property ids. Starter Studio is the migrated/default apartment. */
export type PropertyId = 'starter_studio' | 'city_loft' | 'premium_apartment'

/** A debug source pointer (matches the repo's `sourceRef` convention). */
export interface SourceRef {
  file: string
  symbol: string
}

/**
 * A property's leasing requirements (issue §10). Career money helps pay COSTS,
 * but only VERIFIED CAREER income satisfies an income requirement — crime/mission
 * cash never does (checked in eligibility, not here).
 */
export interface PropertyRequirement {
  /** Minimum rank in ANY career (verified employment), if gated. */
  minRank?: RankId
  /** Minimum verified career income over the recent window, if gated. */
  minRecentCareerIncome?: number
  /** Recent-income window in game days (defaults documented at the calculator). */
  recentIncomeWindowDays?: number
}

/** Furniture categories (issue §5). */
export type FurnitureCategory =
  | 'bed'
  | 'seating'
  | 'table'
  | 'entertainment'
  | 'storage'
  | 'wardrobe'
  | 'lighting'
  | 'decor'

export const FURNITURE_CATEGORIES: readonly FurnitureCategory[] = [
  'bed',
  'seating',
  'table',
  'entertainment',
  'storage',
  'wardrobe',
  'lighting',
  'decor',
] as const

/** Furniture / slot size class. A furniture asset fits a slot only if allowed. */
export type SizeClass = 'small' | 'medium' | 'large'
export const SIZE_ORDER: readonly SizeClass[] = ['small', 'medium', 'large'] as const

/** The three home-hosting activities (issue §9). */
export type HomeActivityKind = 'coffee_home' | 'movie_night' | 'dinner_home'
export const HOME_ACTIVITY_KINDS: readonly HomeActivityKind[] = [
  'coffee_home',
  'movie_night',
  'dinner_home',
] as const

/**
 * An authored furniture slot inside a property (issue §6). Slots are the ONLY
 * placement targets — no free/physics placement. Positions are LOCAL to the
 * interior origin (x,z), so the same shape works at any far-off-grid interior.
 */
export interface SlotDef {
  /** Stable slot id, unique within its property. */
  id: string
  propertyId: PropertyId
  /** Room / zone label (for the furnish UI grouping). */
  room: string
  /** Local offset from the interior origin (x, z). */
  local: Vec2
  /** Base facing (radians) before any per-asset rotation. */
  baseRotationY: number
  allowedCategories: FurnitureCategory[]
  /** Largest size class this slot accepts (small ⊆ medium ⊆ large by SIZE_ORDER). */
  maxSize: SizeClass
  /** Rotations (radians) the player may cycle a placed asset through. */
  allowedRotations: number[]
  /** Clearance half-extents (x,z) — used for overlap/occupancy checks. */
  clearance: Vec2
  /** Fixture-only slots hold fixed fixtures, never player furniture. */
  fixtureOnly?: boolean
}

/**
 * A fixed fixture — part of the interior, NOT a player-owned asset (issue §4).
 * Contributes base metrics; cannot be sold or stored.
 */
export interface FixtureDef {
  id: string
  category: FurnitureCategory
  comfort: number
  style: number
  /** Sleep contribution when this fixture is the home's bed (starter fixture). */
  sleepQuality?: number
  storage?: number
}

/** A full property definition (issue §1). Money/eligibility read elsewhere. */
export interface PropertyDef {
  id: PropertyId
  tier: PropertyTier
  displayName: string
  description: string
  listingCopy: string
  district: string
  /** Interior registry id (real streaming-safe interior/entrance). */
  interiorId: string
  /** World entrance interactable id (the door in the city). */
  entranceInteractableId: string
  /** Base storage slots before any storage furniture. */
  baseStorageCapacity: number
  /** Max player-furniture assets placeable (== count of non-fixture slots). */
  maxFurnitureAssets: number
  /** Max guests hostable at once. */
  hostingCapacity: number
  /** Base metric contributions (before furniture). */
  baseComfort: number
  baseStyle: number
  baseSleepQuality: number
  /** Lease economics (game time only). */
  deposit: number
  rent: number
  rentPeriodDays: number
  requirement: PropertyRequirement
  /** A tour is required before leasing when true. */
  tourRequired: boolean
  /** Fixed fixtures present in the interior. */
  fixtures: FixtureDef[]
  sourceRef: SourceRef
}

// ---- Furniture ------------------------------------------------------------

/** Stable furniture definition id (a catalog key — NOT an owned asset id). */
export type FurnitureDefId = string

export interface FurnitureDef {
  id: FurnitureDefId
  displayName: string
  category: FurnitureCategory
  size: SizeClass
  price: number
  description: string
  /** Rotations (radians) allowed when placed. */
  allowedRotations: number[]
  comfort: number
  style: number
  /** Storage slots this piece adds to home storage when placed. */
  storage: number
  /** Sleep-quality value (beds). */
  sleepQuality: number
  /** Seats this piece provides (seating; some tables provide 0). */
  seating: number
  /** Home activities this piece helps unlock. */
  unlocksActivities?: HomeActivityKind[]
  /** True when placing this unlocks the wardrobe outfit-preset feature. */
  enablesWardrobe?: boolean
  /** Style/theme tags for the capped coherence bonus. */
  themeTags?: string[]
  /** Deterministic resale value (optional selling, issue §5). */
  sellValue?: number
  /** Whether the player may sell / store it (defaults true/true). */
  sellable?: boolean
  storable?: boolean
  sourceRef: SourceRef
}

/**
 * A UNIQUE owned furniture asset (issue §5). A def id is not an asset id: buying
 * the same def twice mints two assets. Exactly one ownership location at a time.
 */
export interface FurnitureAsset {
  /** Reload-safe monotonic id, e.g. `fa_7`. */
  assetId: string
  defId: FurnitureDefId
  /** Current rotation (radians) — meaningful only while placed. */
  rotationY: number
}

// ---- Lease & rent ---------------------------------------------------------

/**
 * Persisted lease status (issue §2). Display statuses available/eligible/
 * ineligible/touring are DERIVED (not stored) from lease + property + eligibility.
 */
export type LeaseStatus = 'active' | 'rent_due' | 'overdue' | 'delinquent' | 'ended'

export interface LeaseState {
  propertyId: PropertyId
  startDay: number
  /** Game day the next rent period is due. */
  nextDueDay: number
  /** Monotonic period counter (never reused). */
  periodSeq: number
  /** Refundable deposit currently held by the landlord. */
  depositHeld: number
  /** Outstanding unpaid rent + fees. */
  debt: number
  status: LeaseStatus
  /** periodSeq a late fee was already charged for (so it never compounds). */
  lateFeePeriod: number | null
}

/** Exact-once housing transaction kinds (issue §12). */
export type HousingTxnKind =
  | 'furniture_purchase'
  | 'deposit_charge'
  | 'deposit_refund'
  | 'initial_rent'
  | 'recurring_rent'
  | 'late_fee'
  | 'debt_settlement'
  | 'furniture_resale'

/** A bounded payment/transaction history entry. `amount` is signed (− = charge). */
export interface HousingPayment {
  key: string
  kind: HousingTxnKind
  amount: number
  day: number
}

/** A bounded property-move history entry. */
export interface PropertyHistoryEntry {
  propertyId: PropertyId
  movedInDay: number
  movedOutDay: number | null
}

// ---- Outfit presets (wardrobe benefit, issue §8) --------------------------

export interface OutfitPreset {
  /** 'preset_1' | 'preset_2' | 'preset_3'. */
  id: string
  name: string
  /** null = empty slot. */
  appearance: PlayerAppearance | null
}

export const OUTFIT_PRESET_IDS: readonly string[] = ['preset_1', 'preset_2', 'preset_3'] as const

// ---- Derived home metrics (issue §7) --------------------------------------

export interface MetricContribution {
  source: string
  comfort: number
  style: number
  storage: number
}

export interface HomeMetrics {
  comfort: number // 0–100
  style: number // 0–100
  /** Effective storage capacity (slots). */
  storageCapacity: number
  sleepQuality: number // 0–100
  /** Derived seating, capped by property hosting capacity. */
  hostingCapacity: number
  /** Inspectable breakdown (issue §7 "show the contribution breakdown"). */
  contributions: MetricContribution[]
  /** A short readable next-upgrade hint. */
  nextUpgrade: string
  /** Theme-coherence bonus applied to style (capped). */
  themeBonus: number
}

// ---- The runtime / serialized housing state -------------------------------

/**
 * The whole housing state. The module runtime holds one of these; the save slice
 * is (almost) the same shape. There is ALWAYS a current residence + lease (issue
 * §2 "exactly one current residence"): a new/old game starts in the Starter Studio.
 */
export interface HousingState {
  version: number
  lease: LeaseState
  /** Current residence — always set; equals lease.propertyId. */
  currentPropertyId: PropertyId
  /** Listings the player has discovered (starter is always discovered). */
  discovered: PropertyId[]
  /** Properties the player has toured. */
  toured: PropertyId[]
  /** Bounded move history. */
  history: PropertyHistoryEntry[]
  /** All owned furniture assets, keyed by assetId (independent of residence). */
  assets: Record<string, FurnitureAsset>
  /** Current-property placements: slotId → assetId. Cleared on move. */
  placements: Record<string, string>
  /** Reload-safe monotonic asset id counter. */
  assetSeq: number
  /** Reload-safe monotonic move counter — a legitimate repeated same-day move gets a
   *  distinct transaction id (issue §12, PR#18 review #8). */
  moveSeq: number
  /** Reload-safe monotonic settlement counter — a partial then top-up payment on the
   *  same game-day are distinct settlements (issue §12, PR#18 review #8). */
  settleSeq: number
  /** Bounded payment ledger. */
  payments: HousingPayment[]
  /** Bounded FIFO exact-once transaction/event key ledger. */
  appliedTxnKeys: string[]
  /** Three outfit presets (require a placed wardrobe to edit/apply). */
  outfitPresets: OutfitPreset[]
}

/** The additive, fail-safe save slice (issue §14). Same plain shape. */
export type HousingSaveData = HousingState

// ---- Bounds (all collections capped, issue §16) ---------------------------

export const HOUSING_SAVE_VERSION = 1
export const HOUSING_PAYMENTS_MAX = 64
export const HOUSING_APPLIED_TXN_KEYS_MAX = 128
export const HOUSING_HISTORY_MAX = 32
export const HOUSING_OWNED_ASSETS_MAX = 128
/** One rent period, in game days (issue §3). */
export const RENT_PERIOD_DAYS = 7
/** Grace window (game days) after the due day before a late fee applies. */
export const RENT_GRACE_DAYS = 2
/** Default recent-income window (game days) for the Premium income gate. */
export const RECENT_INCOME_WINDOW_DAYS = 7

// ---- Readable refusal reasons (issues §2/§6/§9) ---------------------------

export type MoveRefusalReason =
  | 'ineligible'
  | 'not_toured'
  | 'insufficient_funds'
  | 'rent_debt'
  | 'storage_overflow'
  | 'incompatible_activity'
  | 'already_here'
  | 'wanted'
  | 'incapacitated'
  | 'unknown_property'

export type PlacementRefusalReason =
  | 'not_home'
  | 'unknown_slot'
  | 'unknown_asset'
  | 'slot_occupied'
  | 'incompatible_category'
  | 'incompatible_size'
  | 'not_owned'
  | 'asset_placed_elsewhere'
  | 'fixture_slot'

export type HostingRefusalReason =
  | 'no_lease'
  | 'delinquent'
  | 'missing_furniture'
  | 'low_trust'
  | 'not_home'
  | 'wanted'
  | 'incapacitated'
  | 'busy'
  | 'schedule_conflict'
  | 'hosting_full'
  | 'unknown_guest'

// ---- Small shared type guards --------------------------------------------

export function isPropertyId(v: unknown): v is PropertyId {
  return v === 'starter_studio' || v === 'city_loft' || v === 'premium_apartment'
}

export function isFurnitureCategory(v: unknown): v is FurnitureCategory {
  return typeof v === 'string' && (FURNITURE_CATEGORIES as readonly string[]).includes(v)
}

export function isSizeClass(v: unknown): v is SizeClass {
  return v === 'small' || v === 'medium' || v === 'large'
}

export function isHomeActivityKind(v: unknown): v is HomeActivityKind {
  return typeof v === 'string' && (HOME_ACTIVITY_KINDS as readonly string[]).includes(v)
}

/** True when `size` fits within `maxSize` by the SIZE_ORDER ranking. */
export function sizeFits(size: SizeClass, maxSize: SizeClass): boolean {
  return SIZE_ORDER.indexOf(size) <= SIZE_ORDER.indexOf(maxSize)
}
