# Career, Skills & Life Progression v1 (issue #15)

A deterministic long-term progression spine under
[`src/game/careers/`](../src/game/careers/) built **on top of** the existing job
board / phone / mission / economy / inventory / social / crime / save / streaming
stacks — reimplementing none. Core loop:

> Discover a career → qualify or earn a recommendation → attend a real scheduled
> shift → complete world objectives → receive exact-once pay + performance →
> improve skills → earn promotions and visible unlocks.

**One platform, not four one-off jobs.** The career runtime owns employment, ranks,
shifts, performance, promotion progress and skill XP; **money** stays with the
economy authority, **items** with inventory, **relationships/messages** with the
social system, **wanted/arrest** with crime, and **time** with the game clock.

## Architecture + authorities

Two-tier state (like the social platform): the career runtime is an event-driven
module singleton **outside zustand**; UI re-renders via a `careerVersion` store
counter bumped on every career mutation.

| File | Owns |
|---|---|
| `careerTypes.ts` | all types + bounds constants + `CareerSaveData` |
| `skills.ts` | the 5-skill model — bounded XP, derived levels, daily-capped award reducer |
| `careerRegistry.ts` | the canonical 4-career × 4-rank registry + `validateCareerRegistry` |
| `careerEvents.ts` | `CareerState` + the ONE exact-once skill-XP pipeline |
| `careerApplications.ts` | pure eligibility + readable refusals + recommendation relaxation |
| `careerScheduling.ts` | game-time start window + full start gate + missed detection |
| `careerServices.ts` | hire / quit / schedule / missed-reconcile / standing reducers |
| `careerShifts.ts` | 4 shift templates + step machine + performance scoring + pay |
| `careerShiftService.ts` | begin / step / finalize / fail / cancel lifecycle (exact-once pay) |
| `careerPromotion.ts` | the ONE promotion service + rank unlocks |
| `careerSocial.ts` | typed employer message / memory / recommendation adapter |
| `careerRuntime.ts` | the singleton + all getters + DEV snapshot |
| `careerPersistence.ts` | the additive fail-safe save slice |

UI: [`PhoneJobs.tsx`](../src/app/phone/PhoneJobs.tsx) (discovery, skills, active job,
next shift, blocked-start reason, promotion progress, unlocks) +
[`CareerShiftTracker.tsx`](../src/app/CareerShiftTracker.tsx) (on-shift HUD).

## The four careers (§1)

| Career | Employer (NPC) | Workplace | Primary skills | Crime |
|---|---|---|---|---|
| **Delivery Driver** | City Courier Dispatch | `courier_depot` + real drops | Driving | lenient (kept open after minor crime) |
| **Café / Retail Worker** | **Maya** (`npc_maya_01`) | `food_truck_01` | Social | strict (`maxWantedToStart` 0) |
| **Gym Trainer** | **Coach Bruno** (`npc_bruno_01`) | `gym` | Fitness + Social | gated (needs Fitness 3 / a recommendation) |
| **Trade Worker** | Ironworks Yard — **Leo** (`npc_leo_01`) | `shelf_depot` (existing Supply Depot) | Work Ethic | standard |

All workplaces + shift destinations are **existing interactables** — the only
authored reuse is pointing Trade Worker at the Supply Depot (no new geometry).
A unit test asserts every workplace + anchor is a real `INTERACTABLE_BY_ID` entry.

## Skills + anti-farming (§2)

Five persistent skills — **Fitness, Driving, Social, Street Smarts, Work Ethic** —
each a bounded integer XP (0–1000) with a derived 0–10 level from an inspectable
threshold table. `applySkillAward` is the centralized reducer: XP only goes **up**
(no loss / decay in v1), and farmable reasons carry a **per-day cap** (a
`${day}:${reason}` ledger, pruned to a few days): `crime_escaped` 12, `crime_witnessed`
8, `social_activity` 20, `customer_served` 24. All XP flows through the ONE
`applyCareerEvent` funnel, deduped by a stable event id — so overlapping career /
mission / social adapters can never double-award.

## Applications + recommendations (§3)

`checkEligibility` is pure + deterministic and returns the FIRST unmet gate as a
readable reason (`Needs Fitness level 3.`, `Clear your wanted level before applying.`).
A **social recommendation** from a career's `recommendationRelaxesFrom` employer
waives its skill + reputation gates — earned when the player's relationship with that
employer NPC reaches `friendly` (Bruno → Gym Trainer), granted lazily via the typed
`careerSocial` adapter, never scattered relationship-number checks. One active
**primary** job at a time; switching preserves each career's rank + history; re-applying
resumes the highest held rank.

## Shift scheduling + lifecycle (§4)

Statuses: `scheduled → available → active → completed | missed | failed | cancelled`.
A shift is startable inside a bounded **game-time window** (1h before the start hour
through a 3h grace) — the same `shiftTimeWindow` shape as the social start window.
`evaluateShiftStart` is the full gate (returns the first blocking reason): time
window → wanted pursuit → incapacitation → another active shift → incompatible
mission → active social activity → **being at the real workplace** (the live
proximity scanner). Missed shifts reconcile **lazily** (phone / job-board open,
sleep) — never per frame — with no pay, a missed-count bump, a standing ding, and an
employer follow-up. Reload-safe shift ids come from a **persisted** `shiftSeq`.

## Shift templates (§5)

Four reusable templates, a small LINEAR step machine over REUSED world primitives
(report / collect real cargo / visit real destinations / tasks) — **not** a second
mission engine (CONVENTIONS #23). Each step gates on being at its anchor (or the
workplace for anchorless tasks); cargo flows through the real inventory authority
(`giveItem` / `removeItem`). Templates: **delivery route** (depot → parcels → drops
→ return), **café service** (report → serve / stock / clean), **gym trainer**
(report → warm-up / circuit), **trade work** (report → collect → job sites → sign off).
Each has one optional quality/safety objective.

## Performance + pay (§6/§7)

Each resolved shift produces a deterministic **0–100** performance from weighted
dimensions (attendance, required objectives, optional objective, mistakes, time
efficiency) with a readable breakdown + typed notes — no hidden randomness. Pay =
`base × rank modifier × performance modifier` (0.5–1.25), an atomic **exact-once**
event through the economy authority (`stats.money`), guarded by the shift's
`attemptKey` (a reload / repeat finalize reports total 0). Failed shifts pay a
reduced fraction for work done; missed / cancelled pay nothing. Performance history
is bounded (20).

## Ranks, promotions, unlocks (§8)

Every career ships **Trainee → Regular → Experienced → Senior**. The ONE
`promoteIfEligible` service promotes only when EVERY next-rank requirement is met
(completed shifts, skill levels, rolling recent performance, missed-shift limit, and
an optional employer-standing gate) — with a per-requirement progress breakdown in
the phone. Each rank grants a **higher pay modifier** plus at least one **visible
unlock** (e.g. `delivery_thermal_bag`, `cafe_staff_discount`, `gym_free_access`,
`trade_toolbelt`), granted exactly once. Demotions are out of scope.

## Social + crime integration (§10/§11)

`careerSocial` is a typed adapter over the **existing** social authority: employer
messages (hire / promotion / strong shift / missed shift) via the new public
`postContactMessage`, and memories / relationship changes via the ONE
`ingestSocialEvent` pipeline — never touching relationship numbers directly. Every
message + memory carries a stable id (exact-once). Crime: an active **wanted pursuit
blocks shift start**; an **arrest / incapacitation during a shift** fails it through a
typed outcome (reduced pay, standing ding) with **no permanent criminal record**.
Career-specific **employer standing** (0–100) is distinct from global reputation.

## Save / reload (§13)

An additive, fail-safe `career` slice inside `SaveData`: employment, ranks, skill XP,
employer standing, scheduled shifts, performance history, unlocks, exact-once
event/pay ledgers, and the reload-safe `shiftSeq`. Old saves load unemployed with
zero skills; malformed data is sanitized field-by-field (skills clamped, unknown
career/rank/template ids dropped, collections bounded). An **active shift never
restores mid-flight** — it migrates to a cancelled record with no duplicate pay. The
`shiftSeq` is kept ahead of any loaded shift id, so a full reload can never mint a
duplicate id / pay / XP / promotion. Reset returns canonical defaults.

## DEV observability (§14)

`careerSnapshot()` + DEV `window.GAME_TEST_API` hooks (all `import.meta.env.DEV`-
guarded → grep to **0** in `dist/`) report all five skill XP/levels, current job/rank,
employer standing, next shift + active-shift objectives, performance, applied
exact-once ids, promotion progress, and every bounded collection size.

## Extending

- **A career:** add a `CareerDefinition` to `careerRegistry.ts` (4 ranks, unlocks,
  crime gates, a `shiftTemplateId`); `validateCareerRegistry` + the anchor cross-check
  test enforce the contract.
- **A rank:** add a `RankDefinition` with a `PromotionRequirement` + unlocks.
- **A skill-award source:** emit a `CareerEvent` through `ingestCareerEvent` with a
  stable id (add a `SkillAwardReason` + a daily cap if farmable).
- **A shift template:** add a `ShiftTemplateDef` to `careerShifts.ts` (reuse existing
  anchors) — the step machine, scoring + pay are generic.

## Determinism + non-goals

No `Math.random()`, no per-frame career simulation, no per-frame progression writes,
integer bounds everywhere, deterministic ordering by stable id. **Out of scope
(v1):** universities, taxes, business ownership, passive income, a large talent tree,
permanent criminal records, housing/vehicle ownership. Typed unlock hooks may record
future housing/vehicle/business unlocks, but v1 ships an immediate visible unlock per
career.

## Test inventory

Unit: `skills` · `careerRegistry` · `careerEvents` · `careerServices` ·
`careerScheduling` · `careerShifts` · `careerPromotion` · `careerSocial` ·
`careerPersistence` (see [`docs/crime-test-inventory.json`](crime-test-inventory.json)
`careersV1`). E2E + visual coverage per issue §16 lives in `tests/e2e/careers*.spec.ts`
and `tests/visual/career-visuals.spec.ts`, plus a bounded career lifecycle soak.
