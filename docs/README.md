# BlockLife — Documentation Index

Start here. Every doc, what it's for, and the order to read them in.

## Read in this order

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — the master doc. Tech stack, the
   two-tier state model (the one big idea), the frame loop, determinism &
   pause, sector streaming, save/load, test infrastructure, and a **module map**
   of all 26 subsystems. *Read this first.*
2. **[CONVENTIONS.md](CONVENTIONS.md)** — the engineering playbook: patterns to
   follow, and the gotchas that have cost real bugs (hardcoded delta, StrictMode
   registration, person-separation deadlocks, Playwright contention, gate
   truncation, stale visual baselines…). *Read this before writing code.*
3. **[SYSTEMS.md](SYSTEMS.md)** — deep dives on every subsystem that doesn't have
   a dedicated doc: player/vehicles/camera, controls, traffic & routing,
   citizens & destinations, NPCs/dialogue/quests, characters, visibility/
   occlusion, weather, simulation, interaction/economy, apartment, assets,
   save/load, audio, UI.

## Feature docs (the three big areas)

- **[LARGE_CITY_FOUNDATION.md](LARGE_CITY_FOUNDATION.md)** — the world grid and
  sector-streaming foundation (lifecycle, simulation tiers, teleport coordinator).
- **[DISTRICT_AUTHORING_KIT.md](DISTRICT_AUTHORING_KIT.md)** — how to author new
  city content: the sector recipe, template catalog, validation rules, plus the
  signals / pedestrian-crossings / destinations / surface-art layers built on it.
- **[CRIME_LAW_ENFORCEMENT.md](CRIME_LAW_ENFORCEMENT.md)** — crime events,
  witnesses, wanted levels, police dispatch + road-graph pursuit + dismounted
  officers, firearm/health/damage, arrest/incapacitation recovery, and the
  save/load + apartment/wanted policy. Includes the verification status and the
  known person-separation limitation.
- **[MISSIONS_AND_ACTIVITIES.md](MISSIONS_AND_ACTIVITIES.md)** — the data-driven
  mission framework: how to author a mission (definitions, anchors, the ten
  objective kinds), the event vocabulary, pay-once reward receipts, in-game-hour
  cooldowns, validation, save policy, streaming safety, and how to add mission #3.
- **[CRIMINAL_ACTIVITIES.md](CRIMINAL_ACTIVITIES.md)** — the store-robbery
  subsystem: threat detection, deterministic cashier + loot, unsecured proceeds +
  securing, alarm→crime reporting, the wanted-decay anti-exploit, the reusable
  interior registry, and the Corner Take mission that observes (not owns) it.
- **[SOCIAL_RELATIONSHIPS_AND_MEMORY.md](SOCIAL_RELATIONSHIPS_AND_MEMORY.md)** — the
  deterministic social platform: the six-actor registry, the integer-bounded
  relationship model + bounded memory ledger, the ONE exact-once event pipeline,
  contextual interactions + gifts + anti-farming, phone contacts/messages/
  invitations + scheduling, reusable activity templates + Coffee-for-Ravi compat,
  observe-only crime/economy consequences, and the additive fail-safe save slice.
- **[CAREERS_SKILLS_AND_PROGRESSION.md](CAREERS_SKILLS_AND_PROGRESSION.md)** — the
  deterministic career platform: 4 careers × 4 ranks, the skill model, scheduled
  shifts + reusable shift templates, base×rank×performance pay, promotions/unlocks,
  and the career→social adapter.
- **[HOUSING_FURNITURE_AND_PROPERTY.md](HOUSING_FURNITURE_AND_PROPERTY.md)** — the
  deterministic housing platform: 3 property tiers + lease/rent lifecycle, atomic
  moves, 19 furniture defs as unique assets, production Furnish mode over authored
  slots, the ONE bounded metric calculator + real sleep/storage/wardrobe/hosting
  effects, the career/social integration, and old-apartment→Starter-Studio migration.
- **[VEHICLE_OWNERSHIP_PARKING_CUSTOMIZATION.md](VEHICLE_OWNERSHIP_PARKING_CUSTOMIZATION.md)** —
  the deterministic vehicle-ownership platform: 4 classes, the ONE-shell projection
  (defaults to the legacy Compact), dealership + trade-in through commerce, authored
  parking/retrieve/recover, condition/repair/impound + crash wear, per-asset cargo over
  the inventory service, customization (upgrades + paint), the Garage app, legacy→Compact
  migration, and the strict owned-vs-stolen identity separation.

## Reference data

- **[crime-test-inventory.json](crime-test-inventory.json)** — machine-readable
  test inventory (unit/E2E/visual counts per spec) and the final hardening-gate
  result.

## Project-level

- **[../README.md](../README.md)** — player-facing overview, controls, how to run.
- **[../CLAUDE.md](../CLAUDE.md)** — condensed context primer for coding agents
  (env, invariants, gotchas, where things live).

## Verification

- **[../scripts/crime-gate.sh](../scripts/crime-gate.sh)** — crime-scoped honest gate.
- **[../scripts/hardening-gate.sh](../scripts/hardening-gate.sh)** — full-regression
  honest gate (tsc, lint, unit, build+dist, full E2E, full visual ×2).

---

### Map of the territory

```
Player-facing  →  README.md
Agent primer   →  CLAUDE.md
                       │
        docs/  ┌───────┴─────────────────────────────┐
               │                                       │
        ARCHITECTURE.md  ── the big picture ──►  module map
               │                                       │
        CONVENTIONS.md   ── patterns + gotchas         │
               │                                       ▼
        SYSTEMS.md       ── deep dive per subsystem ──►  code (src/game/*)
               │
        feature docs:  LARGE_CITY_FOUNDATION · DISTRICT_AUTHORING_KIT
                       CRIME_LAW_ENFORCEMENT · MISSIONS_AND_ACTIVITIES
```
