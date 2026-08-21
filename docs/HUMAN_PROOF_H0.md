# Human Visual Gold Standard v1 — H0 Technical Proof (issue #27)

Zero-credit, Blender-free, deterministic proof of the animation architecture, run on the two
existing dormant 24-bone bodies (`blocklife_male_01`, `blocklife_female_01`) + three-in-node +
the real game runtime. **No Meshy credits were spent. No diagnostic model ships or enters the
production manifest** (proof GLBs are written to the gitignored
`public/assets/models/characters/_proof/`).

## Reproduce
```
node scripts/human-proof/inspectRig.mjs public/assets/models/characters/blocklife_{male,female}_01.glb
node scripts/human-proof/retargetBake.mjs      # → gitignored _proof/*.glb (proof + control)
npx vitest run src/game/characters/humanRigContract.test.ts
npx playwright test tests/human-proof --workers=1   # → asset-archive/human-proof/*.png (gitignored)
```

## Findings

### 1. Skeletons (inspectRig.mjs)
- **7-bone `blocklife_person`** — rigid weight-1.0, no knees/elbows/neck/hands/feet. Confirmed
  unfit as the near rig; **kept as fallback + far-LOD only**.
- **24-bone bodies** — proper Mixamo-style humanoid (Hips; Spine02/01/Spine; neck; Head; L/R
  Shoulder→Arm→ForeArm→Hand; L/R UpLeg→Leg→Foot→ToeBase), **smooth 4-influence skinning, 0 NaN,
  0 zero-weight**, grounded at y=0, ~1.8 m.
- **Validation rule (corrected):** hierarchy signature matches EXACTLY (`c432d433d51d` on both);
  body rest-pose translations differ (max delta ≈ 16) — **proportions are retarget input, never a
  rejection reason.** Locked by `humanRigContract.test.ts`.

### 2. Build-time retarget (retargetBake.mjs) — FAILS quality
`three` `SkeletonUtils.retargetClip` runs headless (loads, retargets, bakes a valid GLB with
embedded semantic clips), BUT it does **not reproduce the source motion faithfully**:
- **Identity retarget (male→male) drops ~80% of the shoulder swing** — sampled `LeftArm` rotation
  at walk t=0.3 goes from **1.09 rad (source) → 0.18 rad (retargeted)**. In-engine the retargeted
  walk shows near-**T-pose arms**.
- **Cross-body retarget (male→female) visibly distorts** — the female walk renders scrunched/
  collapsed.
Both are listed NO-GO conditions ("retargeting technically exports but visibly deforms";
"different proportions break the clips").

### 3. Per-body embedded clips (control, NO retarget) — CLEAN
Each body's OWN embedded meshy walk, played with NO retarget, walks **naturally on both bodies**
(upright stride, arms at the sides, no distortion) — the direct A/B against the mangled retargeted
walk. Authored per-body diagnostic clips (`ElbowKnee`, `Seated`) **articulate the joints correctly**
(knees bend into a clear crouch), proving deterministic per-body authoring works.

### 4. Runtime + safety
Proof bodies load through the real `AnimatedCharacter`/`CharacterAnimationController` path (the DEV
`setPlayerProofDef` hook — not the manifest); semantic idle/walk/run roles resolve; a missing proof
GLB falls back to the primitive with no crash/pageerror; the 7-bone fallback remains; no second
movement authority is introduced.

## Verdict: NO-GO on build-time `retargetClip` — corrected architecture

Do **not** retarget one canonical clip onto all bodies via `three.retargetClip` (it visibly
deforms). Instead, **each body embeds its OWN meshy_rig walk+run (free, per-body, proven clean) —
no cross-body retarget** — plus a small set of **per-body deterministic authored short clips**
(idle / turn / seated) or per-body `meshy_animate` clips for motions rigging doesn't provide. The
runtime stays as-is (embedded clips through the existing path). The 24-bone canonical hierarchy,
skinning, grounding, joint articulation, load/bake/validate, fallback, and determinism are all
proven; only the retarget step is rejected. **We do NOT fall back to the 7-bone rig.**

Validating the recommended path (per-body meshy walk+run quality) needs `meshy_rig` (0 credits) on
a real body → that belongs to a revised **H0 Calibration** authorization, not this zero-credit proof.
