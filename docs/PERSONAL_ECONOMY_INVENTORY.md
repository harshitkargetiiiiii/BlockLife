# Personal Economy, Inventory & Shopping v1

A reusable life-sandbox commerce loop layered ON TOP of the existing economy,
inventory, store-interior, robbery, apartment, wardrobe, mission, phone, save and
streaming stacks — reimplementing none of them. Walk into a recovered store,
browse real stock, buy useful items, carry them in a limited backpack, use them,
stash extras in apartment storage, watch stores restock over game time, and run
one lawful supply activity (Shelf Run) that reuses the same commerce + inventory.

See also: [SYSTEMS](SYSTEMS.md) · [MISSIONS_AND_ACTIVITIES](MISSIONS_AND_ACTIVITIES.md) · [CRIMINAL_ACTIVITIES](CRIMINAL_ACTIVITIES.md).

## 1. Architecture & authority boundaries

| Concern | Owner | Notes |
|---|---|---|
| Item definitions | [`items/itemCatalog.ts`](../src/game/items/itemCatalog.ts) | Immutable, stable ids, source refs; validated. |
| Backpack + storage ops | [`items/inventoryService.ts`](../src/game/items/inventoryService.ts) | Pure; the ONE mutation path (stacks, capacity, atomic). |
| Item-use effects | [`items/itemEffects.ts`](../src/game/items/itemEffects.ts) | Pure interpreter → a patch the store applies. |
| Store definitions | [`commerce/storeDefinitions.ts`](../src/game/commerce/storeDefinitions.ts) | Reuse the robbery interiors + registers. |
| Stock + restock | [`commerce/stockLogic.ts`](../src/game/commerce/stockLogic.ts) + [`commerceRuntime.ts`](../src/game/commerce/commerceRuntime.ts) | Deterministic, lazy, module-singleton. |
| Purchase gate | [`commerce/commerceEngine.ts`](../src/game/commerce/commerceEngine.ts) | Pure `canPurchase`. |
| Store actions | `useGameStore` | Thin wrappers that apply transactions atomically in one `set`. |
| UI | `ShopPanel`, `StoragePanel`, `phone/PhoneBag`, `WardrobePanel` | Read bounded projections; never the runtime. |

**Boundaries.** The item service is the single capacity/stack authority — `giveItem`,
`buyItem`, `useItem`, `discardItem`, deposit/withdraw, and even the legacy
`buy_coffee` reducer all funnel through it (the store guards every
inventory-growing action against `occupiedSlots > capacity`). Item effects never
touch the store, health authority, or ammo runtime — they return a typed patch
the store applies (`setPlayerHealth`, `setAmmo`, stats, wardrobe unlocks) and
consume exactly one item ONLY on success. Commerce never mutates money or the bag
outside a single atomic `buyItem`/`useItem`/transfer transaction.

## 2. Item catalog

`ItemCategory` = food · drink · medical · ammo · quest · cosmetic · supply.
Effects are typed DATA (`feed` / `refresh` / `heal` / `ammo` / `unlock` / `none`)
interpreted by the pure effect service — never callbacks in authored data. Flags:
`usable`, `discardable`, `storable`, `questReserved`.

| id | cat | price | stack | effect |
|---|---|---|---|---|
| `coffee` | quest | 5 | 5 | none (quest-reserved; Coffee for Ravi) |
| `snack` | food | 6 | 10 | −12 hunger |
| `meal` | food | 13 | 5 | −25 hunger |
| `energy_drink` | drink | 10 | 10 | +20 energy |
| `first_aid` | medical | 35 | 5 | +35 health |
| `ammo_box` | ammo | 40 | 5 | +24 reserve rounds |
| `wardrobe_teal` | cosmetic | 70 | 1 | unlock palette `teal` |
| `wardrobe_gold` | cosmetic | 90 | 1 | unlock palette `gold` |
| `restock_crate` | supply | — | 1 | none (Shelf Run cargo; quest-reserved) |

Tuned against the economy (start $50, work $50/shift, meal $10, missions
$100–280): consumables are cheap, first-aid/ammo/a wardrobe colour are a
work-shift or two. Validation ([`itemValidation.ts`](../src/game/items/itemValidation.ts))
covers duplicate ids, prices, stack limits, effect payloads, effect↔usable
consistency, unlock refs targeting a real LOCKED palette, and the quest-reserved
policy.

## 3. Backpack & storage rules

Both containers are `Record<itemId, quantity>` — **the legacy save shape**, so
old saves need no inventory migration. Capacity is measured in OCCUPIED SLOTS: an
item occupies `ceil(qty / stackLimit)` slots. Backpack = **10** slots; apartment
storage = **40** slots. Every op is atomic and returns a NEW container + a typed
outcome (`unknown_item`, `capacity_full`, `not_enough`, …); no path can produce a
negative/non-integer quantity. Quest-reserved items (`coffee`, `restock_crate`)
cannot be used, discarded, or stored — the smallest safe policy so a required
interaction can't be made impossible. `sanitizeStacks` trims a tampered/overfull
loaded container to the slot budget and drops unknown ids.

## 4. Store commerce & stock

ONE engine + two data-only stores that reuse their robbery interior + register:

- **Main St Convenience** — snack, meal, energy drink, first-aid, ammo, teal dye; restock **12 game-h**.
- **Waterfront Kiosk** — snack, energy drink, gold dye; restock **10 game-h**.

Interacting with a store register opens the **Shop** during normal gameplay
(robbery takes priority: an in-progress heist still loots; a Shelf Run delivery
drops the crate). `canPurchase` checks store-open, listing, stock, money and bag
room atomically; `buyItem` applies money − price, stock − 1 and the grant together
in one `set`, mints a bounded receipt, and re-projects the shop. Failures surface
typed messages (no funds, full bag, out of stock, closed/recovering, unavailable).

**Restock** is deterministic and lazy: `reconcileStock` adds
`restockAmount × ⌊elapsed / restockGameHours⌋` (clamped to max) and advances the
clock by whole intervals only — a large time skip is O(1), repeated reconciles at
the same time are a no-op, and it runs on discrete moments (opening a shop, a
delivery) — never per frame, never while paused. Stock lives in the module
singleton `commerceRuntime` (persistent, survives streaming), projected to the UI
only when the shop opens/buys.

## 5. Robbery ↔ store-recovery integration

Legitimate stock and robbery recovery are separate concepts that meet at one
gate: `storeClosedForCommerce(activityId, gameHours)` refuses commerce while the
store is being robbed (`activityRuntime.active`) OR still inside its post-robbery
cooldown (`activityRuntime.stores[activityId].cooldownReadyAtGameHours > now`).
The shop refuses to open (toast) until the existing recovery policy reopens it.

## 6. Item use & effects

Applied via the pure effect service against a snapshot of the authorities; the
store applies the returned patch and removes exactly one item **only on success**:

- Food/meal reduce hunger (capped at 0); energy drink restores energy (cap 100);
  first-aid restores health via `setPlayerHealth` (cap max; refused while
  incapacitated); ammo box adds reserve via `setAmmo` (cap `reserveMax`; refused
  with no handgun); wardrobe dye unlocks a palette id (a repeat is a no-op that
  never charges/consumes). A full/invalid use never consumes the item.

## 7. Coffee for Ravi migration

`coffee` is now a catalog item (`quest`, quest-reserved) resolved through the same
catalog + service. The buy/deliver flow is unchanged: `buy_coffee` still grants it
(now behind the store-layer capacity guard) and Ravi's dialogue still removes one
on delivery; the reward is granted exactly once; quest-reserved protection stops
it being consumed/discarded/stored while Ravi waits. Old saves with `coffee`
quantities migrate losslessly (same `inventory` shape).

## 8. Shelf Run (lawful supply activity)

A 5th, data-only mission that OBSERVES a legitimate restock — it never writes
stock/money/inventory. Objectives: `interact` the Industrial-Yard **supply depot**
(grants the `restock_crate` through the normal item path, idempotently) →
`deliver_restock` at **Main St Convenience** (the register delivery removes the
exact crate, `applyDeliveryRestock(store, receipt=attemptId)` restocks the store
exactly once, and emits the generic `store_restocked` event the mission observes)
→ one-time **$100** reward. Duplicated interaction can't grant two crates
(idempotent), restock twice (receipt-guarded), or pay twice (mission receipt).
Cleanup: a cancelled/failed run drops the crate (mission cargo is never kept).
`deliver_restock` + `store_restocked` are generic additions, not Shelf-Run
hardcoding.

## 9. Persistence & migration

Additive optional save fields (older saves lack them and default deterministically):
`storage` (stacks), `wardrobe.unlocked` (palette ids), `commerce` (per-store stock
+ restock clocks + bounded receipts). The backpack reuses `inventory`. On load,
both containers are `sanitizeStacks`'d (drop unknown ids, floor, trim to
capacity), wardrobe unlocks are filtered to real locked palettes, and
`applyCommerceSave` resets to full-stock defaults then layers valid saved stock
(clamped to `[0, maxStock]`); malformed nested data fails safe (skipped, never
thrown). Transient UI (open panels, the `shopView` projection) is never persisted.
Reset restores full defaults.

## 10. Debug / test API (DEV-only)

`window.GAME_TEST_API` (all `import.meta.env.DEV`-guarded, grep to **0** in
`dist/`): `getItemCatalog`, `getItemValidation`, `getBackpack`,
`getStorageContainer`, `getWardrobeUnlocks`, `give/use/discard/deposit/withdrawTestItem`,
`openTestShop`, `buyTestItem`, `getShopView`, `getStoreCatalog`,
`getStoreStockState`, `reconcileStoreStock`, `getCommerceReceipts`,
`getCommerceValidation`, `collect/deliverTestShelfCrate`, `openTestPanel`,
`openTestPhoneApp`.

## 11. Coverage

- Unit: [`items/inventory.test.ts`](../src/game/items/inventory.test.ts) (12), [`items/itemEffects.test.ts`](../src/game/items/itemEffects.test.ts) (6), [`commerce/commerce.test.ts`](../src/game/commerce/commerce.test.ts) (13), [`commerce/commercePersistence.test.ts`](../src/game/commerce/commercePersistence.test.ts) (4), Shelf Run flow (4) in `missionEngine.test.ts`, [`phone/PhoneBag.test.tsx`](../src/app/phone/PhoneBag.test.tsx) (5), StoragePanel component tests.
- E2E: [`tests/e2e/economy.spec.ts`](../tests/e2e/economy.spec.ts) (13) — real Shop/Bag/Storage UI, buy-once, sold-out, restock, use effects + full-stat negatives, deposit/withdraw + save/load, robbery-recovery refusal, kiosk reuse, wardrobe unlock, full Shelf Run, old-save migration.
- Visual: 5 in [`tests/visual/economy-visuals.spec.ts`](../tests/visual/economy-visuals.spec.ts) (shop, sold-out, phone Bag, storage transfer, wardrobe lock).
- Soak: [`tests/e2e/economy-soak.spec.ts`](../tests/e2e/economy-soak.spec.ts) — 180 s buy/use/transfer/restock/save-load/Shelf-Run/robbery cycling under streaming; asserts no errors, no negatives, no overflow, bounded receipts, no dangling cargo.

## 12. Limitations & next milestone

- Backpack capacity is slot-based (occupied stacks), not weight/encumbrance (deliberate — no simulation-heavy weight).
- Wardrobe unlocks reuse the existing colour palette (no new clothing/equipment renderer).
- The 3 wardrobe slots share one unlock set (a colour unlocks for all slots).
- Restock reconciles on discrete moments (shop open / delivery), not on a background director — fully lazy, correct when viewed.
- The system is intentionally reusable for future gifts, cooking, clothing ownership, vehicle ownership, crafting, NPC requests, and deeper jobs — none implemented here.
