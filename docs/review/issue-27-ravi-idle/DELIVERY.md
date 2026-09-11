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

**Two uninterrupted cycles, measured (not frozen, not modulo).** A 150 s screencast capture, world
running, `timeScale 0` only to stop the sun drifting. In a late 40 s window the candidate's rendered
pose oscillates between 0 and 3,829 changed pixels (of 13,680 in Ravi's torso/arm region) and
returns to its starting configuration **four consecutive times, about every 10 s**. The control —
the old single-key Idle — spans 0–329 px in the same window, an order of magnitude smaller, with an
unrelated ~5.3 s background periodicity. An independent lag scan puts the candidate's period at
**11.5 s**.

**Wall time is not clip time here, and the unchanged clips prove it is the environment.** The
authored loop is 4.000 s but renders with a ~10–11.5 s wall period in this headless browser. The
same session measured the **untouched** Walk and Run through the same instrument: Walk's lag minimum
is 3.25 s against 1.42 s expected at its reported `playbackRate` 0.75 (2.3×), Run's is ~2.1 s
against 0.78 s at rate 0.85 (2.7×), and Idle's is 2.88×. All three clips are stretched by the same
order, so the stretch belongs to the headless render/simulation rate, not to the derived clip. No
claim is made here about the frame rate a player sees.

**Mid-crossfade, not end states.** Frames captured *through* each transition, compared against both
settled endpoints, counting frames that differ from **both** by more than 10 % of the
endpoint-to-endpoint distance:

| transition | candidate | control | endpoint distance |
| - | - | - | ---: |
| idle → walk | **51 of 51** intermediate | 31 of 52 | 8,955 px |
| walk → run | **51 of 51** | 52 of 52 | 7,867 px |
| run → idle | **53 of 53** | 36 of 52 | 10,026 px |

The blend is real in both — the controller interpolates, it does not snap. `forceCharacterAnimation`
is global and DEV-only: this shows the controller *blending between gaits*, not Ravi's own AI
reaching them.

## 5. Visual suite — what ran, what failed, and to whom it belongs

The full visual suite ran once on this branch for discovery: **357 passed, 10 failed (2.6 h)**. Every
Ravi-framing shot passed (`wave0-candidate-ravi-close`, `wave0-candidate-ravi-wide`,
`wave4-player-beside-ravi`, `asset-humanoids-both`, `asset-character-lineup`, `dialogue-ravi`).

The 10 failures are all driving / vehicle / player-avatar shots. They were then re-run **at the
merge base `d81d73d`**, same baselines, same machine: those three spec files fail **8 of 31** there
too, in the same families, with the membership shuffling between runs (`scooter` on the branch,
`van` at base). Diff images show whole-frame offsets and a different game clock, i.e. the documented
car-settling / timing family, not a pose change. **Attribution: pre-existing and flaky on this
machine, not caused by this branch.** Logs: `out/visual-discovery.log`, `out/visual-base-ab.log` in
the intake folder.

**No baseline was updated or regenerated in this branch.**

## 6. Pending — needs a decision, not code

1. **Three Ravi baselines are now stale but still passing.** `wave0-candidate-ravi-close/-wide` and
   `wave4-player-beside-ravi` record the pre-change arms-out pose; the game now renders arms-down,
   and the shots pass only because the per-shot tolerance (2–3 % of the frame) absorbs a pose change
   at that scale. Regenerating exactly those three, viewing each PNG and re-running twice with
   `--no-update` is the right follow-up; it was not done here because a baseline write needs explicit
   approval. Nothing else should be touched.
2. **The driving/vehicle visual family is unstable on this machine** (8–10 failures at base and on
   the branch). Out of scope for this issue; worth its own look.
3. Full E2E was not run on this branch. Nothing here changes runtime code — the only source-tree
   changes outside the asset are the intake recipe, its config entry, the contract test and docs.

## 7. Limitations carried forward

Flat splayed hands at close range (the rig has no finger bones); Walk and Run keep their raised-arm
silhouette (unchanged bytes, separate scope); a slight deltoid crease at the new shoulder angle;
Ravi only — Maya, Bruno, Officer Kim and Nisha are untouched; the player, its wardrobe and all six
slots are untouched.
