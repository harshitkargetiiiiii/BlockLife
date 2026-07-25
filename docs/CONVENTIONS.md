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

### 18. On-path walkers: never clamp to cars; clamp to solids only once displaced
A HARD per-frame person↔vehicle/solid clamp on a WALKING citizen fights the
pedestrian logic it duplicates. Two failure modes, both surfaced only by the
**full E2E** (`citizen-destinations`, the `cit_dd_yard_worker` cross-district
commute); `tsc` + unit pass regardless:

1. **Grazing friction.** Authored paths hug solids — sidewalks run along
   buildings, crosswalk waits sit beside signal poles, door destinations are AT
   the building face — all WITHIN a 0.36 body of a solid. A clamp there shoves the
   walker off its path every frame, and the trip's tiny arrival tolerance
   (`moveTowards` ≈ 0.03/frame) can never win → it ping-pongs and the 45 s
   no-progress recovery loops forever. Mitigation: clamp ONLY when the person's
   CENTRE is inside the solid (`centreInsideOrientedBox`) — genuine embedding —
   and tolerate a body grazing an edge.
2. **Per-frame CPU drag.** Even the centre-inside clamp runs a spatial solid
   query + a vehicle-loop for *every* citizen *every* frame. Across ~77 citizens
   that measurably lowers the **headless** E2E frame rate, so every timed trip
   takes longer wall-clock time — the same commute drifted 3.3min → 4.9min → a
   6.3min timeout as clamp work was added, with no logic change.

Root fix: a walking citizen is `onPath` — it already gap-crosses via
`decidePedestrian` and steps out of cars via `CAR_CLEARANCE`, on a route validated
clear of solids. `resolvePersonOccupancy` therefore splits the two clamps rather
than skipping both:
- It **skips the VEHICLE push-out entirely** for an on-path walker. That is the
  clamp which duplicates the crossing logic (shoving it out of a car it is
  legitimately passing between) AND runs the whole-fleet loop — i.e. it is the
  source of BOTH failure modes above.
- It **still applies the MANDATORY static-solid clamp — but only once the actor
  was actually displaced this frame** (`(pos-start)² > DISPLACED_SQ`) by some
  other force (person spacing, the on-foot player push, an un-clamped police
  shove). An undisturbed walker on a validated route can't have entered a solid
  under its own steam, so it skips even the (cheap, spatial-hash) solid query —
  no grazing friction, no per-frame drag, commute perf unchanged. But a shove
  CAN drive an on-path walker's centre into a building just as easily as an idle
  one, and the "no person ever ends a frame embedded in a solid" contract must
  hold for it too. (Found by the 300 s integrity soak: police pathing through a
  plaza stroller / window shopper pinned them into `building_apartment_01` /
  `building_shop_01` — an on-path `person_solid_overlap` the old skip-both let
  persist.)

The hard clamps otherwise remain the safety net for OFF-path actors (idle,
queueing, sitting, frozen, panicking, displaced) that have no per-frame avoidance.
Keep the detector's person↔vehicle/solid definition centre-inside too
(`embedTolerance`), so grazing is never flagged as corruption on either side — and
the solid clamp's ejection matches it (centre-inside → push to tangent → depth 0),
so a clamp always clears the anomaly it would otherwise raise.

### 19. The streaming safety-ring watchdog must only touch `loading` sectors
The free-locomotion safety ring (`sectorSafetyRing.ts`) force-reloads a required
sector wedged in `loading` (bounded self-heal). It must gate on
`lifecycle === 'loading'` — NEVER force-reload the sector the player is standing
on. The current sector is always `active`, so that gate excludes it by
construction; broadening the watchdog to "any un-ready required sector" would
force-reload the active ground under the player (unloading the floor → a fall),
violating §6's "do not unload the last valid generation surrounding the player."
The soft velocity backstop is the tool for an un-ready sector being ENTERED; the
watchdog is only for one stuck being streamed IN. Also: in a test, `prewarm`
readies a neighbour before you can `holdSectorReadiness` it, so the hold clears
the ready flags directly (and release restores them if the roots are still
mounted) rather than only suppressing future reports.

### 20. Placement validation: model overhang/abutment per TYPE, never per coordinate
The 3D-placement validators (`placementValidation.ts`, canonical bounds in
`propPlacement.ts`) flag floating props + facade clips. Two legitimate overlaps
would false-positive a naive visual-envelope-vs-building check: **tree foliage**
draping over a roof edge, and a **ground AC condenser** sitting flush against its
host wall. Issue §7 forbids grandfathering screenshot defects AND forbids
per-coordinate exemptions, but allows encoding intentional overlap "explicitly
with a narrow reason." The reason must be per-TYPE (semantic), not per-instance
(a coordinate hack): `canopy: true` (trees) makes the facade check use the TRUNK
(collision) footprint — a tree GROWING inside a building is the real defect, not
leaves overhead; `abutsBuilding: true` (AC units) exempts the host-wall overlap a
wall-mounted prop is designed to have. With those two models the whole authored
city validates to ZERO defects (no data moved, no baseline churn). When you add a
prop type, transcribe its real `Props.tsx` mesh into `propPlacement` (visual
bounds ≠ collision) and run `cityPlacement.test.ts` — a failure names the exact
entity + reason; fix the DATA or add a per-type model, never a coordinate skip.

### 21. Multiple loop-walkers on one linear path collide head-on — give them lanes
`sidewalk_walkers` zones author a 2-point back-and-forth path and a `count`. The
compiler used to start walker `i` at `points[i % len]` — so with count 2 they
start at OPPOSITE ends of the SAME line, walk toward each other, and meet head-on
at the midpoint where neither can pass (path-following overrides the perpendicular
separation nudge each frame) → a permanent overlap: the lockstep class again
(gotcha #17), but authored by the compiler, not the data. The Automated City
Sweeper found it (`s1_-1_walkers_0/1` co-located, never resolving) where no
hand-authored test had. Fix at the COMPILER: offset each walker into its own
PARALLEL LANE (perpendicular to the path), so a template fix protects every
`sidewalk_walkers` zone and future ones. **Lane EVERY path-following mover, not
just `loop_walk`:** the 300s soak later caught count-2 **`visit_spot`** freight/
dock workers (`s-1_-2_freight_0/1`) colliding the same way — the loop-only guard
missed them — so the lane condition covers `loop_walk` AND `visit_spot` (stationary
`sit`/`queue`/`idle_stand` place differently; `destination_trips` leave for the ped
graph). Hand-authored opposite-direction loops are the same class, fixed in the
DATA the same way: two commuters circling one plaza rectangle → concentric
inner/outer lanes; two walkers sharing a street line at overlapping hours →
parallel lanes (gotcha #17). A compile-time pairwise **path-proximity audit**
(every ambient + compiled citizen, min segment distance < body width) is the way to
find them all at once instead of one soak cycle at a time. Two more City-Sweeper
lessons: (a)
teleporting far faster than gameplay mass-respawns a district's idle citizens at
once, and the CAPPED separation nudge takes ~1-2s to open small spawn overlaps —
so a traversal test must **poll-until-settled** (a transient resolves; only real
corruption survives), never assert on the first post-teleport frame; (b) frame a
generated visual sweep at the district's **content centroid** (its buildings),
NOT the geometric sector centre — a district whose streetscape sits in one corner
of its 144u sector would otherwise photograph empty void.

### 22. UI that reads a module-singleton runtime needs a zustand re-render bridge
The social runtime (issue #13) lives OUTSIDE zustand (two-tier state: it's
event-driven module state, like `missionRuntime`/`commerceRuntime`). But React UI
that reads it — the dialogue social menu, phone contacts/chats, the activity
tracker — won't re-render when that runtime mutates, because nothing it subscribes
to changed. The fix is a single **`socialVersion` counter on the store**, bumped by
every store action that mutates social state; the readers `useGameStore((s) =>
s.socialVersion)` purely to subscribe. Do this deliberately — relying on an
incidental `toast` bump (an earlier hack) is fragile and surfaces `act()` warnings
in tests (a store change re-rendering an already-mounted component outside React's
batch — wrap post-render `setState` in `act`). Also: a store action that is ONLY
reachable from the DEV test API is **dead in production** — it bundles but no player
path hits it. That's not a `GAME_TEST_API` leak (the test-API wrapper is
DEV-stripped), but it means the FEATURE isn't wired. Give it a real affordance
(the favor activity got an "Offer to help" dialogue button) or the slice is
incomplete.

### 23. A social "activity" is a feature, not a second mission engine
Issue #13's reusable activity templates (meet / hangout / delivery-favor) look
like missions, and the mission framework HAS `reach_zone`/`interact`/`collect`
objectives — but its defs are STATIC and offer/anchor/cooldown/money-reward driven,
so binding one dynamically to "whichever friend you invited" fights the grain.
Coupling to it would be over-engineering, not the "reuse existing systems"
mandate (which forbids DUPLICATING a general engine, not building a focused
feature). A social activity is a tiny linear step machine whose only reward is a
relationship event through the ONE social pipeline, reusing the invitation entry,
the inventory service (favor cargo), and existing world venues — no anchors, no
cooldowns, no money, no multi-instance persistence. Reuse the VOCABULARY + the
adjacent systems, not the whole engine, when the engine's shape doesn't fit.

### 24. Don't mutate runtime state inside a helper the caller then spreads over
The social runtime uses the immutable idiom `const s = runtime.state;` … `runtime.state
= { ...s, relationships, memories, … }`. If a helper called mid-way ALSO mutates
`runtime.state` directly (e.g. an id-minting helper doing `runtime.state.msgSeq++`),
the caller's `{ ...s, … }` — built from the snapshot `s` captured BEFORE the helper
ran — silently clobbers that bump back to its old value. The message-id counter
looked like it advanced (ids were unique within a call) but reset every turn, so
across a reload it re-minted colliding ids. **Fix:** thread the value through — pass
the current seq IN, return/spread the incremented seq in the SAME state object the
caller writes — never let a helper and its caller both own one field. And any
monotonic counter used to build persistent ids must live in the **serialized save
slice** (like the mission `attemptSeq`), or a fresh module load restarts it at 0 and
re-mints ids that already exist. Prove it with a reload test, not just an in-session
uniqueness check.

### 25. Measure a relationship delta at the interaction, not across a clock jump
Relationships carry time-based derived decay (older memories fade). A test that
teleports the game clock forward (e.g. `setGameDay`/`setTime` to reach a scheduled
plan's start window) and then asserts `affinityAfter > affinityBefore` across that
jump — or across a save/load that re-settles decay — conflates the interaction's
lift with the days of decay the jump legitimately applies, and the assertion flakes
or inverts (a +10 hangout read as −5). **Fix:** capture the before/after around the
interaction ONLY, at one clock; assert persistence separately (invitation status,
contact present) via the save/load round-trip. Better still, don't jump at all when
you don't need to: a next-hour proposal is already inside its 1h-early window, so
only genuinely far-future plans need the clock advanced (see the start window,
gotcha-adjacent to the destination gate).

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
