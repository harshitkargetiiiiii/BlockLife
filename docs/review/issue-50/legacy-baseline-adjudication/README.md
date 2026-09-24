# The two legacy vehicle baselines — reviewed image by image, then migrated

`tests/visual/vehicle-visuals.spec.ts`, exact titles `a custom-painted sports car parked` and
`a sports car with off-road wheels fitted`. Collected on this branch so the decision can be made on
the actual images rather than on a description of them.

These six images were inspected individually — expected, actual and diff for each test — and on
that basis exactly two reference PNGs were approved for replacement. Nothing in this directory is
itself a snapshot; it is the record the decision was made from.

## Run 1 — collected with NO update, for the decision

```
npx playwright test tests/visual/vehicle-visuals.spec.ts \
  -g "a custom-painted sports car parked|a sports car with off-road wheels fitted" \
  --workers=1 --output=<unique dir>
→ Running 2 tests using 1 worker
→ 2 failed   (exit 1)
```

| test | difference against the committed golden |
| - | - |
| `painted-sports` | 24,449 px (ratio 0.03) |
| `wheels-offroad` | 26,874 px (ratio 0.03) |

## Why they differed, and why the difference was accepted

Both goldens **predate the model they photograph**. `painted-sports-chromium-darwin.png` last
changed in `ba68922` (2026-08-20, #24); `public/assets/models/vehicles/sports_car_01.glb` was
replaced in `27aa628` (2026-09-01, Wave 1 #41). The body in the `expected` images is the OLD one — a
single untextured `paint` material, which the existing variant path recolored — so no run after
`27aa628` can reproduce them. See §1 of `docs/VEHICLE_PAINT_SEGMENTATION.md`.

They therefore differ on master too, and their difference is **not** evidence about this branch's
change.

What the new captures show, and what they do not:

- the approved Meshy coupe wearing the **actual saved paint** (charcoal / terracotta), dark windows,
  one wheel set, and no whole-atlas tint;
- the already-approved Wave 4 / Wave 2 scenery around it (red hatchbacks, white pickup, the vintage
  lamp) — these two full-scene references had been held back from earlier waves and are reconciled
  to merged content here;
- roads, building layout, camera framing, player appearance/wardrobe and UI layout unchanged;
- the off-road frame is the documented sports-body **1.04 cap, not 1.18**. These wide views do NOT
  by themselves prove wheel size — that rests on the fixed-frame round trip (byte-exact, with a
  negative control), the near-wheel evidence, and the all-four-wheel geometry clearance test;
- incidental HUD differences are visible and are NOT art changes: old 13:08/13:09 and hunger 21
  against new 13:33/13:37 and hunger 22/23. The legacy setup lets the clock run until freeze; this
  PR introduces no new time or needs behaviour. Screenshot tolerances are unchanged.

## Run 2 — the migrated references, still with NO update

```
(same command, unique output dir)
→ Running 2 tests using 1 worker
→ 2 passed   (exit 0)
```

Exactly two files changed under any `*-snapshots/` directory, both verified by hash before and
after the copy:

| reference | old SHA-256 | new SHA-256 |
| - | - | - |
| `painted-sports-chromium-darwin.png` | `d1773cc4…` | `bef0f846…` |
| `wheels-offroad-chromium-darwin.png` | `651627d8…` | `d50e0f6b…` |

The first run's honest result — 2 executed, 2 failed, exit 1 — is preserved above; it was a
screenshot difference, not an activation failure.

## Files (SHA-256, bytes)

```
bef0f84616eea5846a5d40829d97e84930f1f27b2146e8a64fce36f15f65ec95  230673  painted-sports-actual.png
2faf02fcfac2e0941d3e563d9cb66a035f0c834d5dee0d4dc57ca7a8859d1a56  161329  painted-sports-diff.png
d1773cc4b5c5ee9d5c57122270be271383d6b10f176e24e40384c9602293403d  198640  painted-sports-expected.png
d50e0f6b9a5227fc27ba4e90b045543a9368d2cb31f7023667a2f10351d5aff8  232938  wheels-offroad-actual.png
6aeafde0c0560a11f97318c98b85e89c17b5b4f7cd186637a4fea57bf1e4c683  164451  wheels-offroad-diff.png
651627d8563da82a7c5e2aebee6fa5da92f2a5c335dd98edf5b324b93807fe7e  199621  wheels-offroad-expected.png
```
