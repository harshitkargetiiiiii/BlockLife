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

### 26. `setActiveInteractable` is overwritten by the proximity scanner every frame
The DEV `setActiveInteractable(id)` hook sets `activeInteractableId`, but the live
proximity scanner recomputes it from the PLAYER'S REAL POSITION on the next
`useFrame`. So in an E2E, `setActiveInteractable(x)` only holds for code that runs
SYNCHRONOUSLY before the next frame — i.e. inside the SAME `page.evaluate`. A career
shift whose steps you advance across separate DOM clicks (each a fresh frame) sees
the scanner's value, not yours, and the workplace gate refuses — the shift never
completes (careers E2E #5–#8 failed exactly this way). **Fix:** drive a multi-step,
location-gated flow either (a) synchronously inside one `page.evaluate` (arrange +
advance in a loop — the scanner doesn't tick mid-evaluate), or (b) with a REAL
`teleport` to the target so the scanner itself sets `activeInteractableId` and keeps
it there while the player stands still (used for the café production-DOM proof, whose
steps all sit at one workplace). Don't mix `setActiveInteractable` with cross-frame
clicks.

### 27. An in-flight work item needs ONE home, and every terminal outcome must reschedule
Two lifecycle bugs the PR #16 review caught in careers, both worth generalizing:

- **One home for an active item.** `beginShift` originally left the started shift in
  `scheduledShifts` (status `active`) AND copied it to `activeShift`. On save both
  persisted; on load `activeShift` was dropped (an active run can't safely resume) but
  the scheduled twin survived as a phantom `active`-status record the next-shift
  selector ignored forever. **Fix:** when an item goes in-flight, MOVE it (remove from
  the queue), don't copy — so there is exactly one home and a save can't strand a twin.
  On load, drop any non-attendable status defensively and schedule a fresh one.
- **Every terminal outcome reschedules.** Only *successful completion* scheduled the
  next shift; miss / fail (arrest) / cancel left the player employed with "No shift
  scheduled" forever. A recurring loop must funnel EVERY terminal outcome
  (complete/missed/failed/cancelled) through one `ensureNext` that schedules the next
  eligible item exactly once (no-op if one is already pending) — and fire the matching
  side effect (e.g. the failed-shift employer follow-up) on the same path.

Both are "the happy path works, the exits dead-end" bugs a green gate hides — cover
each terminal branch explicitly (unit + a real page-reload E2E), not just the success.

### 28. A player-facing unlock must change gameplay, not just render a label
A promotion that only appends an id to an `unlocks[]` array and renders its text is
theater. Each shipped unlock must alter real production behavior through the owning
authority — the thermal bag/toolbelt change the shift's cargo gate, the café discount
flows through the vendor-discount price path, gym access waives the `train` energy gate
— and each needs a test that observes the behavior change (not the label). Likewise an
"optional objective" must be DERIVED from real outcomes (a flawless, on-time run), never
a free always-enabled button that can be claimed from anywhere.

### 29. Display and execution must read ONE options source; close the legacy doors
When a new authority (Careers v1) changes what an existing interaction shows or allows,
the DISPLAY (what the button renders — price, enabled/disabled) and the EXECUTION (what
the store charges / permits) must read the SAME resolver. PR #16 shipped a real bug from
splitting them: the store applied the café discount + gym free-access, but `ActivityPanel`
still computed prices/gates from only the social discount — so Maya's menu could show one
price and charge another, and the Train button stayed disabled while free access actually
waived the gate. Fix: one pure resolver (`careerActivityBenefits()`) consumed by both the
panel and `performActivityAction`; prove display == execution with a DOM-level test that
reads the button text AND asserts the resulting store change.

Relatedly, when a milestone becomes the sole authority for something (paid work), audit
for the OLD doors around it and close them: the world Job Board still vended money via a
standalone `workShift` (deleted → it now opens the career flow); and the mutual-exclusion
gate a shift needs must be symmetric AND complete — if career-start blocks
missions/social/sleep, then mission-accept, mission **retry** (a second start door
`acceptMissionById` didn't cover), social-start, and sleep+train must ALL block during a
shift, each through the production entry point (route DEV test hooks through the store
action, not the bridge, so tests exercise the real gate). When you add one guard, grep
for every sibling entry point (accept AND retry) — a lone guard leaves a door open.

### 30. Reuse an interior/social system without disturbing it (Housing v1)
Four traps from bolting Housing (issue #17) onto the apartment/social stacks, worth
generalising:
- **Don't place new content on top of hand-authored meshes.** The Starter Studio reuses
  `ApartmentInterior`'s hardcoded furniture *as fixtures*; its player-furniture slots sit
  in open floor, so a placed accent piece never overlaps a fixture and the apartment
  visual baseline never churns. New player-placeable slots go where the authored scene is
  empty, or you regenerate baselines you didn't mean to touch.
- **A hosted guest can't ride the city-NPC pipeline.** Named NPCs are sector-LOD-gated and
  routine-driven, and interiors live far outside CITY_BOUNDS (no sector) — a relocated NPC
  is simply *hidden*. Render the guest **directly inside the interior** (the store
  interior-civilian pattern), keyed off the ONE active social activity so completion/
  cancel/load clears it with no leak. Reuse the social *invitation/activity/relationship*
  pipeline for the consequence; add only the venue + the interior render.
- **Widening a shared union breaks its exhaustive switches.** Adding `*_home` to
  `InvitationActivityKind` compiled everywhere except an exhaustive `invitationLabel`
  switch that "lacks ending return." When you extend a union, grep every `switch` over it.
- **Occupancy is slots, not items.** A storage-overflow test (or any capacity assertion)
  must occupy real *slots* — `Σ⌈qty/stackLimit⌉`. First-aid stacks 5/slot, snacks 10/slot;
  53 first-aid kits is 11 slots, not 53. An arrange that ignores stack limits tests
  nothing (or the wrong thing).

### 31. Project onto the ONE shell; default to the legacy baseline (Vehicle Ownership v1)
Adding 4 drivable classes without a second physics body: a pure `getActiveVehicleProjection()`
returns the tuning/footprint/paint the ONE shell embodies, and the driving controller/mesh read
it. The trap is baseline churn — so the projection **returns the EXACT legacy Compact constants
(`VEHICLE_TUNING`/`CAR_HALF_*`, `DRIVABLE_CAR_COLOR`) whenever no owned vehicle is active** (on foot's
last car, a stolen car, a pre-migration save). That single default keeps every existing driving/
traffic/visual test byte-for-byte unchanged; only an explicitly-activated OWNED vehicle changes the
shell. Class differences that would desync the fixed rapier collider (size) apply to PARKED render
meshes only, not the active shell.

### 32. Keep owned vs. stolen in separate id namespaces (Vehicle Ownership v1)
"Strict owned-vs-stolen separation" is cheapest as a namespace invariant, not a runtime check:
owned assets are `ov_<n>` in the ownership runtime; the theft path resolves targets ONLY from
`STEALABLE_VEHICLES`/ambient traffic; `mintOwnedVehicle` never touches `vehicleCrimeState`. So a
bought car is structurally un-stealable and can never become a crime identity — prove it with a
test (`stealVehicle(ov_id) === false`), don't add a guard that pretends the overlap was possible.

### 33. Batch a soak's per-iteration work into ONE `page.evaluate`
A lifecycle soak that does 6+ `page.evaluate` round-trips per iteration ×200 iters blows the
standard 180s soak budget on IPC alone — and the fix is NOT raising the timeout. Do the whole
iteration (the store-action ops + the invariant snapshot) inside a single `page.evaluate` returning
the numbers to assert; the browser runs the loop, you pay one round-trip per iteration.

### 34. A settled-asset check needs a QUIET WINDOW, not a counter comparison
`assetsSettled()` compared mounted-vs-committed GLB counters, which describes a moment and
cannot tell "everything committed" from "between scenes". A sector remount (`resetGame`, a
teleport, a streaming crossing) tears the old instances down before the new ones register, so
all three counters pass through a trough reading 0 where `expected <= active + failed` is
VACUOUSLY true. Two committed baselines were captured in that trough, each holding a procedural
fallback where the GLB belongs — and the specs' own workarounds (`waitForTimeout(1200)`, then
re-check) were the same race with a longer fuse. The fix is a quiescence clock: any change to
the mount graph stamps `registry.glbLandmarkChangedAt`, and the predicate additionally requires
that nothing has moved for `ASSET_SETTLE_QUIET_MS`, that a graph is mounted RIGHT NOW
(`expected > 0`) and that at least one landmark has EVER mounted (`glbLandmarkEpoch > 0`). Those
last two are not redundant — they fail at different moments: `epoch` catches boot before the first
landmark registers, `expected` catches a full teardown that leaves the graph empty but perfectly
quiet. The lesson generalises: every "is it ready" predicate wants an explicit answer to "is there
anything here to be ready", or emptiness passes as readiness. When a shot is
ABOUT a body, name it: `waitForSceneSettled(page, { requireGlb: ['building_office_01'] })` proves
the photograph has the model rather than its fallback.

### 35. A camera-height limit belongs to the camera, not to the wave that found it
Wave 3 shipped a body that would have rendered 24.3 m tall under an orthographic camera whose
eye sits at y = 18, so the camera rendered from INSIDE it. `tsc`, lint, 1,563 unit tests, the
asset report, the placement validators, district certification and 365 E2E tests were all green;
only a visual baseline caught it. The fix at the time was a literal in that wave's intake config,
enforced for that wave's six bodies. That is a property of `FollowCamera`, not of Wave 3:
[`camera/cameraGeometry.ts`](../src/game/camera/cameraGeometry.ts) now owns `CAMERA_OFFSET` and
DERIVES `MAX_WORLD_RENDER_HEIGHT` from it, `FollowCamera` imports the offset rather than
declaring it, every world-rendered manifest entry is measured against the ceiling from the real
bytes, and an authored `def.size` that reaches the eye is a placement-validation FAILURE like a
floating prop. When a per-image gate catches a class of defect every static gate missed, promote
the rule to the layer that owns it and gate the whole city — the next body will not be in that
wave.

### 36. An authored VISUAL ENVELOPE is a contract — the envelope sizes the body, not vice versa

`propPlacement.ts` declares, per prop type, the silhouette the procedural mesh actually occupies,
and the placement validators measure against it. When a wave projects a GLB onto one of those
types, the honest move is to scale the body UNIFORMLY until it fits INSIDE that box — not to widen
the box to suit the body, and not to ship a body that quietly overhangs it. Issue #47 states it as
a rejection criterion ("exceeds its authored envelope"), and Wave 2 had already set the precedent
with the bench.

The consequence is the part worth writing down: **the envelope decides which sources are eligible
at all.** `parked_car` caps a body at 1.4 m tall and 4.0 m long, so a source's height-to-length
ratio — not its looks — decides what it becomes. Measured across the sixteen approved vehicles,
only the hatchback (h/l 0.344) fills the 4.0 m length; the family SUV (h/l 0.579) shrinks to
**2.42 m**, a toy beside it, and the bus, ambulance, garbage truck and fire engine land at
2.5–3.1 m. Two of those were rejected on semantics anyway, but the SUV would have passed every
static gate in the repo and only looked wrong on screen. Compute the fit for every candidate from
the real bytes BEFORE choosing, and reject on the number.

### 37. "Deterministic" is not "visually balanced" — a placement hash clusters, so gate the space

A `hash(id) % poolSize` mapping is reproducible, total and trivially testable, and it was the
obvious way to spread four approved vehicle bodies over 29 authored parked placements. Measured on
the shipped city it put identical bodies **5.9 m apart** in the central lot and repeated one van
three times across the industrial yard — because a hash knows the id and nothing about where the
placement stands. "No crowd of identical bodies in one camera view" is a SPATIAL property and a
hash cannot satisfy it by construction.

The fix is a deterministic spatial rule plus a gate that measures the property rather than the
mechanism: process placements in ascending id order (total, stable, independent of array position)
and give each the pool body whose nearest already-assigned instance is farthest away, ties broken
by pool order. Then assert the thing you actually care about — no two placements within
`PARKED_BODY_MIN_SEPARATION` share a body, and the pool is used within one placement of even. Do
NOT overclaim: with two bodies and three placements inside a 9 m triangle one repeat is forced by
geometry, so the threshold is "close enough to read as cloned", not "anywhere in the frame".

### 38. "The fallback" is whatever shipped LAST, not whatever is oldest in the chain

A fallback chain accumulates. `NpcCharacter` had two steps — the `blocklife_person` rig, and a
coloured `NPCMesh` capsule beneath it — and the visible pre-wave behaviour was the RIG; the capsule
had not been on screen in normal play since issue #23. Issue #47 swapped a new baked body onto the
top of that chain, and the tempting (and wrong) reading is "the fallback is unchanged, therefore
the failure case is unchanged". It is not: the failure case silently regressed two steps, from a
rigged character with a curated identity to a capsule.

When you put something NEW on top of an existing fallback, the thing it must fall back TO is what
the user saw before your change — so re-point the chain rather than inheriting its bottom. Here
that is one nested `AnimatedCharacter` (the same component as its own fallback: no second
renderer, loader or animation path), registered under a distinct instance id so a test can ask
WHICH step produced the picture. Then evidence every step: assert the middle rig is what rendered
AND photograph the bottom step by breaking both.

**And the correction that cost a wasted test run: LOADING and ERROR are different branches, and a
rich fallback belongs only to the second.** React renders a `<Suspense fallback>` on EVERY healthy
load, so passing the rich fallback as the component's one `fallback` prop mounts it on every boot
and every sector remount, not "only on failure" as the first revision's comment claimed. It is
invisible to a settled-state assertion — the instance registry is clean by the time anything looks
— and it is not free: five extra `blocklife_person` clones moved the GPU texture census at four
district vantage points from **274–276 to 329–331**, +55 retained textures, while draw calls,
triangles, materials and the registry all stayed identical. Split the props (`fallback` for
Suspense, `errorFallback` for the boundary, defaulting to `fallback` so every other caller is
byte-identical), keep the cheap primitive as the loading visual, and gate the MEASUREMENT rather
than the registry — a ceiling on the texture census is what catches this class, because the
settled state looks perfect either way.

### 39. Narrow a blanket gate deliberately; never just delete it

Wave 0 (#38) recorded an owner decision as one test: a baked single-material body must stay out of
the player slot AND out of every NPC def. Issue #47 authorises exactly half of that to change. The
temptation is to delete the assertion; the right move is to split it:

- keep the permanent half **verbatim** — the save-backed player wardrobe needs recolorable slots, so
  a baked body may never be the player;
- replace the circumstantial half with a STRONGER contract rather than none — a named NPC may ride
  the ONE approved body that depicts that exact character, expressed as a `Record<npcId, assetId>`
  that a new test proves is total, **injective**, absent from the player slot, and — the part that
  actually prevents identity swapping — built from the sources of the character it names (the
  contract cross-checks the runtime mapping against the intake config's own per-character source
  paths, so a body cannot be renamed onto another NPC without its source file disagreeing);
- leave the old register meaningful: `CANDIDATE_*` still means "approved body with NO runtime home",
  and the old test now guards that definition instead of guarding nothing.

Write the reason down in the test itself. A future reader has to be able to tell "this rule was
narrowed on purpose, here is what replaced it" from "someone deleted an assertion to go green".

### 40. A visual shot that DRIVES the car must wait for the car to land

`resetGame()` re-seats the ONE drivable shell at `CAR_SPAWN`'s **y = 0.8** and lets physics drop
it. `VehicleController` then writes the car's velocity every frame as
`setLinvel({ x: vx, y: vel.y, z: vz })` — it preserves whatever vertical velocity it finds. So a
test that enters the car BEFORE it lands hands the controller a residual upward velocity that it
faithfully keeps forever: the car climbs, the follow camera climbs with it, and the whole frame
shifts by several pixels. Measured on issue #47's branch: entered at y = 0.302, climbing to 0.717
over six seconds, producing 40k–139k pixel diffs in which every building edge and every world
label was DOUBLED.

The window is narrow — at the merge base the same tests entered a car already at y = -0.00006 and
were stable 10/10 across three runs — which is what makes this so easy to misdiagnose. Anything
that shifts pre-shot timing exposes it, and the resulting mismatch looks exactly like a content
change until you notice the HUD moved too. **A whole-frame offset with doubled labels is never a
content diff; it is the camera, and the camera follows a physics body.**

Diagnosis discipline that mattered here, because four plausible causes were all wrong:
`colliders={false}` on every rapier body ruled out new colliders; forcing primitives made the
drift WORSE, ruling out render cost; frame time was a flat 50 ms on both, ruling out dt; and the
base had MORE and LARGER main-thread spikes (2142 ms vs 1623 ms), ruling out stalls. What settled
it was hashing `-actual.png` across repeated runs (three distinct hashes = nondeterminism, not
content) and running the SAME spec at the merge base (stable there = introduced, not inherited).

The fix belongs in the shot's readiness contract, never in the tolerance: `acquireDrivableCar`
now waits for `waitForVehicleGrounded`, backed by a DEV `getDrivableVehiclePosition()` — the
existing `getStats().position` only reports the car once you are ALREADY driving, which is too
late to ask. With the car grounded, the branch's frames matched the committed baselines exactly
and **no baseline needed updating**.


---

### 41. A leftover dev server makes a cross-worktree A/B measure the WRONG code

`playwright.config.ts` pins port 5199 and sets `reuseExistingServer: !process.env.CI`. So a run
launched from *any* worktree attaches to whatever is already listening on 5199 — including a
server another worktree (or an earlier chunked run) left behind. The spec files come from the
worktree you launched in; the **application** comes from whoever owns the server.

Issue #47 lost a full attribution round to this. Two visual baselines were A/B'd against the exact
merge base to decide whether a change was pre-existing; the base worktree's runs reported the same
failures as the branch, which read as "pre-existing, not ours". They were not: a vite server from
the branch worktree was still bound to 5199, so the "base" runs rendered the branch's code with the
base's specs. Re-measured with Playwright owning its own server, the merge base **passed all 17**
images — the exact opposite conclusion, and the one that made the branch's real side effect
visible.

The failure is silent. There is no warning, the run looks completely normal, and a same-worktree
run is unaffected — which is why it survives casual checking.

**Before any cross-worktree comparison, assert the port is free and let Playwright start the
server:**

```bash
while lsof -nP -iTCP:5199 -sTCP:LISTEN >/dev/null 2>&1; do sleep 2; done
```

Between the two sides too, not just at the start — Playwright stops only the server it started
itself. If you deliberately share one dev server to save laptop time (a legitimate memory-saving
trick for a long per-spec sweep), every run in that sweep must come from the SAME worktree, and the
sweep must end by freeing the port.

### 42. A character body authored at REAL human height is the wrong size for this world

BlockLife's people are stylised, not scale models. `blocklife_person` — the player's rig, and the
body every named NPC rendered as before issue #47 — measures **2.930 m** from the shipped bytes.
An approved external body authored at a correct real-world 1.70–1.84 m is therefore **60 % of the
size of everyone already in the city**, even though nothing about it is wrong in isolation.

Issue #47 Wave 4 shipped exactly that mistake and it survived the whole contract gate: the rig was
canonical, the skeleton signature matched, the skin weights were valid, the base was grounded, and
the intake asserted the measured height equalled the declared height — **1.70 m measured, 1.70 m
declared, green**. Every check was about the body's internal consistency. None compared it to what
it replaced. It was caught by looking at the "player beside each named resident" screenshot, and
then measured: a **1.674x** rendered silhouette ratio between player and NPC, against **1.665**
predicted from the two bounding boxes.

**Fit the body to the thing it replaces, and gate the RENDERED height, not the authored one.** This
is CONVENTIONS #36 restated for characters — there, an authored `propPlacement` envelope sizes a
prop body; here, the rig's height sizes a character body:

```ts
scale: RIG_HEIGHT_METERS / measuredHeightMeters   // 2.93 / 1.76 = 1.6648
```

with the gate asserting `scale * measured === rig height` per body, the reference rig re-measured
from its own bytes, and every pinned height tied to the sha256 of the file it was measured from so
a re-authored body fails instead of silently keeping a stale scale
(`src/game/assets/wave4Contract.test.ts`).

**`scale` is not the whole transform.** `AnimatedCharacter` renders
`def.scale x bodyBuild[axis]`, and the issue #23 build vector is NON-UNIFORM — `broad` is
[1.13, 0.99, 1.13], `stocky` [1.08, 0.93, 1.08]. On a rig whose proportions the repo authors that
is the point. On a fixed, owner-approved body it distorts the art AND changes the height you just
fitted: Bruno rendered 2.725 m, not 2.930 m. Give such a body an explicit
`proportions: 'authored'` policy, resolve it in ONE helper the renderer and the gate share, and
assert the RUNTIME vector (uniform on all three axes, `scale x build.y x measured`) rather than
`scale` alone — a gate that multiplies only `scale` will report the height you intended while the
renderer produces a different one. Keep the registry build on the fallback rig, which is still a
rig.

Three traps worth naming:

- **The declared `bounds`/`anchors` are not the model's bounding box.** `blocklife_person` declares
  `visualHeight: 1.92` while its GLB measures 2.930 — and 2.930 is what it renders (every mounted
  instance reports a world `Box3` of h = 2.930 with feet at y = 0). Rendering uses the model and
  `def.scale`; the declarations are a separate authored contract. Treat them separately: `bounds`
  describe the MODEL, so a fitted body keeps its own; `anchors` are world offsets that are NOT
  multiplied by `def.scale`, so a fitted body must adopt the RIG's, or every label attached to that
  NPC moves. Expect a gate written in declared arithmetic to disagree with one written in measured
  arithmetic — say which one each gate speaks, at the gate.
- **"Same absolute height" is not the invariant — "same height as before" is.** The point is not
  that an NPC is 2.93 m; it is that swapping its body must not change its size, because the crowd,
  the camera framing and everything anchored to it were tuned against the old one.

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
