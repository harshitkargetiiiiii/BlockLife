# Issue #47 Wave 4 — per-image baseline adjudication

Every existing baseline this branch changes, adjudicated **individually** against its own
`expected | actual | diff` triplet. Nothing was bulk-updated and nothing was accepted on the
strength of a neighbouring image. The contact sheets carrying these exact triplets are
[`sheets/sheet-01.jpg`](sheets/sheet-01.jpg) and [`sheets/sheet-02.jpg`](sheets/sheet-02.jpg).

- **Adopted: 15**, each for a stated attributable cause
- **Adjudicated and deliberately NOT adopted: 2** — see [`flagged-customization-shots.md`](flagged-customization-shots.md)
- **Rejected-without-replacement: 0**
- **Bulk updates: 0** — the update run was per-spec and exact-title, verified with `--list`
  before running, and `git status` was asserted to show exactly 15 changed PNGs after.

## Adopted (15)

| # | Image | Spec | Changed px (ratio) | Attribution |
| - | ----- | ---- | ------------------ | ----------- |
| 1 | `asset-building-tower-variant` | `asset-upgrade-visua-e9fcf-t-reused-Large-2-archetype-` | 34,515 (4.0%) | a parked car beside the west residential street; the backdrop tower subject is untouched |
| 2 | `character-driving-hidden` | `character-visuals-c-d6be7-racter-model-inside-the-car` | 40,787 (5.0%) | parking-lot parked cars + a house/streetlight that now render their merged GLB; the hidden-driver claim is unaffected |
| 3 | `city-evening` | `city-visuals-city-visuals-evening-city` | 30,020 (4.0%) | a parked car and a named resident, plus a house/streetlights now rendering their merged GLB |
| 4 | `mission-courier-pickup` | `mission-visuals-mis-58ed2-—-pickup-marker-HUD-tracker` | 37,185 (5.0%) | three parked vehicles + streetlights; the pickup marker and HUD tracker are untouched |
| 5 | `dealership-bays` | `vehicle-visuals-Veh-2c878-ls-the-dealership-bays-area` | 32,465 (4.0%) | three parked vehicles, plus a streetlight and building now rendering their merged GLB |
| 6 | `parked-lot` | `vehicle-visuals-Veh-8bd98-ot-of-owned-parked-vehicles` | 20,733 (3.0%) | three authored parked_car props; the OWNED parked vehicles (the subject) are untouched |
| 7 | `wave0-bench-occupied` | `wave0-asset-visuals-0e305--citizen-sit-pose-alignment` | 19,170 (3.0%) | a named resident + a parked car + street furniture; the bench and its seated citizen are untouched |
| 8 | `wave0-office-cardinal-south` | `wave0-asset-visuals-66068-rdinal-south-facade-opaque-` | 36,507 (4.0%) | three parked vehicles + streetlights; the office facade subject is untouched |
| 9 | `wave0-bench-district-context` | `wave0-asset-visuals-956dc-—-bench-among-central-props` | 22,190 (3.0%) | two parked cars + street furniture now rendering merged GLBs; the bench subject is untouched |
| 10 | `wave1-scooter-parked-dealership` | `wave1-asset-visuals-db0c3-arked-at-the-dealership-bay` | 37,691 (5.0%) | two parked vehicles + one streetlight; the scooter subject is untouched |
| 11 | `wave2-streetlight-context-central` | `wave2-asset-visuals-3693b--the-other-street-furniture` | 20,304 (3.0%) | ONLY the three parked vehicles change; the streetlight subject, house and road are untouched |
| 12 | `wave3-context-gate-hotel-01` | `wave3-asset-visuals-0b8cc-f-the-city-at-play-distance` | 21,572 (3.0%) | the ONLY change is the new building_gate_tower_02 body entering the gateway context |
| 13 | `wave3-hotel-fallback-missing-model` | `wave3-asset-visuals-aa22e-omplete-procedural-building` | 37,923 (5.0%) | a parked vehicle + the new gateway tower; the procedural hotel fallback is untouched |
| 14 | `wave3-hotel-entrance-west` | `wave3-asset-visuals-c16ad-trance-elevation-faces-west` | 37,903 (5.0%) | a parked vehicle + the new gateway tower; the hotel subject is untouched |
| 15 | `weather-cloudy-residential` | `weather-visuals-wea-e729d-y-midday-residential-street` | 40,285 (5.0%) | two parked cars now the hatchback body, plus a house now rendering its merged GLB |

## Held back (2)

| Image | Spec | Changed px (ratio) | Why not adopted |
| ----- | ---- | ------------------ | --------------- |
| `wheels-offroad` | `vehicle-visuals-Veh-8ac6c-with-off-road-wheels-fitted` | 28,355 (4.0%) | NOT ADOPTED — committed bytes retained. The frame is truthful (the Wave-1 sports GLB is what ships once the component re-renders) but it deletes the customization evidence this test is named to prove, because that body is a baked atlas with no paint slot (a deliberate Wave-1 decision). Bisected to the MOUNTING of the four Wave 4 parked bodies; the merge base passes even with +15s. See flagged-customization-shots.md. |
| `painted-sports` | `vehicle-visuals-Veh-b7574-m-painted-sports-car-parked` | 27,312 (3.0%) | NOT ADOPTED — committed bytes retained. The frame is truthful (the Wave-1 sports GLB is what ships once the component re-renders) but it deletes the customization evidence this test is named to prove, because that body is a baked atlas with no paint slot (a deliberate Wave-1 decision). Bisected to the MOUNTING of the four Wave 4 parked bodies; the merge base passes even with +15s. See flagged-customization-shots.md. |

## A 16th image, adjudicated after the rig fit

Fixing the character scale (see [`new-baselines.md`](new-baselines.md)) changed the shipped scale
of five character bodies, so the complete inventory was re-run. Exactly one further existing
baseline moved:

| Image | Spec | Verdict | Attribution |
| ----- | ---- | ------- | ----------- |
| `wave0-candidate-ravi-close` | `wave0-asset-visuals` › Wave 0 — candidate characters (DEV override only) › Ravi candidate — close read (visual proxy only) | accepted | A Wave-0 "visual proxy only" shot of `blocklife_ravi_01`. It changes because that body's **shipped scale** changed from 1 to 1.6648. Inspected side by side: in the committed frame Ravi is visibly smaller than the primitive citizen standing beside him; in the new one he is correctly sized against them. The frame remains exactly what the test is for — a close read of the candidate body. |

Its sibling `wave0-candidate-ravi-wide` did **not** move: at that framing the subject is small
enough that the change stays inside the 3 % tolerance. It was left untouched rather than refreshed
for tidiness.

**Total existing baselines modified: 16.**

## The two causes behind these frames

Every row resolves to one of exactly two causes. Neither is a code change to an earlier wave's
asset: the manifest rows, scales, rotations and placements of Waves 0–3 are byte-identical on this
branch, and `git diff` on `assetManifest.ts` is purely additive.

### Cause A — a Wave 4 body genuinely enters the frame

Every adopted frame contains at least one of: a `parked_car`/`parked_truck` prop now carrying one
of the four approved parked bodies, the new `building_gate_tower_02` body, or a named resident on
their approved body. That is the intended, in-scope change and it is why the image changes at all.

### Cause B — a stuck procedural fallback in the committed baseline

Several `expected` images additionally held the **procedural fallback** for an asset that shipped a
GLB in Waves 0–3 — box houses where a Wave-0/3 building body belongs, a primitive post where the
Wave-2 streetlight belongs, a `CarShell` where the Wave-1 sports body belongs.

This is not slowness. Extra settle time does not change it — the merge base still renders the
fallback with 15 additional seconds. `markGlbBranch` publishes `assetLoadVersion` only when an
id's branch actually *changes*, so an instance can settle onto its fallback with nothing left to
re-render it. Wave 4 mounts ~29 more GLB instances, each of which can bump that counter, and the
already-loaded body finally commits.

So the adopted frames are the **more truthful** ones, and this is a side effect of mounting more
assets rather than a visual change Wave 4 authored. The latent stuck-fallback itself is a
pre-existing defect in the shared asset path; fixing it is outside an asset-integration wave's
remit and is written up in [`flagged-customization-shots.md`](flagged-customization-shots.md) for a
later issue to own.

For two images this had a semantic consequence severe enough to refuse the update — see that same
document.

## Not updated for other reasons

| Image | Why |
| ----- | --- |
| `asset-player-humanoid` | An **intermittent pre-existing flake**: it also fails on the exact merge base `efda5d6` and passes on some runs of this branch. Baking one sample of a flake into the baseline would hide it. Left at committed bytes. |

## The adopted bytes are the frames that were inspected

After the targeted update, each newly written baseline was compared back to the exact `-actual.png`
that was adjudicated on the contact sheet. Worst deviation across all 15: **0.222 %** — AA jitter,
against the 3–5 % content deltas being adopted. No image was adopted on the strength of a
differently-timed capture than the one that was inspected.
