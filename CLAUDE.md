# CLAUDE.md — BlockLife context primer

Condensed orientation for coding agents. Full docs live in [`docs/`](docs/) —
read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) before a nontrivial change.

## What this is
BlockLife — an **original** browser 2.5D life-sandbox game (a low-poly
orthographic city you explore on foot or by car). **Not** GTA/Rockstar IP:
every asset is procedural primitive geometry authored in this repo. ~30k LOC
TypeScript, Vite + React 19 + three.js/R3F + rapier + zustand.

## Environment (do this first)
- Node is pinned to **v23.3.0**. Prefix npm/npx:
  `export PATH=$HOME/.nvm/versions/node/v23.3.0/bin:$PATH && …`
- Ports: dev `:5173`; Playwright dev server `:5199`.
- Scripts: `npm run dev|build|lint|test`, `test:e2e`, `test:visual`.

## The one big idea: two-tier state
- **High-frequency (per frame) → module-singleton runtimes**, mutated in
  `useFrame`, never React state. The hub is
  [`src/game/world/runtimeRegistry.ts`](src/game/world/runtimeRegistry.ts)
  (`registry`: bodies, positions, headings, `npcPositions`, `movingPersonIds`,
  flags). Same pattern for traffic/weather/visibility/character/crime/police/
  combat runtimes. Store **ids + positions + scalars, never scene objects** — so
  they survive sector streaming.
- **UI-reactive → the one zustand store**
  [`src/game/store/useGameStore.ts`](src/game/store/useGameStore.ts), mutated via
  named actions.
- Composition root: [`src/app/CanvasRoot.tsx`](src/app/CanvasRoot.tsx) (global
  systems mount once; static world visuals/colliders mount per streamed sector).

## Where things live
- 26 subsystems under `src/game/*` — see the module map in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#11-module-map).
- Deep dives per subsystem: [`docs/SYSTEMS.md`](docs/SYSTEMS.md).
- Static data: `src/data/` (npcs, quests, interactables). DOM UI: `src/app/`.
- World = 144-unit sector grid (`world/sectors/`); content authored as data via
  the kit (`world/authoring/`). Streaming lifecycle
  `unloaded→loading→warm→active→unloading`.

## Non-negotiable invariants
- **Never commit unless explicitly asked** (branch first if on default branch).
- **No test API in production**: everything on `window.GAME_TEST_API`
  ([`src/game/test/gameTestApi.ts`](src/game/test/gameTestApi.ts)) is
  `import.meta.env.DEV`-guarded and must grep to **0** in `dist/`.
- **Global road graph is immutable** at runtime.
- **No full navmesh** unless repo evidence proves it necessary (avoidance =
  capped, best-effort nudges).
- **Never weaken/skip a test to make it pass**; fix the root cause. No flaky
  tests. Don't raise timeouts without measured justification.
- Determinism: seed RNG (`createRng(hashString(key))`), never `Math.random()` in
  the sim; pause snaps actors to canonical poses (visual tests depend on it).

## Top gotchas (full list in docs/CONVENTIONS.md)
1. Second-based timers must use the **real clamped delta**
   (`useFrame((_, r)=>{const dt=Math.min(r,0.05)})`), never `1/60` — headless
   E2E runs slow and stalls hardcoded-delta timers.
2. Register runtime state in `useEffect` (identity-guarded), never in render /
   `useMemo` (StrictMode double-invokes).
3. After touching a **shared system** (crowd, traffic, person-separation), run
   the **FULL** E2E suite, not just your feature's.
4. **Never run E2E and visual suites concurrently** on `:5199` — contention
   starves timing-sensitive tests into false failures. Run sequentially; re-run
   a suspicious timing failure alone before calling it a regression.
5. Honest gates only: `pipefail`, assert `passed == DEFINED` (counts derived
   from spec files, not hardcoded), `failed==0`, `skipped==0`, guard `.only`.
6. Regenerate visual baselines with `--update-snapshots=all` and **view** the PNG.

## Verification
Order: **`tsc -b --force`** → `oxlint src/` (0 errors) → `vitest run` (0 failed) →
`build` + grep `dist/` for `GAME_TEST_API` (0) → affected E2E (+ full E2E if
shared-system) → visual ×2. Ready-made: `scripts/hardening-gate.sh` (full
regression) and `scripts/crime-gate.sh`.
**`tsc --noEmit` is a no-op here** — the root tsconfig is references-only, so it
compiles 0 files and always passes. Only `-b --force` really typechecks.

## Current state
Latest sprint: **Mission & Activity Framework v1** — a reusable data-driven
mission engine (`src/game/missions/`) plus two proof missions: City Courier
(lawful, repeatable delivery) and Hot Cargo (criminal vehicle delivery: real
theft → wanted → escape → deliver). Mission #3 should be mostly authored data —
see [`docs/MISSIONS_AND_ACTIVITIES.md`](docs/MISSIONS_AND_ACTIVITIES.md).
Full gate green: unit 744, E2E 159/159 (incl. 180s mission soak), visual 83/83 ×2,
dist clean. Repo-hardening pass (2026-07-17) since then: portable gate scripts
(repo root from `$BASH_SOURCE`, `mktemp` logs), exact stolen-vehicle identity for
Hot Cargo (a decoy can't be delivered) + a real `target_vehicle_lost`, mission
persistence hardening (persisted receipts + `attemptSeq`, re-minted attempt ids —
no reward duplication across reload), a GitHub Actions CI workflow, and a README
accuracy pass. A pre-existing sector-streaming wedge (an unload→reload could stick
a sector in `loading` forever) was found and fixed in the mission sprint. Prior:
Crime v1 + hardening —
[`docs/CRIME_LAW_ENFORCEMENT.md`](docs/CRIME_LAW_ENFORCEMENT.md).
