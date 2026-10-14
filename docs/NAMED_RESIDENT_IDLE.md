# Named resident Idle (issue #27, named slice): Maya and Bruno

Maya (`npc_maya_01`) and Bruno (`npc_bruno_01`) ship a derived **Idle**. Their imported Idle was a single static raised-arm key; it is now an arms-down 4 s breathing loop.
- **Affected:** Idle only, and only these two bodies.
- **Unchanged:** Walk, Run, geometry, skin, rest pose, materials, textures, identity mapping, player, wardrobe and every other resident.

## How it is built

- **Build:** `scripts/asset-intake/buildWave4.mjs` assembles each named body from its three approved sprint sources, exactly as before. For a body with `idleDerivation` in `wave4.config.mjs`, it then:
  1. asserts the assembled file equals the pinned **base** sha256 (the pre-change shipped bytes);
  2. applies `deriveNamedIdle` from `scripts/asset-intake/namedIdle.mjs`;
  3. asserts the result equals the pinned **reviewed output** sha256.
- **Verification:** `--check` rebuilds outside the repository and compares the committed bytes.
- **Provenance:** the `derived` block in `docs/asset-provenance/wave4-provenance.json` records the recipe, both hashes, the calibration and the measured report.

| body | base (pre-change) sha256 | derived sha256 | upper-arm abduction |
|---|---|---|---:|
| Maya | `2b2de77624956433a3f7c65782bf3a315bf5f1ef8169a2b202017c415f8cdd73` | `e8e2ef708005226c3b6c077b28e0b929a30fbf00aeb083306261472e44bd189b` | 23° |
| Bruno | `7abc583cf88e3def698b378477aba5dbd89603533756af694e10929b38adcdad` | `5b5bc61d27833196d6a33dc05b3ce4b9a2832949be152639845eac02e0c00d4c` | 17° |

## The recipe (`namedIdle.mjs`)

It is the reviewed external core (`BlockLife-intake/named-idle-2026-09-15/scripts/idle-core.mjs`, `95e64d3a…`), with repository imports in place of absolute paths. The evidence-only clearance tooling and CLI are not included.

- **Preconditions, fail-fast:**
  - pinned base sha256 and bytes;
  - one skin with the canonical 24 joints, one mesh/primitive;
  - clips exactly Idle/Walk/Run;
  - Idle is 72 channels on the skin joints, each one LINEAR key at Float32 0.3, with no accessor shared with Walk/Run;
  - `KHR_materials_ior` declared.
- **Addressing:** joints are addressed by live skin index and animation target identity, never by a document-wide name map (these files carry three JSON nodes per joint name).
- **Pose:**
  - apply each original Idle T/R/S key;
  - re-aim both arms in world space (upper arm, then forearm, with matrix updates between; segments are never stretched) to the calibrated abduction, using PR #52's forward angles;
  - solve wrist roll against a PCA hand plane from the hand's own skinned vertices;
  - author PR #52's 4 s breathing loop, 33 keys, on the 11 breathing joints.
- **Bake:** only Idle sampler accessor references change.
  - T/S hold the original key bit-exact.
  - The 11 joints the recipe does not author (the lower body, `head_end`, `headfront`) keep their original rotation key bit-exact.
  - Authored rotations are normalized.
- **Why the abduction differs per body:** it is the smallest 1° grid value (6–30°) whose forearm/hand-to-torso/leg nearest-vertex proxy stayed at least 2 cm, with no vertex within 1 cm, over the static pose and breathing at t = 0–3 s.

PR #52's Ravi module is not changed. Once both are adjacent it can delegate to this helper instead of keeping a second solver.

## Gates

`src/game/assets/namedIdleContract.test.ts`:
- **Pins:** only Maya and Bruno are derived. The config, `RIG_FIT`, provenance and committed bytes all name the reviewed hashes; bases and abductions are pinned.
- **Invariance:** geometry, rest nodes, skin (joint indices and inverse binds), materials, images, Walk, Run and every held Idle channel equal digests taken from the **pre-change** bytes. The Idle digest equals the reviewed derivation.
- **Decoded material state:** a separate `materialSampling` digest covers decoded `KHR_materials_ior` values and every texture slot's TextureInfo/sampler state (texCoord, wrap S/T, min/mag filter), plus normal scale and occlusion strength. An undecoded material or TextureInfo extension fails loudly.
  - **Why it exists:** a reviewer showed the plain `materials` digest missed IOR (it serialised the extension object) and never saw sampling. That gap was proven failure-first: all six in-memory edits went undetected before the fix.
  - **Mutation test:** it now edits IOR, wrap S/T, min/mag filter and texCoord in memory on Maya. Each edit must change the digests, and each restore must match.
- **Idle structure:**
  - 72 unique targets; rotations have 33 keys over 4 s, unit length;
  - T/S hold one value; untouched rotations are constant;
  - exactly the 11 breathing joints move, and the loop closes.
- **Determinism:** re-authoring the keys twice, from the committed rig and the pinned original authored keys, equals every committed Idle rotation bit for bit.
- **Pose:**
  - at t = 0 the elbows are soft (< 30°, from > 70°), the wrists are below the elbows and the elbows below the shoulders;
  - the lower body is unmoved.

`wave4Contract.test.ts` continues to check the committed sha256, bytes, height and fit for every named body against `RIG_FIT` and provenance.

## Evidence and limits

Externally: `BlockLife-intake/named-idle-2026-09-15/`.
- **Calibration:** `calibration/calibration.v1.json` `4cd04935…`.
- **Two identical independent builds:** `candidates/build-a`, `candidates/build-b`.
- **Verification:** `verify/verify.v1.json` `98535a9d…` (invariance ok).
- **Native paired original/candidate review:** `native-v1/`, evidence `387ed095…`, 34 PNGs, reviewed in `CODEX-NATIVE-REVIEW.md` `4f12e972…`. Its recorded result is **29 checks, 25 true, 4 false**.
  - All four false checks are Bruno's left view in both contexts: the player spot fell inside `building_gym_01`, and Bruno paused 0.199 m from his anchor.
  - They are retained, not re-run.

**What the images support:** lowered arms, same identities, no obvious gross deformation in the sampled frames, feet visually planted.

**What they do not establish:**
- **Hands:** the hand plane is **unsigned**, so palm-versus-back facing the thigh is not decided. Maya's hand-plane residual is 22–32°, and fingers stay splayed (the rig has no finger joints).
- **Clearance:** measured by a nearest-vertex **proxy**, not surface or penetration proof.
- **Framing:** views used a DEV close-up zoom. This is not ordinary-camera, continuous-motion or performance acceptance.
- **Walk:** it still raises and gestures the arms in both the original and the derived bodies. It is recorded as a separate follow-up on issue #27, not addressed here.

**Kim and Nisha are held**, with no output. Their calibration failed on connected mixed-weight forearm/hip edges. The v1 failure record is preserved, and any further step is a separate topology diagnostic.
