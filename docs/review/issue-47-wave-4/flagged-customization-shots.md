# The two flagged customization baselines — NOT adopted

`painted-sports` and `wheels-offroad` (`tests/visual/vehicle-visuals.spec.ts`) appeared in this
branch's mismatch inventory. They were adjudicated and **deliberately not adopted**; their
committed bytes are untouched. **Both therefore FAIL on this branch.** This is the honest state,
recorded rather than papered over, and it is the one known-red item in the visual gate.

## What changes in the image

| | Sports car at `park_public_central` |
| - | --- |
| committed baseline (and the merge base) | the **procedural `CarShell`, tinted with the applied paint `#2c2c33`** — dark charcoal |
| this branch | the **Wave-1 `vehicle_sports_car_01` GLB in its own baked yellow** |

The two tests are named `a custom-painted sports car parked` and `a sports car with off-road
wheels fitted`. The new frames show neither the paint nor the wheel style, because the Wave-1 body
cannot express either. Adopting them would have deleted the only visual evidence these tests exist
to produce, which is why they were pulled back out of the update set.

## Attribution — measured, not assumed

An earlier attribution run wrongly reported these as pre-existing base failures. That run was
**invalid**: a leftover vite dev server from this worktree was still bound to `:5199`, and
`playwright.config.ts` sets `reuseExistingServer: !CI`, so the "merge base" runs were served this
branch's application code. Every base measurement below was retaken with Playwright owning its own
dev server.

| Experiment | Result |
| ---------- | ------ |
| merge base `efda5d6`, committed baselines | **passes** |
| merge base + 4 s extra settle | passes |
| merge base + 15 s extra settle | passes |
| this branch | **fails** (3/3 runs, same frame) |
| this branch, 4 parked bodies `enabled: false` | **passes** |
| this branch, only `building_gate_tower_02` disabled | fails |
| this branch, 4 rows enabled but `parkedBodyAssetId()` returning null (nothing mounts) | **passes** |

So: the trigger is Wave 4's four parked-vehicle bodies, specifically the act of **mounting** their
~29 instances — not their presence in the manifest, and not elapsed time.

## Mechanism

Nothing on the vehicle render path differs from the merge base — `VehicleAsset.tsx`,
`VehicleVisual.tsx`, `OwnedParkedVehicles.tsx`, `modelRegistry.ts` and `assetVariants.ts` are
byte-identical, `assetManifest.ts` is purely additive, there are no duplicate ids or `glbPath`s,
and `getActiveVehicleProjection` reads the vehicle registry, never the manifest set.

What Wave 4 changes is how often the asset store publishes. `markGlbBranch` bumps
`assetLoadVersion` **only when an id's branch actually changes**:

```ts
if (getGlbBranch(assetId) !== before) {
  useGameStore.setState((s) => ({ assetLoadVersion: s.assetLoadVersion + 1 }))
}
```

At the merge base the owned parked vehicle can settle onto its procedural fallback with nothing
left to re-render it — which is why 15 extra seconds do not help; it is stuck, not slow. Mounting
29 more GLB instances produces further `assetLoadVersion` bumps, the subscriber re-renders, and the
already-loaded sports body commits.

That makes the branch frame the **more** truthful one: the GLB is what the shipped game draws once
the component actually re-renders. The committed baseline encodes a stuck-fallback state.

**The latent stuck-fallback is a pre-existing defect and is deliberately left alone here.** Fixing
it means changing the shared asset/render path, which is outside an asset-integration wave's remit
and is exactly the kind of change issue #47 forbids ("no new renderer"). It is written up so a
later issue can own it.

## Why the paint is not visible once the GLB renders

`assetManifest.ts` records this at the sports entry, in Wave 1's own words:

> this body is ONE BAKED ATLAS — windows, lights, tyres and trim live in the same texture as the
> panels — so it exposes NO clean recolorable body slot. An explicitly EMPTY map means "retain the
> source paint" … Customization and save state are untouched — the selected paint is still stored,
> still shown in the Garage, and still tints the procedural fallback shell. Re-authoring the body
> with real material segmentation is what unlocks a real `paint` slot here.

`materialSlots: {}` is deliberate, and `createVariantInstances` isolates nothing for an empty slot
map, so the body is never tinted. **The feature is not broken** — paint and wheel choice are
stored, persisted, surfaced in the Garage (`garage-paint-<id>-<color>` carries the selection
outline) and covered by unit and E2E assertions. What these two *visual* baselines proved was paint
on the fallback, and that only held while the fallback was what rendered.

## Options considered

| Option | Rejected because |
| ------ | ---------------- |
| Adopt the new frames | Silently deletes the customization evidence the tests are named to prove. |
| Hide or disable the GLB for these shots | Makes the baseline lie about what ships, to buy a green tick. |
| Repoint the shots at a paintable class | All four owned classes ship a Wave-1 GLB; none is paint-visible. |
| Re-author the sports body with real material slots | A paid generation plus a baked-material rewrite — both forbidden by issue #47. |
| Fix the latent stuck-fallback | A change to the shared asset/render path, outside this wave's remit. |

## Disposition

Committed bytes retained; both tests are reported as **known failures on this branch** with the
cause above. The real follow-up is a Wave-1 re-author of `vehicle_sports_car_01` with real material
segmentation (which would restore paint on the shipped body and make these two baselines
meaningful again), plus a separate fix for the latent stuck-fallback. Neither belongs to an
asset-integration wave.
