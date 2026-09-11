# Issue #27 — Ravi idle promotion: delivery record

Branch `feat/issue-27-ravi-idle-promotion`, based on `d81d73ddb15f94185e949a3a302b0263652dbbb0`.
**Draft PR — not for merge.** Design and rationale: [`docs/RAVI_IDLE_PROMOTION.md`](../../RAVI_IDLE_PROMOTION.md).

## 1. Hashes

| | sha256 | bytes |
| - | - | ---: |
| Wave-0 merge output (asserted **before** deriving) | `f9ac3d5b8606c34007de89bfed05a764cfd2a4b843bb000e44fd0713488d6fe4` | 1,032,400 |
| Shipped, derived (asserted **after**) | `7deab5d70a127e42a2433648906e9cdd6cfdf7415723e5f6d1e13a87e06c56a7` | 1,054,852 |
| Delta | | **+22,452** |

`7deab5d7…` is the byte-for-byte artifact that was authored, structurally verified and in-game
validated outside the repo before this branch existed. The in-repo recipe reproduces it exactly, and
did so twice in a row before it was wired into the build.

Pinned in three places, all cross-checked by `src/game/assets/raviIdleContract.test.ts`:
`wave0.config.mjs` (`derive.outputSha256`), `docs/asset-provenance/wave0-provenance.json`, and
`wave4.config.mjs` (`RIG_FIT.blocklife_ravi_01.sha256`).

## 2. Commands and results

| command | result |
| - | - |
| `node scripts/asset-intake/buildWave0.mjs` | 5 assets; Ravi → `7deab5d7…`, Idle 4 s |
| `node scripts/asset-intake/buildWave0.mjs --check` | **all 5 reproduce byte-identically**, exit 0 |
| `git status` after a rebuild | only Ravi's GLB + provenance differ — the other four outputs are byte-identical |
| `npx tsc -b --force` | **0 errors** |
| `npx oxlint src/` | **0 errors** (pre-existing `only-export-components` warnings unchanged) |
| `npx vitest run` | **188 files, 1680 tests, 0 failed** (7 new) |
| `npm run build` | ok; `grep -rc GAME_TEST_API dist/` → **0 matches** |
| `node scripts/checkDistClean.mjs` | `dist/ clean — scanned 51 files` |
| `npm run gate:assets` | **38 assets, 0 over budget** |
| `node scripts/human-proof/inspectRig.mjs` (derived Ravi) | 24 bones, `c432d433d51d`, 24 bind matrices, **1.76 m base-at-ground**, 0 zero-weight verts, clips Idle 4 s / Walk 1.067 s / Run 0.667 s |

## 3. Preservation — proved against the pre-change bytes

`raviIdleContract.test.ts` pins digests taken from `d81d73d`'s Ravi, so these are not
self-referential. All 7 tests pass:

geometry (POSITION/NORMAL/TEXCOORD_0/JOINTS_0/WEIGHTS_0 + indices), all 74 node rest transforms,
skin joint order + inverse bind matrices, material factors **and** `KHR_materials_ior`, embedded
texture bytes, and both Walk and Run sampler sets — **identical**. Idle alone differs: 72 channels
(unchanged count), 4.000 s, 33 keys, LINEAR, with only the 11 breathing rotations non-constant and
every lower-body and every translation/scale track constant. Loop closure max |q(0) − q(4 s)|
≈ 1.4e−17. Forward kinematics at Idle t=0: elbow bend 11.5° (was 114.3°/114.8°), wrist below the
elbow on both sides.

## 4. Motion evidence — continuous, unpaused, no freeze API

Harness and raw data: `BlockLife-intake/ravi-promotion-2026-09-10/` (`harness/motion.mjs`,
`harness/period-probe.mjs`, `out/motion.json`, `out/late-window.json`, `out/period-probe.json`).
One owned Vite server and one owned browser, two sequential contexts on the same branch build: the
**candidate** is the committed file with nothing intercepted; the **control** is the pre-change
`f9ac3d5b…` bytes served to that browser only by route fulfilment.

**Both contexts verified Ravi stationary**: at hour 9 his routine holds him at `[-8.5, 0, -5]` with
`animState: idle` and `speed: 0` for the entire capture (position range 0.0000 on both axes). At
13:00 he walks 5.8 m in the same window, which is why hour 9 is the one used.

**Repeated, uninterrupted visible motion — measured live, not frozen and not modulo.** A 150 s
screencast capture, world running, `timeScale 0` only to stop the sun drifting. In a late 40 s window
the candidate's rendered pose oscillates between 0 and 3,829 changed pixels (of 13,680 in Ravi's
torso/arm region) and returns to a near-identical configuration **four consecutive times, about every
10 s**. The control — the old single-key Idle — spans 0–329 px in the same window, an order of
magnitude smaller, with an unrelated ~5.3 s background periodicity. An independent lag scan puts the
candidate's repeat interval at **11.5 s**.

**What this is** (Codex review, point 2): evidence that the shipped clip produces repeated, cyclic,
visible motion on the real named-NPC path, with a stable wall-clock interval, where the clip it
replaced produced almost none. **What it is not**: a measurement of controller clip time. Image
periodicity cannot show that the mixer's action time advances at the authored rate, and no claim of
clip-time tracking is made here. The same missing DEV observability noted under the crossfades is
what such a claim would need.

**Wall time is not clip time here, and the unchanged clips prove it is the environment.** The
authored loop is 4.000 s but renders with a ~10–11.5 s wall period in this headless browser. The
same session measured the **untouched** Walk and Run through the same instrument: Walk's lag minimum
is 3.25 s against 1.42 s expected at its reported `playbackRate` 0.75 (2.3×), Run's is ~2.1 s
against 0.78 s at rate 0.85 (2.7×), and Idle's is 2.88×. All three clips are stretched by the same
order, so the stretch belongs to the headless render/simulation rate, not to the derived clip. No
claim is made here about the frame rate a player sees.

**Frames captured through each transition** — not the settled end states. Each frame is compared
against both settled endpoints; the count is of frames differing from **both** by more than 10 % of
the endpoint-to-endpoint distance:

| transition | candidate | control | endpoint distance |
| - | - | - | ---: |
| idle → walk | 51 of 51 | 31 of 52 | 8,955 px |
| walk → run | 51 of 51 | 52 of 52 | 7,867 px |
| run → idle | 53 of 53 | 36 of 52 | 10,026 px |

**What this does and does not establish** (Codex review, point 2). It establishes that the transition
is not a single-frame snap to the settled target pose: the renderer puts a run of distinct
configurations on screen in between, in the candidate and the control alike. It does **not** prove
interpolation. An instantaneous switch followed by the new clip advancing through its own phases
would satisfy the same predicate, and this measurement cannot tell the two apart. The earlier
wording ("the controller blends rather than snaps") overstated it and is withdrawn.

Proving a blend needs the mixer's own action weights and times during the transition. The shipped
DEV API exposes `animState`, `previousAnimState`, `playbackRate` and `speed` — no per-action weight
or time — so that evidence would require adding DEV-only observability to
`CharacterAnimationController` / `gameTestApi`, which is a source change outside this asset-promotion
scope. Recorded as an open item, not claimed.

`forceCharacterAnimation` is global and DEV-only: these transitions are the controller being driven,
not Ravi's own AI reaching those states.

## 5. Visual suite — exact overlap, and what is attributed

The full visual suite ran once on this branch for discovery: **357 passed, 10 failed (2.6 h)**. Every
Ravi-framing shot passed. Those three spec files were then re-run **at the merge base `d81d73d`** on
the same machine against the same baselines: **23 passed, 8 failed**.

Set membership, named rather than counted (Codex review, point 1):

| test | branch | base |
| - | :-: | :-: |
| asset-upgrade · player rendered as a Meshy humanoid | fail | fail |
| asset-upgrade · compact class GLB driven | fail | fail |
| asset-upgrade · sports class GLB driven | fail | fail |
| occlusion · driven car behind the gym | fail | fail |
| vehicle · driving an owned veh_scooter | fail | fail |
| vehicle · a custom-painted sports car parked | fail | fail |
| vehicle · a sports car with off-road wheels fitted | fail | fail |
| asset-upgrade · **scooter** class GLB driven | fail | pass |
| vehicle · driving an owned **veh_van** | fail | pass |
| vehicle · driving an owned **veh_sports** | fail | pass |
| asset-upgrade · **van** class GLB driven | pass | fail |

**7 overlap, 3 branch-only, 1 base-only.** The 7 overlapping failures reproduce at the merge base and
are pre-existing. The 4 unmatched cases were then probed directly instead of being assumed
(`out/flake-probe.md`): those exact four tests were run **twice on the identical branch commit**, no
code change, no baseline written —

- **repeat 1: 3 failed, 1 passed. repeat 2: all 4 passed.**
- One repeat-1 failure carried `readiness … "pending":1, glbPending:[{"id":"vehicle_utility_van_01"}]`
  — the screenshot was taken while a vehicle GLB was still loading.

So the outcome of these shots varies between runs of one unchanged commit, and at least one failure
is a load race at screenshot time. That is what attributes them: **nondeterminism in this
driving/vehicle shot family on this machine**, which also explains why branch (10) and base (8) drew
different members.

**What is not claimed:** that every one of the 10 branch failures was individually proved harmless.
Three were branch-only in the full run; they were reproduced as flaky rather than traced to a cause,
and one base-only case failed on the branch during the probe, so the family is unstable in both
directions. A per-shot root cause (the car-settling / readiness race of CONVENTIONS #40) is
**suspected, not established** here, and is out of this issue's scope. No failing shot frames Ravi.

### Baselines updated — three, deliberately

Authorized after review. Regenerated, each PNG **viewed**, then the three shots re-run **twice with
no updates** — 3 passed, 3 passed:

| baseline | what the new image shows |
| - | - |
| `wave0-candidate-ravi-close` | arms hanging at the sides, hands by the thighs, both feet planted and visible; blue shirt / dark jeans / white shoes and the neighbouring citizen unchanged |
| `wave0-candidate-ravi-wide` | same body at gameplay distance; Maya, the snack truck and the rest of the frame unchanged |
| `wave4-player-beside-ravi` | Ravi arms-down beside the **unchanged** `blocklife_person` player; quest marker still over the top of his face, as before |

`git status` shows exactly those three files modified. No other baseline was regenerated, no
tolerance was widened, and the full suite was not re-run.

## 6. Open items

1. **Direct blend evidence is not available without a source change.** Proving interpolation (rather
   than a switch followed by phase advance) needs per-action weights and times from the mixer during
   a transition; the DEV API exposes neither. Adding bounded DEV-only observability to
   `CharacterAnimationController` / `gameTestApi` would settle it and is outside this
   asset-promotion scope.
2. **The driving/vehicle visual family is unstable on this machine** — failures move between runs of
   one commit, with a GLB still pending at screenshot time in at least one. Out of scope here; worth
   its own issue.
3. Full E2E was not run on this branch. Nothing here changes runtime code — the only source-tree
   changes outside the asset are the intake recipe, its config entry, the contract test, three
   reviewed baselines and docs.

## 7. Limitations carried forward

Flat splayed hands at close range (the rig has no finger bones); Walk and Run keep their raised-arm
silhouette (unchanged bytes, separate scope); a slight deltoid crease at the new shoulder angle;
Ravi only — Maya, Bruno, Officer Kim and Nisha are untouched; the player, its wardrobe and all six
slots are untouched.
