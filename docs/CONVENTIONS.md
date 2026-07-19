# BlockLife — Conventions & Gotchas (engineering playbook)

The patterns every subsystem follows, and the pitfalls that have cost real bugs
across past sprints. If you're starting a sprint, read this and
[ARCHITECTURE.md](ARCHITECTURE.md) first — most of the traps below were
discovered the expensive way (a whole sprint's tests silently green while
something was broken).

---

## Environment

- **Node is pinned to v23.3.0.** Prefix every `npm`/`npx` command with
  `export PATH=$HOME/.nvm/versions/node/v23.3.0/bin:$PATH &&`. Older Node breaks
  Vite 7 / jsdom.
- **Dev server ports:** app dev is `:5173`; the Playwright dev server is `:5199`
  (config: `workers: 1`, `retries: 0`, `testDir` split into `tests/e2e` and
  `tests/visual`).
- **Never commit unless explicitly asked.** If asked, branch first if on the
  default branch.

---

## Patterns to FOLLOW

### 1. Pick the right state tier
- **Changes every frame? → a module-singleton runtime**, mutated in `useFrame`,
  never React state. Store **ids, positions, scalars — never scene objects.**
- **The UI reacts to it? → the zustand store**, mutated through a named action.
- The two tiers meet only at explicit action boundaries (`interact`,
  `enterVehicle`, `applySnapshot`, …). See [ARCHITECTURE.md §3](ARCHITECTURE.md).

### 2. Make it survive streaming
Durable state (a pursuit, a trip, an incident) lives in a module singleton keyed
by id; the **sector-owned React component renders _from_ it**. A component that
unmounts when its sector streams out must not be the source of truth for
anything that should outlive the unmount.

### 3. Use the real, clamped frame delta
```ts
useFrame((_, rawDt) => { const dt = Math.min(rawDt, 0.05); /* … */ })
```
Any second-based accumulator (timers, cooldowns, panic windows, arrest holds)
**must** use this. See gotcha #1.

### 4. Keep the simulation deterministic
- Seed RNG from a stable key: `createRng(hashString(key))`
  ([`routeRng.ts`](../src/game/traffic/routing/routeRng.ts)). Only cosmetic-only
  randomness may use `Math.random()`.
- Break ties deterministically (A* breaks on segment id).
- Heavy work (pathfinding) runs **on events, not per frame**.
- The **road graph is global and immutable** at runtime — never mutate it.

### 5. Author content as data, compile to a scene
New city content is a declarative sector spec compiled + validated by the
authoring kit, not hand-placed meshes. Signals, crossings, destinations, and
crossing art are all compiled metadata attached to a sector. See
[DISTRICT_AUTHORING_KIT.md](DISTRICT_AUTHORING_KIT.md).

### 6. Factor pure logic out of components
Decisions, rules, and state machines are side-effect-free functions
(`planDismounts`, `decidePedestrian`, `questTransition`, `tickNeeds`,
`computeDesiredLifecycles`) unit-tested directly; the React component is a thin
driver that calls them and applies side effects. This is why ~693 unit tests can
cover the sim without a browser.

### 7. Gate test-only surface behind DEV
Everything on `window.GAME_TEST_API` is guarded by `import.meta.env.DEV` and
**must be verified absent from `dist/`** (the gates grep for it). Production
ships no test hooks.

---

## Gotchas that have bitten past sprints

Each of these caused a real, hard-to-see failure. They're also captured as agent
memory; the file names are noted for cross-reference.

### 1. Hardcoded `1/60` frame delta stalls headless timers
`useframe-delta-not-hardcoded` — Headless E2E runs slower than 60 fps. A
second-based accumulator advanced by a hardcoded `1/60` (instead of the real
`useFrame` delta) accrues per-*frame* not per-*second*, so a "1.2 s" arrest hold
never elapses within the test's wall-clock budget and the test times out.
**Always** clamp the real delta (`Math.min(rawDt, 0.05)`). Measure perf in
Vitest; measure *behavior* via E2E.

### 2. StrictMode double-invokes render/useMemo
`react-strictmode-runtime-registration` — Registering a runtime body (or any
singleton mutation) in the render phase or `useMemo` runs twice under StrictMode
and can strand a stale singleton. Register in `useEffect` with an
**identity-guarded cleanup**; recreate disposables on remount.

### 3. Person-separation can silently deadlock trips
`person-separation-moving-only` — A naive all-pairs walker separation pushes
moving walkers back against **stationary** people (idlers, sitters, queuers) at
chokepoints and deadlocks historical citizen trips — invisible to a feature-only
gate that never runs those suites. The fix: push **moving-vs-moving only**,
capped below walk speed, advisory (best-effort, not a navmesh). **Rule: after
touching a shared system (crowd, traffic, separation), run the FULL E2E suite,
not just your feature's.**

### 4. Two Playwright suites at once starve timing-sensitive tests
`parallel-playwright-contention` — Running the E2E suite and the visual suite
**concurrently** on the shared `:5199` server doubles render load, drops the
headless frame rate, and starves second-based timers (e.g. the arrest hold) into
**false** timeouts. Observed: `crime.spec.ts` "police arrest" failed once
contended, then passed 3/3 alone. **Run suites sequentially.** If a
timing-sensitive test fails, re-run it alone before treating it as a regression.

### 5. `playwright … | tail` hid failures for whole sprints
`gate-pipefail-truncation` — Piping a Playwright run through `tail` (or globbing
a reporter line) let failures scroll off and reported green. Gates now use
`set -o pipefail`, assert **`passed == DEFINED`** (expected count derived from
the spec files, never hardcoded), `failed == 0`, `skipped == 0`, and guard
against stray `.only`/`.skip`. See [`scripts/hardening-gate.sh`](../scripts/hardening-gate.sh).

### 6. Visual baselines silently keep stale pixels under tolerance
`visual-baseline-update-all` — Playwright's default changed-mode baseline update
can keep a stale baseline when the diff is under the ~3% tolerance. To
regenerate baselines intentionally, use `--update-snapshots=all`. Always
**view** a newly written baseline PNG to confirm it shows what you intended.

### 7. `playerPosition` is stale while driving
`streaming-avatar-anchor` — While driving, the streaming avatar / follow target
is the **vehicle**, so `registry.playerPosition` is stale. Use
`getFollowTargetPosition(mode)` for "where is the player-controlled thing."
Also: far sectors need their **own** floor colliders (don't assume the home
sector's ground extends).

### 8. Speed clamps must carry a blockage reason
`clamp-reason-classification` — A speed clamp applied *after* the decision engine
(e.g. final containment) must propagate a **blockage reason**, or the staged
recovery mis-escalates at long red lights (thinks it's stuck when it's just
waiting). Classify the reason wherever you clamp.

### 9. Signal-scope + pause-pin
`signal-scope-and-pause-pin` — Unsignalled-street rules must **exclude**
signal-governed zones (don't double-govern an intersection). And `pauseWorld`
snaps the signal clock to 0 unless it's pinned — pin the signal clock when a
paused visual scene needs a specific phase.

### 10. Don't add a duplicate import (crashes at boot, slips past tsc)
A duplicate top-level import can crash the app at first render (so `ready()`
never becomes true) while **passing `tsc`** — it's only caught by the build +
E2E. If E2E can't reach `ready()`, suspect a boot-time crash, not a test bug.

### 11. Don't edit source while E2E is running
The dev server has HMR; editing source mid-run contaminates the running suite.
Let a run finish (or stop it) before editing.

### 12. `tsc --noEmit` checks ZERO files — use `tsc -b --force`
The root `tsconfig.json` is a solution file (`"files": []` + `references`), and
`--noEmit` without `-b` doesn't build referenced projects. Measured:
`tsc --noEmit --listFiles` → **0 files**; the app project → **1556**. So plain
`tsc --noEmit` **always passes**, no matter how broken the code is — it was
stage 1 of both gate scripts and of this doc's own workflow for several sprints,
reporting `PASS` while checking nothing. Only `npm run build` (`tsc -b`) ever
typechecked, and it runs late. Use **`npx tsc -b --force`** (`--force` defeats
`.tsbuildinfo` incremental skipping, which can also return a stale PASS).
Corollary: `noUnusedLocals`/`noUnusedParameters` live only in `tsconfig.app.json`,
so unused-symbol errors are invisible to both the vacuous form and oxlint.

### 12b. A generation/epoch in module state belongs in the React key
Streamed sector roots are keyed `${id}:${generation}` and take `generation` as a
**prop** (effect deps `[id, generation]`). With `key={id}` alone, an
unload→reload could coalesce into "no membership change": React kept the same
instance, the readiness effect never re-ran, and since `stepLifecycle` clears the
ready flags on `unloaded→loading` and only leaves `loading` once they're true
again, the sector wedged in `loading` **forever** — a hole in the world with no
colliders, which also silently blocked teleports into it (the teleport
coordinator waits for destination-ready). ~1 run in 8; the signature was
`lifecycle:"loading"` + `visualsReady:false` + **`staleCompletions:0`**.
Related: readiness reports must be generation-guarded in **both** directions —
React's `useEffect` cleanups are passive and flush async, so generation N's
cleanup can land after generation N+1's mount and clear a live flag.

### 13. A throwing `useFrame` freezes the ENTIRE R3F loop
One per-frame callback that throws stalls **every other** `useFrame` in the app —
so the symptom appears in unrelated systems (interaction prompts stuck, teleports
not applying) and points nowhere near the culprit. `MissionMarkers` read a
mistyped field (`streamingRuntime.sectors` vs `.states`), threw once a mission
went active, and silently killed the whole simulation. Drive any new per-frame
component in a live/E2E run with `page.on('pageerror')` asserted empty before
believing it works.

### 14. Don't CAPTURE a module-runtime array in render — fetch it in the frame
A `useFrame` that closes over `const actors = getRuntimeArray()` read at render
time goes **stale** the moment a reset rebuilds that array: the component keeps
mutating the orphaned array while every reader (UI mirror, test API) sees a fresh,
never-stepped one. The store-civilian reactions silently stopped working after any
`resetActivities()` for exactly this reason — the E2E showed `frames>0` and the
threat gate ON, yet `crouch` stayed `0`. Fetch the live array **inside** the frame
(`const actors = getCivilians(...)` per tick; the count is invariant so a
render-time copy is still fine for the ref pool). Same family as gotcha #2/#12b:
module-singleton state and React render scope must not be conflated.

### 15. A `use*`-named store action trips rules-of-hooks when called bare
`react-hooks/rules-of-hooks` reads **any** identifier matching `use[A-Z]` as a
React Hook. A zustand action named `useItem` is fine as a store key and fine via
member access (`s.useItem`, `getState().useItem(id)`), but the moment you
destructure it to a same-named local and call it **bare inside a callback**
(`const useItem = useGameStore(s => s.useItem); onClick={() => useItem(id)}`) the
linter sees a Hook called from a callback and errors — a hard lint failure, not a
warning. This slipped past `tsc` (types are correct) and every test (behaviour is
correct) and only the gate's `oxlint` caught it. Fix: alias the selector to a
non-`use*` local (`const consumeItem = useGameStore(s => s.useItem)`); better yet,
don't prefix store actions with `use`. Same root as gotcha #10 — a real defect
that only the full gate surfaces, so never skip lint.

### 16. Occupancy must be trip-safe in a waypoint world (mover-yields deadlocks)
A universal person-occupancy resolver that makes a MOVING actor yield around a
STATIONARY one (even with a capped nudge) will **strand waypoint trips**: a
citizen whose destination legitimately sits beside an idler gets pushed off its
path every frame and never arrives. This reintroduces the exact deadlock the
legacy moving-only separator avoided (gotcha: `person-separation-moving-only`).
`tsc` + unit tests pass; only the **full E2E** (`citizen-destinations` trip soak,
`cit_g_plaza_stroller stranded`) catches it. Fix: run the resolver with
`yieldAroundStationary:false` on the live path — movers separate from movers,
idlers repair overlaps among themselves, transient mover-through-idler contact is
tolerated (only SUSTAINED overlap is corruption). Always run the FULL E2E after a
person-separation change (gotcha #3 / non-negotiable #3).

### 17. Runtime separation can't fix authored-lockstep actors — fix the data
When a sustained overlap survives the occupancy resolver, suspect an **authored
defect**, not the resolver. Two citizens sharing a start position + waypoints +
speed march in lockstep and stay perfectly co-located forever — the capped nudge
can't overpower two actors locked onto the same target. The Harbor Cross
`cit_hc_*` loop/shuttle pairs were exactly this; the fix was to de-conflict the
authored lanes (parallel interior lanes), not to fight it in the resolver. The
issue is explicit: "do not grandfather screenshot defects" — fix the data. The
structural prevention is anchor-clearance validation (a later World Integrity
phase) that flags co-located authored anchors at build time.

---

## The verification workflow (honest gates)

For any non-trivial change, run in this order and **read the counts, not a
glanced tail**:

1. `tsc -b --force` — clean. (**Not** `tsc --noEmit`; see gotcha 12.)
2. `oxlint src/` — 0 errors (pre-existing fast-refresh warnings are OK).
3. `vitest run` — `failed == 0`.
4. `npm run build` + grep `dist/` for `GAME_TEST_API` (must be 0).
5. E2E — the affected specs, then (if you touched a shared system) the **full**
   `tests/e2e`; assert `passed == defined`, `failed == 0`, `skipped == 0`.
6. Visual — `tests/visual`, twice for stability; view any regenerated baseline.

Ready-made:
- [`scripts/crime-gate.sh`](../scripts/crime-gate.sh) — crime-scoped gate.
- [`scripts/hardening-gate.sh`](../scripts/hardening-gate.sh) — full regression
  gate (tsc, lint, unit, build+dist, full E2E, full visual ×2), sequential,
  derived counts, `.only`/`.skip` guard, `pipefail`.

Both are the template for a new feature's gate: **derive expected counts from the
spec files, never hardcode them** (a hardcoded count goes stale the moment
someone adds a test, and then the gate lies).

---

## Keeping docs current (part of "done")

Docs are treated like tests: a doc that names a file, flag, or count that no
longer exists is a defect — it sends the next sprint down a wrong path. Update
them **in the same change**, not "later". The full-regression gate
([`scripts/hardening-gate.sh`](../scripts/hardening-gate.sh)) prints this
checklist at the end as a reminder:

- New / changed subsystem → [SYSTEMS.md](SYSTEMS.md) (or the feature doc).
- New cross-cutting pattern, or a bug that bit you → [CONVENTIONS.md](CONVENTIONS.md) (add the gotcha).
- New module / big rewire → [ARCHITECTURE.md](ARCHITECTURE.md) module map + data-flow diagram.
- Shipped a feature → the "Current state" line in [../CLAUDE.md](../CLAUDE.md).
- New test suite / changed counts → [crime-test-inventory.json](crime-test-inventory.json).

---

## Repository policies (standing constraints)

- **Original IP only.** No third-party/branded assets, maps, or characters —
  everything is procedural primitive geometry. This is not GTA/Rockstar.
- **No full navmesh** unless repository evidence proves it necessary. Avoidance
  is best-effort, capped nudges.
- **Global road graph is immutable** at runtime.
- **No test API in production** (`dist/` grep must be 0).
- **Never weaken a test** to make it pass; fix the root cause. No flaky tests —
  if something is flaky, diagnose it (often contention, gotcha #4).
- **Don't merely raise timeouts** to fix a timing failure unless measured
  simulation timing justifies it; document the measured healthy vs loaded timing
  when you do.
