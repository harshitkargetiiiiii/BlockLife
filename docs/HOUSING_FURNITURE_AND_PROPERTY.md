# Housing, Furniture & Property Progression v1 (issue #17)

One **deterministic** housing platform under [`src/game/housing/`](../src/game/housing/)
that turns the home from a static recovery room into a persistent, inspectable,
useful part of the player's life. It **reuses** the existing economy, commerce,
inventory/storage, apartment/interior, wardrobe/appearance, career, social
invitation/activity, mission, crime, game-time, save/load, streaming, occupancy and
World-Integrity authorities — it creates no parallel systems.

Core loop: **maintain a lease → earn & save → qualify for a better property → tour →
move safely → buy furniture → furnish → improve Comfort/Style/Storage/Sleep → host
trusted NPCs → unlock better homes & domestic activities.**

---

## 1. Architecture & authorities

Two-tier state, exactly like career/social/commerce: the housing **runtime**
([`housingRuntime.ts`](../src/game/housing/housingRuntime.ts)) is a module singleton
holding one `HousingState` (ids + scalars only, streaming-safe). UI re-renders via a
**`housingVersion`** counter on the zustand store (gotcha #22). All money/asset
actions funnel through the runtime **exact-once**; the monotonic `assetSeq` and the
period/transaction keys live in the **serialized save slice**, so a reload can never
mint a duplicate asset id or re-charge a period (gotcha #24).

| Concern | Owner |
|---|---|
| leases, eligibility, furniture assets, placements, home metrics, rent periods, move history | **housing** (this module) |
| money | existing **economy** (`stats.money`) |
| purchase pricing / stock / receipts | existing **commerce** + economy |
| backpack / storage / wardrobe / appearance | their existing authorities |
| invitations, activities, relationships, memories, messages | existing **social** |
| ranks + verified earnings | existing **career** (read-only adapter) |
| due dates & schedules | **game time** |
| interiors / streaming / occupancy | existing world systems |
| persistence orchestration | existing **save/load** |

### Module map
- `housingTypes.ts` — the ONE typed vocabulary (properties, slots, furniture, assets, lease, transactions, metrics, refusal reasons, bounds).
- `propertyRegistry.ts` — 3 property tiers + authored slots + fixtures + `validatePropertyRegistry()`.
- `furnitureCatalog.ts` — 19 furniture defs + `validateFurnitureCatalog()`.
- `leaseModel.ts` — PURE rent lifecycle (autopay / grace / one-time late fee / settlement).
- `eligibility.ts` — PURE property eligibility (rank → income → tour), verified-income window.
- `homeMetrics.ts` — the ONE PURE bounded calculator (Comfort/Style/Storage/Sleep/Hosting).
- `placement.ts` — PURE place/move/rotate/replace rules.
- `housingCommerce.ts` — furniture purchase validation (reuses economy, no second store engine).
- `housingCareer.ts` — typed READ-ONLY career adapter (highest rank, recent verified income).
- `housingSocial.ts` — home-hosting adapter (activity defs, gates, guest anchor).
- `housingRuntime.ts` — the module singleton + mutators (lease/rent/discover/tour/move/place/metrics/presets).
- `housingPersistence.ts` — serialize / field-by-field sanitize / migration.
- `housingObservability.ts` — DEV report.
- `housingText.ts` — readable refusal copy (one source for store + UI + DEV).
- Interiors: `interiors/loftLayout.ts`, `interiors/premiumLayout.ts`, `interiors/HomeInteriors.tsx` (shells + fixtures), `interiors/HomeFurniture.tsx` (placed-furniture renderer), `interiors/HomeGuest.tsx` (hosted guest).
- UI: `app/phone/PhoneHousing.tsx` (Home app), `app/FurnishPanel.tsx` (Furnish mode), plus outfit presets in `app/WardrobePanel.tsx` and effective capacity in `app/StoragePanel.tsx`.

---

## 2. Properties & slots (`propertyRegistry.ts`)

Three tiers with stable ids, distinct real interiors/entrances, safe spawns, authored
fixtures and furniture slots:

| Property | Interior | District (entrance) | Deposit | Rent / 7d | Requirement | Base storage | Hosting cap |
|---|---|---|---|---|---|---|---|
| **Starter Studio** | `apartment` (migrated) | Central Residential (`apartment` door) | $0 | $120 | none | 40 | 2 |
| **City Loft** | `city_loft` | Downtown Gateway (`loft_entrance`) | $600 | $260 | **Regular** rank (any career) | 48 | 3 |
| **Premium Apartment** | `premium_apartment` | East Residential (`premium_entrance`) | $1,500 | $500 | **Experienced** rank + **$250 verified income / 7d** | 60 | 4 |

The Premium sits in the far-east sector, so leasing/touring/moving there exercises
cross-district streaming. `validatePropertyRegistry()` proves every interior exists,
every slot is in-bounds + non-overlapping (it caught a real Loft bed/nightstand
clearance overlap during authoring), categories/ranks are valid, and
`maxFurnitureAssets` equals the non-fixture slot count.

The Starter Studio **reuses the hand-authored `ApartmentInterior` furniture as fixed
fixtures** (zero visual churn); its player-furniture slots are open-floor accent
slots. The full furnish loop (beds/storage/wardrobes) lives in the empty Loft &
Premium shells.

### Economy / affordability
Shift pay is `base × rank × performance` with bases $35–50 and rank ×1.0/1.3/1.6/2.0.
Rents are coverable by the eligible rank **without inflating pay**: ~3 trainee shifts
(+ casual income) cover the Starter; a Regular tradesperson clears the Loft in ~4
shifts; an Experienced worker makes the Premium's $250/7d gate provable in ~4 shifts.
Tuning is asserted in `leaseModel.test.ts` + `propertyRegistry.test.ts` (tiers ordered).

---

## 3. Lease & rent (`leaseModel.ts`, PURE)

Persisted `LeaseStatus`: `active | rent_due | overdue | delinquent | ended`
(available/eligible/ineligible/touring are DERIVED). One rent period = **7 game days**;
each lease has `nextDueDay` + a monotonic `periodSeq`. Reconciled **lazily** on
sleep / day-advance / Home-app open / current-home entry / load — **never per frame**.

- **Autopay** at the due boundary when funds allow (exact-once key `rent:<prop>:<seq>`).
- Insufficient funds → **one** outstanding period (debt), status `overdue`, one message.
- **At most one unresolved period at a time** — debt freezes the schedule (no runaway debt).
- After a **2-day grace**, **one** bounded late fee (25% rent, capped $80), `delinquent`, never compounded (`lateFeePeriod` guard).
- **Manual `Pay Now`** settles debt and resumes the schedule from settlement.
- Delinquency blocks moving-up + new hosting + lowers home appeal, but **never** locks entry/sleep/storage/pay. **No eviction.**

Every charge/fee/refund/settlement has a stable exact-once key + bounded payment history.

### Atomic move (`planMove`/`commitMove`)
`planMove` is pure: it computes `refund(old deposit) − new deposit − initial rent` and
refuses `insufficient_funds / rent_debt / ineligible / not_toured / storage_overflow /
incompatible_activity / already_here`. `commitMove` atomically packs **all** placed
furniture into storage (placements clear, assets preserved), closes the old lease into
history, opens the new lease with the new deposit held, and returns the net `moneyDelta`
the store applies in **one** calc off the current balance (no capture-spread clobber).
No intermediate state ever leaves two homes, zero homes, a duplicated deposit, or lost
furniture.

---

## 4. Furniture, assets & Furnish mode

**19 furniture defs** across beds(3)/seating(3)/tables(2)/entertainment(2)/storage(3)/
wardrobes(2)/lighting+decor(4). Buying (`housingCommerce.ts` + the store) charges the
economy and mints **one unique reload-safe asset** (`fa_<n>`) that lives OUTSIDE the
backpack; displayed price == charged price; reload can't duplicate (asset + txn key
persisted). Furniture is an always-available catalog surface (a showroom orders it in)
— documented deliberately; money + receipts still flow through economy/commerce.

Each asset is in exactly one of: **placed** in one slot / **stored** / holding
(recovery). **Furnish mode** ([`FurnishPanel.tsx`](../src/app/FurnishPanel.tsx)), usable
only inside the current home, drives place / rotate / move / replace / store over
authored slots (one-asset-one-slot, one-slot-one-asset, category+size compatibility,
clearance-checked authoring, deterministic, render-on-action). The 3D
`HomeFurniture` renderer updates on `housingVersion`, never per frame, and only for the
active home's placements. Leaving clears the selection.

---

## 5. Derived metrics & real benefits

`homeMetrics.ts` is the ONE pure bounded calculator. **Anti-inflation is structural**
(proven by invariant tests): category **coverage** beats spam (best piece full, 2nd
0.4×, 3rd+ 0.15×); duplicate copies of the same def add sharply less style (2nd 0.25×,
3rd+ 0); theme-coherence bonus capped at +8; everything clamps to [0,100]. Ten identical
sofas stay sub-linear and capped.

Every core category changes **real production behaviour**, with **display == execution**
(one resolver each):
- **Beds** — `homeSleepBenefit()` adds a bounded health restore (quality 50→0, 100→+30) on top of full energy; the bed action shows exactly what it applies. Starter sleep stays safe; no infinite rest/heal loop.
- **Storage** — effective capacity = property base + placed storage furniture; the storage UI shows and **enforces** it; removing/downgrading storage that would strand items is refused; a downsize-move is refused the same way.
- **Wardrobe** — a placed wardrobe unlocks **3 persistent outfit presets** (save/apply/clear via the appearance authority); removing it locks editing but never deletes saved looks or clothing.
- **Entertainment/dining** — a TV unlocks Movie Night, a coffee/dining table + seating unlock Coffee/Dinner at Home.

---

## 6. Social hosting (`housingSocial.ts`)

Three home activities — **Coffee at Home**, **Movie Night**, **Dinner at Home** — run
entirely through the EXISTING social invitation + activity + relationship + memory +
message pipeline (no second engine). They are new `*_home` `InvitationActivityKind`s
whose venue is the player's residence. Housing adds only: furniture/lease/seating gates
(`canHostActivity`), a per-activity minimum trust tier, and the interior hosting anchor.
Invites go through the Home app (`hosting-invite-*`, gated) → the social layer schedules
+ the NPC accepts on its own rules. Starting requires being **inside your own home**;
the guest (`HomeGuest.tsx`) appears at the authored guest anchor — never in furniture, a
wall, a door, or the player — and reads the ONE active social activity, so
completion / cancel / a load that drops the activity clears it with no leak. Home
quality never overrides trust/safety/schedule gates. Ravi, Maya (and the rest of the
cast) are usable as guests with no duplicate identity.

---

## 7. Save schema & migration (`housingPersistence.ts`, §14)

Additive `housing?` slice: current lease + property, rent period/debt/deposit/status,
discovered/toured, property history, owned furniture assets + reload-safe `assetSeq`,
placements, outfit presets, bounded payment + exact-once txn ledgers.

- **Old apartment saves migrate** to a Starter Studio lease with **one full grace
  period** (never charged/penalized on first load); existing storage/wardrobe/appearance
  stay intact.
- Malformed values clamp/drop field-by-field; unknown property/furniture/slot/asset ids
  fail safe; duplicate asset ids dedupe without minting extras; an incompatible or
  bogus placement returns the asset to storage (never deleted); an asset referenced by
  two slots is kept once; `assetSeq` stays ahead of any loaded id.
- No runtime handles persisted. Saving inside an interior restores to the city (the
  established contract). Full reload preserves lease/assets/placements/metrics/presets
  with no duplicate money/assets/messages.

Reset returns to the canonical Starter Studio.

---

## 8. Integration traps discovered (see CONVENTIONS.md)

- **Studio slots vs. hand-authored fixtures** — placing player furniture on top of the
  reused apartment meshes would overlap; the Studio keeps its furniture as fixtures and
  authors accent slots in open floor (no baseline churn).
- **Extending a shared union** — adding `*_home` to `InvitationActivityKind` broke an
  exhaustive `invitationLabel` switch; grep every switch over a widened union.
- **Guests can't ride the city-NPC LOD** — named NPCs are sector-LOD-gated, so a guest
  is rendered directly inside the interior (interior-civilian pattern), not relocated.
- **Test-arrange stack limits** — occupancy is `Σ⌈qty/stackLimit⌉`; a storage-overflow
  test must occupy real slots (first-aid stacks 5/slot, snacks 10/slot).

---

## 9. Extension guide
- **New property**: add an interior (layout consts + `interiorRegistry` entry + a shell in `HomeInteriors`), a `PropertyDef` + slots + fixtures in `propertyRegistry.ts`, and a `property_entrance` interactable. `validatePropertyRegistry()` must stay green.
- **New furniture**: add a `FurnitureDef` to `furnitureCatalog.ts` (validator enforces the category minimums + metric sanity).
- **New slot**: add a `SlotDef` (in-bounds, non-overlapping — the validator checks).
- **New home activity**: add an `InvitationActivityKind` (+ every switch), a `KIND_PLAN` home venue, and a `HOME_ACTIVITY_DEF` with its furniture/seat/trust gate.

---

## 10. Non-goals (v1) & future hooks
Out of scope: mortgages/ownership/resale/foreclosure; construction/wall-editing; roommates/
marriage/children/pets; utilities/bills/insurance/taxes; landlord AI/damage/burglary/
security; multiple simultaneous homes; procedural interiors; unrestricted physics
placement; romantic home activities; multiplayer; business premises; vehicle garages;
eviction/homelessness. Selling furniture is a wired-off future hook (`sellable:false`),
as is a real landlord contact and per-activity consumables.

## Test inventory
See [`docs/crime-test-inventory.json`](crime-test-inventory.json) (`housingV1`). Unit:
the `src/game/housing/*.test.ts` suite (registry, catalog, lease, eligibility, runtime,
persistence/migration, placement/commerce, metrics anti-inflation, career adapter,
hosting gates). E2E: [`tests/e2e/housing.spec.ts`](../tests/e2e/housing.spec.ts)
(properties/moving, furnishing, benefits, hosting) + regression across apartment /
save-load / economy / social. Visuals: `tests/visual/housing-visuals.spec.ts`.
