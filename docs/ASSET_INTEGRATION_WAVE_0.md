# Integration Wave 0 — approved asset pack (issue #38)

Integrates a bounded, owner-approved slice of the 2026-08-31 Meshy asset sprint through the
**existing** production asset and character pipelines. No paid generation, no new Meshy calls, and
no second character or animation system. Builds on [#21](../docs/3D_ASSET_PIPELINE.md),
[#23](CHARACTER_IDENTITY_AND_POPULATION.md), [#25](asset-harvest-log.md) and
[#27](HUMAN_PROOF_H0.md).

## What ships

| Wave 0 asset | Projected onto | Gameplay authority stays with |
|---|---|---|
| `compact_sedan_01` | `vehicle_compact_car_01` | `getActiveVehicleProjection()` — ONE physical shell |
| `arch_office_01` | `building_office_01` | `cityLayout` colliders, anchors, overlays, labels, occlusion |
| `prop_park_bench_01` | the existing **`bench` prop type** | `cityLayout` placements + type-based `PROP_SOLIDITY` |
| `blocklife_kabir_01` | **no runtime slot** — DEV review only | — see the owner decision below |
| `blocklife_ravi_01` | **no runtime slot** — DEV review only | — see the owner decision below |

## Owner decision (2026-08-31) — the characters stay candidates

Wave 0 originally seated Kabir in the player slot and Ravi on `npc_ravi_01`. That **silently
retired shipped behaviour**, and the owner ruled against it.

BlockLife's save-backed **player wardrobe** and the issue #23 **identity axes**
(`skin`/`hair`/`shirt`/`pants`/`shoes`/`accessory`) are driven by *recolorable material slots*. The
sprint characters are single-baked-material models — their appearance is painted into one texture —
so they declare `materialSlots: {}` and can expose none of those axes. Seating one in a runtime
slot therefore turns the wardrobe into a no-op while the save format still stores selections.

So they ship as **candidates**: present, provenance-tracked, byte-pinned, and loadable through the
ONE existing `AnimatedCharacter` path — but not the player and not named by any NPC def.

- The player and `npc_ravi_01` both stay on `blocklife_person` (the wardrobe-capable rig).
- `PLAYER_CHARACTER_ASSET_ID` is now the **single source of truth** for the player's asset, read by
  the renderer, the occlusion radius (`visibilityRuntime`) and the evidence API
  (`getCharacterAssetInfo`) alike — they can no longer describe different characters.
- `CANDIDATE_CHARACTER_ASSET_IDS` names them, and `wave0Contract.test.ts` gates that they stay out
  of the player slot and every NPC def, that the player keeps `shirt`/`pants`/`hair`, and that every
  NPC resolves an asset with recolorable axes.
- They stay reviewable through the existing DEV override —
  `GAME_TEST_API.setPlayerCharacterAsset('blocklife_kabir_01')` renders one down the production
  path. `tests/visual/wave0-asset-visuals.spec.ts` captures that as the candidate evidence.

They become eligible for a runtime slot only if they are re-authored with real material
segmentation. The ambient crowd was never migrated: `DEFAULT_CHARACTER_ASSET_ID` is unchanged.

## Deterministic intake pipeline

```
node scripts/asset-intake/buildWave0.mjs            # rebuild every production GLB from pristine source
node scripts/asset-intake/buildWave0.mjs --check    # prove the committed bytes reproduce byte-identically
```

`scripts/asset-intake/wave0.config.mjs` declares the exact sources and outputs. Sources live
**outside** the repository (`BLOCKLIFE_INTAKE_ROOT`, default the 2026-08-31 sprint root) and are
opened read-only — the pipeline never writes to them.

### Characters — one GLB, three clips

The sprint ships three GLBs per character (rig / walking / running) that each duplicate the whole
mesh **and** a 2048² texture. Shipping that as-is would triple the payload. The pipeline first
**proves** the three share a byte-identical mesh, texture and 24-bone skeleton, then grafts the
Walk and Run clips onto the base document's own joints **by bone name** and prunes the duplicates.

Because the merge is name-targeted onto the *same* skeleton, geometry, skin weights, bind matrices
and the canonical `c432d433d51d` hierarchy are unchanged — this is the H0 "one GLB with embedded
semantic clips, no retarget" approach, generalized. Clips are named `Idle` / `Walk` / `Run`, which
are already the literal aliases in `CHARACTER_ASSETS`, so the roles resolve through the **existing**
`resolveClips` path with no controller change.

### All assets

- Textures reduced **2048² → 1024²**, re-encoded as **JPEG**. JPEG is deliberate: `assetReport.mjs`
  measures embedded texture dimensions from PNG (IHDR) and JPEG (SOF) headers only, so a WebP
  texture would make that budget check pass **vacuously**. JPEG keeps the gate genuinely enforcing.
- No DRACO, Meshopt or KTX2 — the current loader needs no new dependency.
- Single material per asset, renamed only where the existing variant-slot pipeline binds it
  (`paint` / `wall` / `bench`).
- `dedup` + `prune` strip unused payload.

## Provenance

`docs/asset-provenance/wave0-provenance.json` records, per asset: every source path and source
SHA-256, the output SHA-256, the exact operations, measured byte sizes, and the full structural
report (triangles, materials, textures, clips, skeleton, cameras, scenes, extensions) read back
from the produced bytes. `public/assets/ASSET_CREDITS.md` carries the human registry, and each
manifest entry carries its own `attribution` / `license`.

`src/game/assets/wave0Contract.test.ts` re-derives every structural claim from the **committed
bytes** — it never trusts the sprint report or the provenance file's own numbers.

## Limitations

- **Payload.** Wave 0 adds ~5.0 MB across five GLBs. The model payload was already 13.80 MB on
  master, over the 12 MB target in `ASSET_STYLE_BIBLE.md`; Wave 0 takes it to ~18.7 MB. Triangles
  and textures are inside the **enforced** `assetReport.mjs` budgets; bytes are not gated. The
  payload is geometry-dominated (Kabir: ~188 KB texture vs ~1 MB mesh), so texture quality is not
  the lever — reducing it needs a remesh pass, which is out of Wave 0 scope.
- `public/assets/models/vehicles/compact_car_01.glb` (166 KB) is now unreferenced by the manifest.
  It is retained because `VehicleAsset.test.tsx` uses its path as a fixture string; removing it is
  a safe follow-up.
- Idle is the rig's own base clip (0.30 s). It is a real distinct clip, so `staticIdle` is not set.

## Visual acceptance evidence

`tests/visual/wave0-asset-visuals.spec.ts` — 23 baselines, captured on this host, each inspected
by eye before being committed, then re-run twice with **no** snapshot updates: **23/23 and 23/23**.

> **Correction.** An earlier revision of this document claimed the whole visual suite passed
> "151/151, zero pre-existing baselines modified". That was false. The diagnostic run behind it was
> piped through `tail -8`, which discarded the `28 failed` line and kept only the last few failing
> test names plus `151 passed`; because the pipeline was not run under `pipefail`, the exit status
> reported was `tail`'s, not Playwright's. The real result of that run was **151 passed / 28
> failed** — 27 legacy screenshot mismatches plus one `career-visuals` readiness timeout. The
> whole-suite totals after the reviewed baseline migration are recorded below.

### Reviewed legacy baseline migration (27 snapshots)

The office, sedan and bench are visible in scenes owned by other suites, so replacing them
necessarily moves those baselines. The migration was **bounded and reviewed**, not a bulk accept:

1. The 28 affected cases were selected by an explicit `-g` pattern and the selection count was
   **verified as 28 before anything ran**.
2. Running them with **no updates** produced **27 failed / 1 passed**. The one that passed was
   `career visuals › scheduled shift with a startable window` — so that failure was a transient
   `GAME_TEST_API.ready()` readiness timeout, **not** a screenshot mismatch. Its timeout was left
   at the original 45 s and it was **excluded** from the update.
3. Each `-actual` / `-expected` / `-diff` triple was inspected. Every delta is confined to the
   replaced **office** massing and the replaced **sedan** shell (including small parked-sedan
   silhouettes in wide shots). Specifically confirmed **unchanged**: the canonical player and the
   red/yellow **wardrobe recolor**, **Maya/Ravi identity**, the courier **HUD tracker + marker**,
   the occlusion **ghosted/solid pair** (still opposite states), and **vehicle/dealership** state.
   The **foggy-morning** delta was inspected explicitly and is the office alone.
4. Only those **27** snapshots were updated — `git status` showed exactly 27 modified PNGs, no
   additions, no deletions, and no `career` file.

### Whole-suite totals after the migration (untruncated, exit status captured)

Run as `npx playwright test tests/visual --reporter=line > log 2>&1` with the exit status recorded
on the next line — **never** piped through `tail` again.

| Run | Result |
|---|---|
| Dedicated `wave0-asset-visuals.spec.ts`, no updates, ×2 | **23/23** and **23/23** |
| Whole suite, no updates (final proof, 1.8 h) | **168 passed / 11 failed**, exit **1** |
| Those 11 re-run in isolation | **10 passed / 1 failed** |
| The remaining 1 re-run again on its own | **passed** (30.3 s) |

So 10 of the 11 were **load-induced flakes** in a 1.8-hour run on a machine under heavy load — they
pass when not competing for the GPU/CPU. They are readiness/timing failures, not pixel mismatches.

The eleventh, `vehicle visuals › driving with an NPC passenger along for the ride`, is a
**pre-existing flaky visual and NOT an asset or wardrobe regression**. Its diff shows the *entire
frame translated* — every world label is doubled — which is a camera/car pose shift, not a content
change; no asset in the scene renders differently. The spec itself already documents the cause:
the social drive "ends the van at a physics-dependent pose that varies just enough to exceed the
ratio", which is why that test pins the pose with `setDrivenCarPosition`. The pin evidently does not
fully determinise it. It passed on a subsequent isolated run. Nothing here was retimed or weakened
to make it pass, and its baseline is the reviewed one from the migration above.

**Honest status:** the whole visual suite is **not green in a single cold run on this host**; it is
green per-test on re-run. That is recorded as a limitation rather than papered over.

| Shot | Proves |
|---|---|
| `wave0-sedan-cardinal-{front,rear,side-left,side-right}` | forward axis + shell fit: head-on reads the 2.00 m width, broadside the 3.81 m length — a swapped scale axis shows here first |
| `wave0-sedan-night` | paint + emissive under the night rig |
| `wave0-sedan-driving-seat` | player seated via the SHIPPED path (walk to `CAR_SPAWN`, press E), body/seat/camera alignment |
| `wave0-office-cardinal-{north,east,south,west}` | replacement massing from all four sides, opaque (occlusion temporarily off), inside the authored 7×7 footprint |
| `wave0-office-entrance-west` | the entrance reads on the authored `door: 'west'` side — **opaque control** |
| `wave0-office-occlusion` | the **opposite** state: player behind the massing, `building_office_01` faded below 0.5 opacity through the existing `<Occludable>` path |
| `wave0-office-night-windows` | the re-authored emissive planes sit ON the replacement facades (the old distances floated them ~0.40 m / ~1.03 m off) |
| `wave0-bench-empty` | bench GLB alone: ground contact, seat height, slat texture, proportions |
| `wave0-bench-occupied` | `cit_c_bench_napper`'s sit pose lands on the GLB's seat |
| `wave0-bench-district-context` | scale + palette among the other central-district props |
| `wave0-candidate-kabir-{idle,walk,run}` | the three EMBEDDED clips, visibly distinct |
| `wave0-candidate-kabir-night` | candidate under night lighting |
| `wave0-candidate-kabir-driving-transition` | the override does not leak a second body while driving |
| `wave0-candidate-ravi-{close,wide}` | candidate GLB read close and in-world — a **visual proxy only** |

Two staging notes worth keeping:

- **The bench shots orbit the DEV camera 180°.** `prop_park_tree_01 [-9.0, 8.0]` sits between the
  default camera and `prop_bench_02`, covering the seat and the sitter's legs — exactly what the
  shots exist to prove. The orbit puts it behind.
- **Gait shots use `setPlayerProofDef`, not `forceCharacterAnimation`.**
  `CharacterAnimationController.freezeAt(t)` calls `resetToIdle()` and then pins only the `idle`
  action, so a forced walk/run collapses back to Idle before capture — all three frames come out
  identical. The proof def aliases every semantic role to ONE embedded clip, so the action
  `freezeAt` pins really is `Walk` or `Run`. This is a visual-only review path; it renders through
  the real controller and changes no runtime slot.
