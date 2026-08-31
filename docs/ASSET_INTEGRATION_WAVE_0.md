# Integration Wave 0 — approved asset pack (issue #38)

Integrates a bounded, owner-approved slice of the 2026-08-31 Meshy asset sprint through the
**existing** production asset and character pipelines. No paid generation, no new Meshy calls, and
no second character or animation system. Builds on [#21](../docs/3D_ASSET_PIPELINE.md),
[#23](CHARACTER_IDENTITY_AND_POPULATION.md), [#25](asset-harvest-log.md) and
[#27](HUMAN_PROOF_H0.md).

## What ships

| Wave 0 asset | Projected onto | Gameplay authority stays with |
|---|---|---|
| `blocklife_kabir_01` | the **player** (`PLAYER_CHARACTER_ASSET_ID`) | character controller capsule; primitive fallback + render-mode escape hatch |
| `blocklife_ravi_01` | `npc_ravi_01` **only** | NPC identity, dialogue, quest, social, schedule, save, streaming |
| `compact_sedan_01` | `vehicle_compact_car_01` | `getActiveVehicleProjection()` — ONE physical shell |
| `arch_office_01` | `building_office_01` | `cityLayout` colliders, anchors, overlays, labels, occlusion |
| `prop_park_bench_01` | the existing **`bench` prop type** | `cityLayout` placements + type-based `PROP_SOLIDITY` |

The ambient crowd is deliberately **not** migrated: `DEFAULT_CHARACTER_ASSET_ID` is unchanged, and
`PLAYER_CHARACTER_ASSET_ID` is a separate constant so the player can move without the crowd.

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
