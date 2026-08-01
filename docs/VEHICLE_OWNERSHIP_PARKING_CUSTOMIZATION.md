# Vehicle Ownership, Parking & Customization v1 (issue #19)

A **deterministic** vehicle-ownership platform under [`src/game/vehicles/`](../src/game/vehicles/)
built ON TOP of the existing economy / commerce / crime / mission / inventory / housing / social /
traffic / save-load / streaming / World-Integrity authorities — reimplementing none. It preserves
the original **one-shell arcade driving model**: there is still exactly ONE physical drivable rigid
body (`vehicle_compact_car_01` / `PLAYER_CAR_ID`); ownership adds a *projection* over that shell,
never a second physics car.

Core loop: **buy** a vehicle at the dealership → it **parks** at an authored anchor → **retrieve**
it to drive → the one shell **projects** its class (tuning + footprint + paint) → **park** it again →
**repair** wear, **release** it from impound, **customize** it, carry **cargo** — while your owned
vehicles stay strictly separate from stolen ones.

## Reused authorities (no parallel systems)
| Concern | Reused authority |
| --- | --- |
| Money in/out | the economy (`stats.money`, store actions charge/refund) |
| Retail + stock + receipts | the **commerce** engine (`commerceEngine.canPurchase`, `commerceRuntime`, a new `vehicle_dealership` retail store in `storeDefinitions.ts` beside `furniture_showroom`) |
| Backpack / cargo item math | the **inventory service** (`transferItem`, `occupiedSlots`, `ItemStacks`) |
| Career eligibility (rank / skill / income) | the **career** read-only readers (`highestCareerRank`, `housingRecentCareerIncome`, `rankAtLeast`) |
| Theft / stolen identity | the **crime** vehicle stack (`vehicleCrimeState`, `stealVehicle`) — untouched; owned cars are never stealable |
| The driving shell + exit spawns | `VehicleController`, `enter/exitVehicle`, `findClearExitPosition`, `findClearPlayerSpawn` |
| Persistence | the save orchestration (`saveGame.ts` `SnapshotInput`/`createSnapshot`, store `applySnapshot`) — an additive `vehicles` slice |
| World clearance | `collisionQuery.isPointClear` (parking-anchor validation) |
| UI re-render | a `vehicleVersion` store counter (the vehicle runtime lives OUTSIDE zustand, like housing/commerce/social) |

## Architecture (module map)
- **`vehicleRegistry.ts`** — the ONE validated registry of 4 classes: **Scooter**, **Compact**,
  **Van**, **Sports**. The Compact reuses `VEHICLE_TUNING` + `CAR_HALF_*` verbatim (it is the
  migration target, so its physics never change). `validateVehicleRegistry` enforces unique ids,
  sane priced/tuning/footprint data, and a **streaming-safe** top speed (`maxSpeed + perf headroom
  ≤ MAX_STREAMING_SAFE_SPEED = 20`). The Sports car gates on `{minRank:'experienced',
  minDrivingSkill:4, minRecentCareerIncome:400}`.
- **`vehicleOwnershipTypes.ts` / `vehicleOwnershipRuntime.ts`** — the module-singleton state of
  LEGITIMATE owned assets (ids `ov_<n>`, scalars + bounded arrays only, survives streaming). Invariants:
  ≤ **4** owned; exactly **one active** (the shell); **one vehicle per parking anchor**; a bounded
  exact-once txn-key ledger; monotonic reload-safe `assetSeq`. `mintOwnedVehicle` mints AFTER the
  commerce sale and never touches crime state.
- **`vehicleOwnershipPersistence.ts`** — `serialize` + field-by-field `sanitize` (unknown def →
  Compact recovery, dup id/anchor → recovery, two-active → recovery, cargo over-cap → bounded
  overflow via `sanitizeStacks`, assetSeq behind `ov_<n>` → advanced) + `applyVehicleOwnershipSave`
  (legacy pre-vehicles save → exactly ONE Compact **migration**, exact-once; never legitimises an
  active stolen identity).
- **`vehicleProjection.ts`** — the **one-shell projection**: `getActiveVehicleProjection()` returns
  the tuning/footprint/paint the shell currently embodies. With **no active owned vehicle** it
  returns the EXACT legacy Compact baseline, so unowned / stolen / pre-migration driving is byte-for-
  byte unchanged. An active owned vehicle projects its class tuning scaled by **condition wear**
  (identity at 100) + **performance upgrades** (bounded streaming-safe).
- **`parkingRegistry.ts` / `vehicleParkingService.ts`** — 11 authored parking anchors (residence ×3,
  dealership ×2, service, impound, recovery, public ×3) with footprints; `validateParkingRegistry`
  (no anchor-anchor overlap, required categories) + `pickInitialParkingAnchorId` /
  `nearestParkableAnchorId` / `canParkAtAnchor`. Central anchors are proven clear of every world
  solid by `isPointClear` in the parking test.
- **`vehicleDealership.ts` / `vehicleEligibility.ts`** — retail + trade-in through commerce.
  `canBuyVehicle` runs the shared `canPurchase` gate PLUS vehicle gates (wanted / incapacitated /
  busy / eligibility / owned-cap) in a fixed precedence; `canTradeIn` computes a deterministic
  condition-scaled trade value; `commitVehicleSale` records the sale + a receipt.
- **`vehicleService.ts`** — repair (deterministic cost to restore to 100), impound fee + release,
  bounded impact→condition wear (`noteActiveVehicleImpact`, ×durability upgrade), and the
  retrieve/park/recover rule validators.
- **`vehicleCustomization.ts` / `vehicleCargo.ts`** — the upgrade registry (Sport Tune / Cargo Rack /
  Reinforced Frame) with pure effect readers feeding the projection (performance), cargo capacity,
  and damage (durability); cargo as `ItemStacks` over the inventory service's atomic `transferItem`.
- **`vehicleOwnershipObservability.ts`** — `vehicleOwnershipReport()` (registry validity, count/cap,
  active identity owned/stolen/none, duplicate anchors, per-asset rows) for the DEV panel + tests.
- **UI**: `OwnedParkedVehicles.tsx` (static meshes for owned PARKED cars at their anchors — the shell
  is only ever the ACTIVE car), `Vehicle.tsx` projects the active paint onto the shell, and the
  **Garage** phone app (`app/phone/PhoneGarage.tsx`) buys/trades/drives/parks/repairs/recovers/
  releases + customizes + loads cargo through the same store actions.

## The one-shell contract (§3/§6)
There is still exactly ONE physical car body. It is **hidden + disabled until an owned vehicle is
active or a car is stolen** (`isDrivingShellActive()`), so a fresh game has no free car — the on-foot
enter interactable is only offered when the shell is present (`useNearbyInteractable`). On a class
switch the ONE body reconfigures its **cuboid collider + mesh scale** to the active class, deriving
collider density so physical mass equals the class's `bodyMass` (the Compact yields exactly the legacy
`[1,0.55,2]`/mass 60 — baseline preserved). When unowned it projects the classic Compact colour; an
owned car projects its own paint + wheel style.

## The real-world contract (§4/§5/§7 — no remote summon)
Location-gated store actions require the player on foot at the authored anchor, and refuse during a
pursuit / mission / social activity / career shift:
- **buy / trade** — at a dealership bay; refuse `no_parking` when no safe initial bay exists.
- **retrieve** — player-nearness to the car's parked (or recovery) anchor; the phone guides, it never
  teleports a healthy car to you.
- **repair / install / paint / wheels** — at the authored **service** anchor; repair emits a real
  service commerce receipt.

## Store actions (all atomic; money + asset move together)
`buyVehicle`, `tradeInVehicle`, `retrieveVehicle`, `parkVehicle`, `recoverVehicle`, `repairVehicle`,
`releaseVehicleFromImpound`, `installVehicleUpgrade`, `paintVehicle`, `setVehicleWheels`,
`loadVehicleCargo`, `unloadVehicleCargo`, `startVehicleRide`, `completeVehicleRide`. Purchase/trade run
the commerce sale FIRST, guard the receipt exact-once (`markVehicleTxn`), THEN mint + charge — so money,
vehicles, cargo, upgrades and receipts can never duplicate or be lost.

## Cross-system integration
- **Crime (§7/§22)** — an arrest while driving an OWNED vehicle impounds THAT asset exactly once
  (before the crime reset, re-entrancy-guarded); stolen + unrelated parked cars are untouched. Release
  costs the displayed fee and returns the car to recovery holding.
- **Career (§10)** — `vehicleCareer.deliveryPayBonus()` is a read-only adapter (own a usable
  delivery-tagged vehicle → a flat capped bonus) folded into the shift's pay total, exact-once via the
  career `paidAttemptKeys`; the career domain stays decoupled (it receives a number).
- **Social (§11)** — `vehicleSocial.canGiveRide` (a friendly+ NPC + a usable owned seats≥2 vehicle);
  `startVehicleRide` seats a transient passenger while stopped in your own car, `completeVehicleRide`
  banks ONE memory through the existing `ingestSocialEvent`. The passenger is never persisted and is
  dropped on load or arrest.

## Owned-vs-stolen separation (§2, by construction)
Owned assets use `ov_<n>` ids in the ownership runtime and render via `OwnedParkedVehicles`. The
theft path (`stealVehicle`) resolves targets ONLY from `STEALABLE_VEHICLES` / ambient traffic — an
owned id is in neither, so a bought car can never become a crime identity, and `mintOwnedVehicle`
never touches `vehicleCrimeState`.

## Tests
- **Unit** (`src/game/vehicles/*.test.ts`, `src/game/store/vehicleStoreActions.test.ts`): registry
  validation, ownership invariants + exact-once, persistence sanitize/migration, projection baseline
  + condition + upgrades, dealership gates + trade valuation, lifecycle rules, customization + cargo,
  and store-action atomicity (money+asset+cargo, owned-vs-stolen).
- **E2E** (`tests/e2e/vehicles.spec.ts`): 41 named scenarios covering all 38 §16 behaviours, each
  driven through a production store/world action (DEV only arranges prerequisites — `vehicleGrant`,
  `vehicleStandAtAnchor`, condition/location/stock). Legacy driving specs (gameplay-flow, characters,
  districts, expansion, phone, occlusion) acquire an owned shell first via the `acquireDrivableCar`
  helper (no free car since §3).
- **Migration (§2/§3/§4)** is unit-covered (`vehicleOwnership.test.ts`): exactly one Compact grant,
  exact-once across reloads, and a live stolen shell never migrated into ownership.
- **Visual** (`tests/visual/vehicle-visuals.spec.ts`): 16 baselines (Garage states + each class
  driving + parked lot + custom paint + **off-road wheels** + an **NPC ride passenger** + dealership
  bays).
- **Soak** (`tests/e2e/vehicles-soak.spec.ts`): 200 game-days of the full lifecycle; the invariants
  (owned ≤ 4, valid registry, no shared anchors, ≤ 1 active shell, money ≥ 0) hold every iteration.

## Limitations (v1)
- Release-from-impound and cargo transfer are not player-nearness-gated (they act on an already-held
  or parked asset); buy/retrieve/repair/customize are.
- Far-sector parking anchors (loft / premium / downtown / east) are certified by the visual baselines
  rather than the central `isPointClear` sweep (which only knows the hand-authored central layout).
