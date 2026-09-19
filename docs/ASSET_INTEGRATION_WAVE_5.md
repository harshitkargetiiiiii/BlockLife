# Asset Integration Wave 5 — the live police cruiser

One approved 2026-08-31 sprint body, `blocklife_vehicle_police_car`, drawn on every cruiser in the
live police pool (`src/game/police/PoliceUnits.tsx`). Zero credits; no new vehicle class.

## Why this home

Wave 4 measured this body inside the parked-car envelope and rejected it as a **parked prop** on
semantics: a parked cruiser implies police presence that the live police/pursuit system owns
(`ASSET_INTEGRATION_WAVE_4.md` §Rejected). The live cruisers *are* that presence, and they already
drew the same procedural `CarMesh` the parked props draw — so the body replaces exactly the thing it
depicts, with no identity question: every cruiser shares one fixed navy livery today, and no police
unit has a per-unit colour a mission or test could depend on.

## What changes, and what does not

| | |
|---|---|
| Renders | `LandmarkAsset('vehicle_police_cruiser_01')` per pool slot (3 = the L3 cap). |
| Fallback | the complete pre-wave cruiser — `CarMesh` **and** its flashing light bar — for a disabled, loading or failed GLB. |
| Fit | uniform 2.1076 (length-bound) after a +π/2 yaw, inside the `parked_car` envelope the same `CarMesh` occupies: 1.59 × 1.27 × 4.00 m. Nose on +Z, confirmed on the rendered body. |
| Siren | the red/blue alternation is kept. On the approved body the lamps cover the model's own roof bar (measured from the vertices); on the fallback they stay at their original spot. Exactly one bar is mounted per cruiser, found by name each frame. |
| Untouched | police director, dispatch caps, road routing, avoidance boxes, dismount, occupancy, arrests, wanted relay, saves. |

## Evidence

- Intake: `node scripts/asset-intake/buildWave5.mjs` (`--check` reproduces byte-identically);
  provenance in `docs/asset-provenance/wave5-provenance.json`.
- Contract: `src/game/assets/wave5Contract.test.ts` — bytes/provenance, budgets, runtime-safe
  material, envelope fit recomputed from `PROP_PLACEMENT`, yaw, and the lamp cover re-measured
  from the shipped vertices (a lamp bar floated at the old 1.45 m fails it).
- E2E: `tests/e2e/police-cruiser-body.spec.ts` — the body mounts on dispatched cruisers with the
  body-fitted bar mounted, and an aborted GLB leaves the procedural cruiser with its original bar.
  In both branches every bar shows exactly one lamp and then **switches to the other lamp within
  a bounded 8 s window** (a frozen siren fails it). The abort case produces the expected
  "Could not load … Failed to fetch" page errors, one per pool slot — it is a fallback test, not a
  zero-error one; only the body case asserts no page errors.

## Not done here

Ambient traffic and stealable parked cars also draw `CarMesh`, but with a per-car `def.color`, and
the approved car bodies are single baked atlases with no recolorable slot. Swapping them would drop
colour identity, which is a decision (or a re-authored body with a paint slot), not fitting work.
