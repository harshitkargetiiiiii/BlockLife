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

---

## H0 Calibration — the one gold-standard calibration human (DONE)

Executed under the separate **H0 Calibration** authorization (max 123 expiring credits). ONE
calibration human — `human_gold_calibration_01` — built end-to-end on the per-body-embedded
architecture above, reviewed in-engine, and integrated behind a DEV-only path. **Not merged.**

### Pipeline (deterministic, Blender-free)
1. **Reference** — `text_to_image` (nano-banana-pro): neutral T-pose, stylized low-poly adult, warm
   BlockLife palette, mustard tee + olive trousers, no accessories. Accepted on first result.
2. **Image → 3D** — `meshy_image_to_3d` (meshy-6, `pose_mode:t-pose`, `origin_at:bottom`). Raw =
   1.8 M tris / 68.9 MB. Face + anatomy reviewed at zero credits via a local decimated preview
   through the DEV static viewer → gold-standard-able, selected (no 2nd/3rd candidate needed).
3. **Remesh** — `meshy_remesh` (`target_polycount:8000`, `resize_height:1.75`) → **7 605 tris**,
   clean retopology + normal map, 1.75 m, feet at y=0. The 8 k Hero budget did **not** destroy the
   face (the normal map even sharpened it) — no tier escalation.
4. **Smart Rig** — `meshy_rig` (`height_meters:1.75`) → **24-bone** canonical skeleton (hierarchy
   signature **`c432d433d51d`**, identical to the dormant bodies), smooth 4-influence skinning
   (0 NaN / 0 zero-weight). Ships **free Walking + Running** clips as separate `_withSkin.glb`
   (the plain rig GLB export carries no skin — the clips live in `basic_animations.*`).
5. **Assemble** (`scripts/human-proof/assembleCalibration.mjs`, gltf-transform so textures survive):
   merge the free Walk + Run onto ONE textured skinned mesh (root drift pinned → in-place), author
   **Idle / Turn / Seated** on the same skeleton (arms brought down from the T-pose bind via the
   mean of the walk cycle's arm rotation), zero the Meshy base-colour→emissive bind so the body
   obeys day/night lighting.
6. **Optimize** — textures → 1024 webp; final **705 KB**, single material, 1 skinned mesh.
7. **Integrate** — `CHARACTER_ASSETS['human_gold_calibration_01']` (`rotationOffset:0`, `scale:1`),
   DEV-only via `setPlayerCharacterAsset` — **not** the default, **not** assigned to any NPC.

### Versioned animation spec (v1)
| clip | source | in-place | duration |
|------|--------|----------|----------|
| Walk | Meshy Smart-Rig `walking_man` (free) | yes | 1.07 s |
| Run  | Meshy Smart-Rig `running` (free)     | yes | 0.67 s |
| Idle | authored (spine/neck sway, arms down) | n/a | 2.40 s |
| Turn | authored (hips yaw + spine lean)      | n/a | 1.20 s |
| Seated | authored (hip/knee flex, hold)      | n/a | 1.00 s |

### Credits (provenance)
ref `01a0220a` = 9 · image_to_3d `01a0220b` = 30 · remesh `01a02226` = 5 · rig `01a0222a` = 5 ·
walk/run = **free** · idle/turn/seated = **authored, 0**. **Total 49 / 123.** Balance 2 705 (floor
2 631 untouched). NOTE: `meshy_rig` billed **5**, not the 0 the ledger assumed — still the authorized
Smart Rig (walk/run came from it, no purchased replacement), and well under the ceiling.

### Hero-tier budgets (all met)
7 605 tris (≤8 000) · 705 KB (≤1.0 MB) · 1× 1024 webp (≤1024) · 24 bones · 1 skinned mesh · 1
material · 1.75 m, feet y=0.

### In-engine review (all pass — `tests/human-proof/{calibrationReview,facingReview}.spec.ts`)
Face readable/symmetric/adult at close zoom; Walk natural, Run distinctly athletic (gate: distinct +
usable **from the free rig** ✔); Idle/Seated/Turn natural; walks **forward** (no moonwalk →
`rotationOffset:0`); renders through the real `AnimatedCharacter` path among the live population; day
/ night (dark silhouette, no glow) / rain OK; 0 pageerrors; missing-GLB → primitive fallback intact.

### Reproduce
`node scripts/human-proof/assembleCalibration.mjs` (needs the gitignored `_proof/` Meshy inputs) →
`gltf-transform resize … 1024 && gltf-transform webp` → `cp … human_gold_calibration_01.glb`.
Review: `npx playwright test tests/human-proof/calibrationReview.spec.ts tests/human-proof/facingReview.spec.ts --workers=1`.
