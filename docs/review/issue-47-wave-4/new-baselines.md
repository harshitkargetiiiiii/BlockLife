# Issue #47 Wave 4 — the 75 new baselines

`tests/visual/wave4-asset-visuals.spec.ts` defines **75** screenshots, none of which had a
committed baseline before this branch. In the pre-update inventory they show up as *missing*, not
*changed* — a new baseline is not an adjudicated migration, so they are counted and reviewed
separately from the 15 adopted images.

They were captured with `--update-snapshots=all` scoped to that one spec, against a dev server
Playwright started itself, and then inspected.

## What the 75 cover

| # | Group | Count | What it proves |
| - | ----- | ----: | -------------- |
| 1 | Isolated static bodies — 4 parked vehicles + the tower, each at 4 cardinals + three-quarter | 25 | Every new source rendered unobstructed at its **shipped** scale, so the projected size, the silhouette and the ground contact are all reviewable. The city is too dense to shoot these in situ — the same reason Wave 3 gave. |
| 2 | Isolated character bodies — Maya, Bruno, Officer Kim, Nisha, at 4 cardinals + three-quarter | 20 | Each named body through the **production** character path (the shared 24-bone rig), not a bespoke viewer. |
| 3 | The player beside each named resident | 5 | The identity evidence issue #47 asks for by name: the resident reads as that character **and the player is visibly unchanged** — the shipped `blocklife_person` with its save-backed wardrobe, no override in play. |
| 4 | The seven districts at gameplay distance | 7 | The citywide cohesion claim, at the distance a player actually sees. |
| 5 | The central lot — three placements, two bodies | 1 | The anti-copy-paste read: the deterministic spatial sweep does not put identical bodies side by side. |
| 6 | Parked car + parked truck ground contact, close | 2 | No float and no sink: the body sits inside the authored `propPlacement` envelope. |
| 7 | The tower entrance faces the authored east door | 1 | The canonical facing measured from entrance-band vertex density, confirmed in the render. |
| 8 | Day / night / rain × (resident, parked vehicle, tower) | 9 | Nothing is self-lit; every new body takes the scene's lighting and weather like the rest of the city. |
| 9 | A missing model restores the complete pre-wave visual | 5 | The fallback chain, per source class: a named GLB failing restores the **pre-wave rig + registry identity**; with both rigs unreachable it ends at the authored capsule; a parked car/truck restores `CarMesh`/`TruckMesh`; the tower restores the procedural building. |
| | **total** | **75** | |

Group 9 is the one that earned the extra code in this wave, and it is worth reading the spec for:
the middle step of the chain is the **error** fallback, not the Suspense fallback, so a healthy
named body never instantiates it. That distinction is measured, not asserted — conflating the two
mounted five extra rigs on every boot and cost +55 retained GPU textures.

## The first capture was discarded

These 75 images were captured twice. The first set is not what ships.

Reviewing sheet 5 of the first capture — the `wave4-player-beside-*` group, which exists precisely
to answer "does this resident read as that character, and is the player unchanged?" — the residents
were obviously too small next to the player. Measured from the baseline itself, the player's
rendered silhouette was **1.674x** Ravi's, against **1.665** predicted from the two GLB bounding
boxes (2.930 m vs 1.760 m). Every named resident was shipping at **~58 %** of the player's height.

The structural gate had passed the whole time. `wave4Contract.test.ts` verified the canonical
24-bone rig, the `c432d433d51d` hierarchy signature, valid skin weights, a grounded base, and that
each body's measured height equalled its declared height — 1.70 m measured, 1.70 m declared, green.
Every one of those checks asks whether the body is internally consistent. None of them asked
whether it matched the body it replaces.

The fix fits each body to that rig (`scale = 2.930 / measured`), so every named NPC renders at
exactly the height it had before this wave, and adds a per-body gate on the RENDERED height. All 75
were then recaptured against the corrected scale, and the first set was thrown away rather than
adopted.

This is the argument for the group-3 shots existing at all: no structural assertion caught it, and
the frame did — immediately.
