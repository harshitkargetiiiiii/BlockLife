/**
 * Furniture catalog (issue #17 §5). ≥16 typed definitions across every category.
 * A definition is a CATALOG KEY, priced data — buying one mints a unique owned
 * {@link FurnitureAsset} (see the runtime). Money + purchase pricing flow through
 * the existing economy/commerce; this file owns only the typed catalog + getters
 * + a validator. Values are deterministic and bounded (the metric calculator caps
 * them; see homeMetrics).
 */
import {
  FURNITURE_CATEGORIES,
  type FurnitureCategory,
  type FurnitureDef,
  type FurnitureDefId,
  type HomeActivityKind,
} from './housingTypes'

const R4 = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
const R2 = [0, Math.PI]

function def(
  id: string,
  displayName: string,
  category: FurnitureCategory,
  size: FurnitureDef['size'],
  price: number,
  values: Partial<Pick<FurnitureDef, 'comfort' | 'style' | 'storage' | 'sleepQuality' | 'seating'>>,
  extra: Partial<
    Pick<FurnitureDef, 'allowedRotations' | 'unlocksActivities' | 'enablesWardrobe' | 'themeTags'>
  > & { description: string },
): FurnitureDef {
  return {
    id,
    displayName,
    category,
    size,
    price,
    description: extra.description,
    allowedRotations: extra.allowedRotations ?? R4,
    comfort: values.comfort ?? 0,
    style: values.style ?? 0,
    storage: values.storage ?? 0,
    sleepQuality: values.sleepQuality ?? 0,
    seating: values.seating ?? 0,
    unlocksActivities: extra.unlocksActivities,
    enablesWardrobe: extra.enablesWardrobe,
    themeTags: extra.themeTags,
    sellable: false, // selling is a future hook (issue §5: not required for v1)
    storable: true,
    sourceRef: { file: 'src/game/housing/furnitureCatalog.ts', symbol: id },
  }
}

/**
 * The catalog, in deterministic display order (never sorted at runtime). Sleep
 * values are BONUSES added on top of a property's base sleep floor, so a home is
 * always safe to sleep in and a better bed restores meaningfully more (§8).
 */
export const FURNITURE_DEFS: readonly FurnitureDef[] = [
  // ---- beds (3 tiers) ----
  def('bed_futon', 'Futon', 'bed', 'medium', 140, { comfort: 10, style: 6, sleepQuality: 12 }, {
    description: 'A simple fold-out futon. A real step up from the bare mattress.',
    themeTags: ['cozy'],
  }),
  def('bed_double', 'Double Bed', 'bed', 'medium', 280, { comfort: 16, style: 10, sleepQuality: 22 }, {
    description: 'A proper double bed with a sprung mattress. You wake up rested.',
    themeTags: ['cozy'],
  }),
  def('bed_kingsize', 'King Bed', 'bed', 'large', 560, { comfort: 24, style: 18, sleepQuality: 34 }, {
    description: 'A wide king bed with a plush topper. The best sleep money can buy.',
    themeTags: ['modern'],
  }),

  // ---- seating (3) ----
  def('stool', 'Stool', 'seating', 'small', 40, { comfort: 4, style: 3, seating: 1 }, {
    description: 'A little wooden stool. Somewhere to perch.',
  }),
  def('armchair', 'Armchair', 'seating', 'medium', 170, { comfort: 12, style: 9, seating: 1 }, {
    description: 'A cushioned armchair — the reading spot.',
    themeTags: ['cozy'],
  }),
  def('sofa', 'Sofa', 'seating', 'large', 360, { comfort: 18, style: 15, seating: 3 }, {
    description: 'A three-seat sofa. Room for guests on movie night.',
    themeTags: ['cozy'],
  }),

  // ---- tables / dining (2) ----
  def('coffee_table', 'Coffee Table', 'table', 'small', 95, { comfort: 4, style: 7 }, {
    description: 'A low table for mugs and conversation.',
    unlocksActivities: ['coffee_home'],
    themeTags: ['cozy'],
  }),
  def('dining_table', 'Dining Table', 'table', 'large', 310, { comfort: 6, style: 13 }, {
    description: 'A four-seat dining table. Set it for a dinner at home.',
    unlocksActivities: ['dinner_home'],
    themeTags: ['modern'],
  }),

  // ---- entertainment (2) ----
  def('tv_flatscreen', 'Flatscreen TV', 'entertainment', 'medium', 300, { comfort: 7, style: 11 }, {
    description: 'A wall-mounted flatscreen. Cue up a movie night.',
    unlocksActivities: ['movie_night'],
    allowedRotations: R2,
    themeTags: ['modern'],
  }),
  def('sound_system', 'Sound System', 'entertainment', 'small', 180, { comfort: 4, style: 12 }, {
    description: 'A tidy shelf stereo with real bass.',
    themeTags: ['modern'],
  }),

  // ---- storage (3) ----
  def('wall_shelf', 'Wall Shelf', 'storage', 'small', 70, { style: 5, storage: 6 }, {
    description: 'A floating shelf. A little more room for your things.',
    allowedRotations: R2,
  }),
  def('dresser', 'Dresser', 'storage', 'medium', 160, { style: 7, storage: 12 }, {
    description: 'A four-drawer dresser. Solid, roomy storage.',
    themeTags: ['cozy'],
  }),
  def('storage_cabinet', 'Storage Cabinet', 'storage', 'large', 290, { style: 9, storage: 20 }, {
    description: 'A tall cabinet. The most home storage per slot.',
    themeTags: ['modern'],
  }),

  // ---- wardrobes (2) ----
  def('wardrobe_basic', 'Wardrobe', 'wardrobe', 'medium', 130, { style: 7 }, {
    description: 'A standing wardrobe. Lets you save outfit presets.',
    enablesWardrobe: true,
    allowedRotations: R2,
    themeTags: ['cozy'],
  }),
  def('wardrobe_mirror', 'Mirrored Wardrobe', 'wardrobe', 'large', 330, { style: 17 }, {
    description: 'A mirrored wardrobe. Outfit presets, with style to spare.',
    enablesWardrobe: true,
    allowedRotations: R2,
    themeTags: ['modern'],
  }),

  // ---- lighting / decor (4) ----
  def('floor_lamp', 'Floor Lamp', 'lighting', 'small', 55, { comfort: 4, style: 5 }, {
    description: 'A warm floor lamp for the corner.',
    themeTags: ['cozy'],
  }),
  def('area_rug', 'Area Rug', 'decor', 'medium', 95, { comfort: 9, style: 9 }, {
    description: 'A soft area rug that ties the room together.',
    themeTags: ['cozy'],
  }),
  def('wall_art', 'Wall Art', 'decor', 'small', 75, { style: 11 }, {
    description: 'A framed print. Instant character on a bare wall.',
    allowedRotations: R2,
    themeTags: ['modern'],
  }),
  def('potted_plant', 'Potted Plant', 'decor', 'small', 45, { comfort: 5, style: 6 }, {
    description: 'A leafy potted plant. A breath of life.',
    themeTags: ['cozy'],
  }),
]

const BY_ID: Record<string, FurnitureDef> = Object.fromEntries(FURNITURE_DEFS.map((d) => [d.id, d]))

export function getFurnitureDef(id: FurnitureDefId): FurnitureDef | undefined {
  return BY_ID[id]
}

export function isFurnitureDefId(id: unknown): id is FurnitureDefId {
  return typeof id === 'string' && id in BY_ID
}

/** Catalog entries in a category, display order preserved. */
export function furnitureByCategory(category: FurnitureCategory): FurnitureDef[] {
  return FURNITURE_DEFS.filter((d) => d.category === category)
}

/** Which home activity, if any, a placed furniture def helps unlock. */
export function activityUnlocks(defId: FurnitureDefId): readonly HomeActivityKind[] {
  return getFurnitureDef(defId)?.unlocksActivities ?? []
}

/**
 * Validate the catalog (issue §5 "furniture catalog validation"). Returns the
 * list of problems; empty = valid. Exercised by unit tests.
 */
export function validateFurnitureCatalog(): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  const perCategory: Record<string, number> = {}
  for (const d of FURNITURE_DEFS) {
    if (seen.has(d.id)) errors.push(`furniture "${d.id}": duplicate id`)
    seen.add(d.id)
    if (!(FURNITURE_CATEGORIES as readonly string[]).includes(d.category)) {
      errors.push(`furniture "${d.id}": unknown category ${d.category}`)
    }
    perCategory[d.category] = (perCategory[d.category] ?? 0) + 1
    if (d.price < 0 || !Number.isFinite(d.price)) errors.push(`furniture "${d.id}": bad price`)
    if (d.allowedRotations.length === 0) errors.push(`furniture "${d.id}": no allowed rotations`)
    for (const v of [d.comfort, d.style, d.storage, d.sleepQuality, d.seating]) {
      if (v < 0 || !Number.isFinite(v)) errors.push(`furniture "${d.id}": negative/NaN metric`)
    }
    if (d.storage > 0 && d.category !== 'storage') {
      errors.push(`furniture "${d.id}": storage value on a non-storage piece`)
    }
    if (d.sleepQuality > 0 && d.category !== 'bed') {
      errors.push(`furniture "${d.id}": sleep value on a non-bed piece`)
    }
  }
  // Category minimums (issue §5).
  const min: Partial<Record<FurnitureCategory, number>> = {
    bed: 3,
    seating: 3,
    table: 2,
    entertainment: 2,
    storage: 3,
    wardrobe: 2,
  }
  for (const [cat, n] of Object.entries(min)) {
    if ((perCategory[cat] ?? 0) < (n ?? 0)) {
      errors.push(`category "${cat}": needs at least ${n}, has ${perCategory[cat] ?? 0}`)
    }
  }
  const lightingDecor = (perCategory['lighting'] ?? 0) + (perCategory['decor'] ?? 0)
  if (lightingDecor < 3) errors.push(`lighting+decor: needs at least 3, has ${lightingDecor}`)
  if (FURNITURE_DEFS.length < 16) errors.push(`catalog: needs at least 16 defs, has ${FURNITURE_DEFS.length}`)
  return errors
}
