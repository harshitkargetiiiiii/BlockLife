# Ravi's natural Idle — promotion through the intake pipeline (issue #27)

Ravi's shipped Idle was **a single static key with the elbows bent 114.3° / 114.8°**, which is what
held his arms out in front of him: the wrist ended up *above* the elbow and 0.33 m out from centre,
and nothing moved for the whole 0.300 s clip. This change replaces **only that clip** with a 4 s
breathing loop — arms down, soft elbows (11.5°), palms turned to the thighs, head level, feet
planted.

Nothing else about Ravi changes. Not his geometry, not his skin weights, not his rest pose, not his
materials or textures, not Walk or Run, not his height, scale, bounds, anchors, identity colours,
placement or behaviour. Nobody else changes at all: the player keeps `blocklife_person` and all six
wardrobe slots, and the other four named residents keep the bodies Wave 4 gave them.

| | |
| - | - |
| Derived from | `f9ac3d5b8606c34007de89bfed05a764cfd2a4b843bb000e44fd0713488d6fe4` (the unmodified Wave-0 merge output) |
| Ships as | `7deab5d70a127e42a2433648906e9cdd6cfdf7415723e5f6d1e13a87e06c56a7`, 1,054,852 B (+22,452) |
| Recipe | [`scripts/asset-intake/raviIdle.mjs`](../scripts/asset-intake/raviIdle.mjs) |
| Contract | [`src/game/assets/raviIdleContract.test.ts`](../src/game/assets/raviIdleContract.test.ts) |
| Clip | Idle 0.300 s / 0 moving samplers → **4.000 s / 33 keys / 11 moving channels** |

## 1. Why it is a derivation, not a new file

The obvious way to ship a reviewed GLB is to copy it into `public/`. That would have broken the one
thing Wave 0 exists to guarantee: `buildWave0.mjs --check` rebuilds every committed output from the
pristine sprint sources and fails if a single byte differs. A hand-carried file makes that check
fail, and re-recording its hash as if the sources had produced it would make the provenance claim a
lineage that never ran (CONVENTIONS #43).

So the recipe runs **inside** the pipeline, on the merge's own bytes:

```
3 pristine sprint clips ──merge/prune/dedup/texture-compress──▶ f9ac3d5b…  (asserted)
                                                                    │
                                                      raviIdle.mjs  ▼
                                                                7deab5d7…  (asserted)
```

Both hashes are pinned in [`wave0.config.mjs`](../scripts/asset-intake/wave0.config.mjs), so the
recipe can never be applied to bytes it was not reviewed against and its result can never drift.
`--check` re-proves the whole chain, and the other four Wave-0 outputs stay byte-identical.

## 2. What the recipe does

`bakeRaviIdle` loads the body, poses the arms, samples a breathing cycle and rewrites the samplers
behind the existing Idle animation's 72 channels. It is deterministic — no randomness, no clock,
fixed key count, fixed trig — and three independent builds produce the same sha256.

- **The arms are re-aimed in WORLD space, never by Euler axis.** These joints have arbitrary rest
  orientations (`LeftArm` rest q = `[0.464, 0.440, 0.288, 0.713]`), so intent is expressed as a
  world rotation and converted per bone:
  `q_local_new = (Q_parentWorld⁻¹ · R_world · Q_parentWorld) · q_local_old`. Segment directions come
  from `setFromUnitVectors`; the wrist roll that turns the palm to the thigh is **swept numerically**
  in 1° steps rather than assumed. Measured length drift: **0.000000 m** on both segments.
- **Only rotation is authored.** Every translation and scale track holds its original Idle key
  exactly. That is also the mechanism behind the planted feet: no lower-body joint rotates or
  translates at all, so nothing below the hips can move.
- **11 channels move**: `Spine02`, `Spine01`, `Spine`, `neck`, `Head`, both `Shoulder`s, both `Arm`s
  and both `ForeArm`s. The chest opens on the inhale and the neck and head counter-rotate so the
  head stays level. A second harmonic at half the period keeps the cycle from feeling mechanical and
  still closes the loop exactly (max |q(0) − q(4 s)| ≈ 1.4e−17).
- **Breathing is deliberately small** — 4.6 mm of hand travel. Larger reads as a sway.

## 3. What is proven, and where

`src/game/assets/raviIdleContract.test.ts` pins its preservation digests from the bytes that shipped
**before** this change (`d81d73d`), so "only Idle changed" is asserted rather than asserted-about:

| asserted | how |
| - | - |
| POSITION / NORMAL / TEXCOORD_0 / JOINTS_0 / WEIGHTS_0 + indices | decoded-data digest == pre-change |
| all 74 node rest transforms | digest == pre-change |
| skin joint order + inverse bind matrices | digest == pre-change |
| materials, incl. `KHR_materials_ior` | digest == pre-change; extension list gated explicitly |
| embedded texture bytes | digest == pre-change |
| Walk and Run | full sampler digests == pre-change, durations 1.066667 s / 0.666667 s |
| Idle | 72 channels, 4.000 s, 33 keys, LINEAR, and **not** the old digest |
| only breathing bones move | moving-channel set == the 11 above; every lower-body track constant |
| the loop closes | max \|q(0) − q(4 s)\| < 1e−6 over every rotation channel |
| the pose is arms-down | forward kinematics at Idle t=0: elbow bend < 30°, wrist below the elbow |
| the file IS the reviewed candidate | sha256 == the pin in provenance **and** in `RIG_FIT` |

The extension check is not ceremony: the first candidate of this recipe used a bare `new NodeIO()`
and silently dropped the source's `KHR_materials_ior` while every core material factor still
matched. The recipe now uses the intake's own registered `io`, and the contract gates the
extension list.

## 4. The second pin

`wave4.config.mjs` `RIG_FIT` ties each named body's measured height to the sha256 of the file it was
measured from (CONVENTIONS #42), so a re-authored body fails the gate instead of keeping a stale
scale. The derived Ravi was re-measured with `scripts/human-proof/inspectRig.mjs`: **1.76 m,
base at ground, 24 bones, hierarchy `c432d433d51d`, 0 zero-weight vertices** — unchanged. Only the
hash moves; `scale` stays 1.6648 and every bound and anchor stays exactly where it was.

## 5. Known limitations, carried forward

These are disclosed, not fixed here:

1. **The hands are flat and splayed at close range.** The rig has **no finger bones** — the 24 bones
   stop at `LeftHand` / `RightHand` — so the splay is authored into the mesh and cannot be animated
   away. Turning the palm to the thigh puts it edge-on, which is why it reads far better, but a
   close-up still shows a flat spread hand. Fixing it needs a re-author or finger joints.
2. **Walk and Run keep their raised-arm silhouette.** They are unchanged bytes. Locomotion is a
   separate scope.
3. A slight crease appears at the deltoid where the sleeve meets the arm at the new shoulder angle.
   That is skinning on the authored mesh, not an animation error.
4. Two pose iterations were used and the second is what ships; there is no third.
5. This is Ravi only. Nothing here is applied to Maya, Bruno, Officer Kim or Nisha.

## 6. Reproducing it

```sh
export PATH=$HOME/.nvm/versions/node/v23.3.0/bin:$PATH
node scripts/asset-intake/buildWave0.mjs           # rebuild (rewrites the 5 Wave-0 outputs)
node scripts/asset-intake/buildWave0.mjs --check    # verify committed bytes == rebuilt bytes
git status --porcelain                              # only Ravi + provenance may differ after a rebuild
npx vitest run src/game/assets/raviIdleContract.test.ts
```

Prior external evidence, kept outside the repository:
`BlockLife-intake/ravi-idle-pilot-2026-09-09.wpiibR` (authoring + structural review),
`BlockLife-intake/ravi-ingame-validation-2026-09-09.o371fa` (in-game / controller validation),
`BlockLife-intake/ravi-promotion-2026-09-10` (this delivery's continuous-timing and crossfade
capture). The delivery record, with every hash and test result, is
[`docs/review/issue-27-ravi-idle/DELIVERY.md`](review/issue-27-ravi-idle/DELIVERY.md).
