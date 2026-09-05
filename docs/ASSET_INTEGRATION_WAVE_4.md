# Approved Asset Library Integration — Wave 4 (issue #47)

Citywide visual cohesion from the already-paid, owner-approved 2026-08-31 Meshy sprint. **Zero
paid calls**: no generation, enhancement, remesh, retexture, rig, animation or purchase — the
sprint account is reconciled at a balance of 0, and every byte here comes from an output that was
approved months before this wave started.

This is a **visual projection wave**. Nothing it ships is a gameplay entity. Ids, positions,
routes, schedules, destinations, dialogue, labels, footprints, doors, entrance anchors, colliders,
occluders, prop solidity, vehicle physics/tuning/ownership, traffic rules, population counts,
streaming membership, save schema and interaction distances are all byte- or value-stable, and
each of those claims is gated at the unit level rather than asserted here.

- Base commit: `efda5d6ce4018dd9cb90786d20f205537e835741`
- Intake: [`scripts/asset-intake/wave4.config.mjs`](../scripts/asset-intake/wave4.config.mjs) +
  [`buildWave4.mjs`](../scripts/asset-intake/buildWave4.mjs) →
  [`docs/asset-provenance/wave4-provenance.json`](asset-provenance/wave4-provenance.json)
- Contract gate: [`src/game/assets/wave4Contract.test.ts`](../src/game/assets/wave4Contract.test.ts)
- Visual evidence: [`tests/visual/wave4-asset-visuals.spec.ts`](../tests/visual/wave4-asset-visuals.spec.ts)
- Behaviour evidence: [`tests/e2e/asset-integration-wave-4.spec.ts`](../tests/e2e/asset-integration-wave-4.spec.ts)
- Per-image adjudication: [`docs/review/issue-47-wave-4/`](review/issue-47-wave-4/)

---

## 1. What shipped

**9 new source GLBs across 35 existing authored placements** — inside the issue's ceiling of 12
and 36. Ten bodies reach a runtime home; one of them (`blocklife_ravi_01`) was already in
production from issue #38 Wave 0 and is **reconciled**, not rebuilt.

| Priority | Bodies | Placements | New files |
|---|---|---|---|
| 1 — named residents | 5 (Ravi, Maya, Bruno, Officer Kim, Nisha) | 5 NPC slots | 4 |
| 2 — parked vehicles | 4 (hatchback, pickup, delivery van, box truck) | 29 `parked_car` / `parked_truck` props | 4 |
| 3 — buildings | 1 (second apartment style) | 1 (`building_gate_tower_02`) | 1 |
| **total** | **10** | **35** | **9** |

Payload: **+9.758 MiB** of `dist/` against an 18 MiB budget (GLB +9.751 MiB, JS +7.0 KiB,
gzipped JS +1.0 KiB, CSS ±0).

---

## 2. Priority 1 — six named residents, strict 1:1

Five of the six shipped. The mapping lives in
[`WAVE4_NAMED_BODIES`](../src/game/characters/characterManifest.ts) and is total, injective and
gated: no body serves two people, no body is the player, and each was **built from the sources of
the character it depicts** (the contract test cross-checks the manifest mapping against the intake
config's own per-character source paths, so a body cannot be renamed onto another NPC without the
file it came from disagreeing).

| NPC | Role | Approved source | Verdict |
|---|---|---|---|
| `npc_ravi_01` | Your friend | `ravi-sharma` | **shipped** (existing `blocklife_ravi_01`, reconciled into the slot) |
| `npc_maya_01` | Food truck owner | `maya-okafor` | **shipped** — the vendor apron *strengthens* the role signifier |
| `npc_bruno_01` | Gym trainer | `bruno-castillo` | **shipped** — athletic build + gym wear; see the hue note below |
| `npc_kim_01` | Neighborhood patrol | `officer-kim` | **shipped** — a full patrol uniform + duty belt, a large upgrade on a blue shirt |
| `npc_nisha_01` | Your neighbor | `nisha-rao` | **shipped** |
| `npc_leo_01` | Delivery guy | `leo-fernandes` | **REJECTED — role contradiction** (below) |

### The eligibility rule, applied uniformly

A source is eligible for its 1:1 slot only if, judged from the approved cardinal renders:

1. it reads as that NPC's shipped **role**;
2. it carries **no other occupation's** signifier;
3. its dominant garment hue stays in the same family as the shipped signature colour, so the
   shipped identity is not contradicted. That colour has two other consumers, and for all six
   residents they agree: the authored `def.bodyColor` the procedural fallback capsule draws, and
   `NAMED_IDENTITIES[...].shirtColor`, which the rigged fallback and the dialogue avatar read;
4. it meets the measured technical contract — 24 bones, `c432d433d51d`, ≤25k triangles, grounded,
   non-emissive, one mesh / one material / one ≤1024 texture, and `Idle` + `Walk` + `Run` present.

Rule 3 is **measured, not eyeballed**: the mean torso hue was sampled from the approved front
renders (background pixels excluded) and compared with the shipped `NAMED_IDENTITIES` shirt colour.

| NPC | shipped shirt | measured torso | ΔH | family |
|---|---|---|---|---|
| Ravi | `#4a7fd4` H 217° | `#2c4e70` H 210° | 7° | blue → blue ✓ |
| Maya | `#e0576f` H 349° | `#3a292c` H 352° | 3° | pink → pink ✓ |
| Officer Kim | `#3f5f8f` H 216° | `#1b1e25` H 222° | 6° | navy → navy ✓ |
| Nisha | `#9a5fc0` H 276° | `#351d4e` H 270° | 6° | purple → purple ✓ |
| **Bruno** | `#d4763a` H 23° | `#5a142c` H 340° | **43°** | orange → crimson ⚠ |
| **Leo** | `#6cc24a` H 103° | `#c08f47` H 36° | **67°** | green → amber ✗ |

**Leo is rejected.** His approved source is a hard-hat, hi-vis **construction** worker: it drops
the delivery-bag accessory his role ships with (`accessoryVariant: 'bag'`) and substitutes a
different occupation's signifier. Issue #47 says exactly what to do here — "keep the current body
and report the source as ineligible" — and the strict 1:1 rule forbids giving him someone else's
body (the approved `delivery-worker-v2` is **not** Leo). He stays on the wardrobe-capable
`blocklife_person` with his full registry identity, and a contract test pins that.

**Bruno is admitted, with the deviation recorded.** His role signifier is preserved and
strengthened — visible musculature, a fitted athletic tee, joggers and trainers all read "gym
trainer" — and rules 1, 2 and 4 pass cleanly. What drifts is his signature *colour*: orange to
crimson, 43° of hue. That is an identity deviation, not a role contradiction, so it does not meet
the issue's rejection test; it is listed here and in the PR as the wave's one accepted identity
deviation, and his dialogue-avatar chip (which reads the registry, not the body) still shows the
shipped orange.

### What is preserved, exactly

- **The player is untouched.** `PLAYER_CHARACTER_ASSET_ID` is still `blocklife_person`, still
  exposes all six recolorable slots, and no baked body may ever reach that slot. The save-backed
  wardrobe, its schema and its behaviour are unchanged — this wave writes nothing to `save/`.
- **Baked clothing is immutable.** Each body is one baked material; the manifest declares an
  explicitly EMPTY `materialSlots`, so nothing can tint, palette-wash or rewrite it.
- **The failure branch restores the REAL pre-wave visual — the rig, not a capsule.** This is the
  one place the wave had to add code rather than data. Before Wave 4, a named NPC rendered as the
  wardrobe-capable `blocklife_person` rig wearing its curated registry identity; the coloured
  `NPCMesh` capsule was only ever the last resort *beneath* that rig. Swapping the top of the
  chain and leaving the capsule underneath would have quietly downgraded the failure case, so
  [`NpcCharacter`](../src/game/characters/NpcCharacter.tsx) now makes the chain explicit and
  three-deep:

  > approved named body → `blocklife_person` + this NPC's registry identity → the authored capsule

  Each step is the SAME `AnimatedCharacter` component acting as the previous step's fallback —
  no second renderer, loader or animation path — and the middle step mounts **only** when the
  named body genuinely FAILS, so the healthy render is exactly one rig per NPC, as before.

  That last clause is load-bearing and was got wrong once. The rig is passed as `errorFallback`,
  a branch deliberately split from the Suspense `fallback`, because React renders a Suspense
  placeholder on EVERY healthy load: the first revision passed the rig as the ordinary fallback
  and it mounted on every boot and every sector remount. Nothing in the settled state showed it —
  the instance registry was clean, draw calls, triangles and materials were identical — but the
  GPU texture census at the four district vantage points rose from **274–276 to 329–331**, +55
  retained textures for a rig the settled scene never shows. After the split the census is back
  to 274/275/276/275, and `tests/e2e/asset-integration-wave-4.spec.ts` gates it at 300 (and
  re-asserts that no `#identity` instance exists at any of the four vantage points) so the
  regression cannot return. A contract E2E also asserts no second rig exists while the body is
  healthy, and that `byTier.namedNpc` is still 6. An NPC with no approved body (Leo) keeps the two-step chain it already had,
  byte-identically. The fallback rig is registered as `<npcId>#identity`, so
  `getCharacterState('npc_maya_01#identity')` proves WHICH step produced the picture, and the
  E2E + the `wave4-fallback-resident` baseline both assert it is `blocklife_person`, rendering its
  model, wearing Maya's `#e0576f` / `#c68642` identity with its wardrobe slots resolved.
  `NAMED_IDENTITIES` itself is byte-unchanged and pinned literally by the contract test.
  A second baseline, `wave4-fallback-resident-capsule`, aborts BOTH rigs so the last step of the
  chain is evidenced too rather than merely asserted.
- **No ambient citizen gains a named identity**, and no population count changes. The 13 approved
  role archetypes (café worker, shopkeeper, clinician, firefighter, teacher, student, …) are
  catalogued below and deliberately NOT admitted: they have no 1:1 named slot, and putting them on
  the ambient crowd would be the population/identity change the issue forbids.

### Fit — the rig sizes the body, never the reverse

The approved bodies are authored at correct real-world human height: 1.70 m (Maya, Nisha), 1.71 m
(Officer Kim), 1.76 m (Ravi), 1.84 m (Bruno), each measured from the shipped bytes and matching its
declared height exactly. That is precisely what made the first revision of this wave wrong.

BlockLife's people are stylised. `blocklife_person` — the player's rig, and the body all five of
these NPCs rendered as before this wave — measures **2.930 m**. Mounted at `scale: 1`, a correctly
authored 1.70 m body renders at **58 %** of the height of the player standing next to it, and of
every citizen in the crowd.

The entire structural gate passed while this was true: canonical 24-bone rig, matching hierarchy
signature, valid skin weights, grounded base, measured height equal to declared height. Every one
of those checks asks whether the body is internally consistent. None of them asks whether it
matches what it replaces. It was caught by **looking at** the `wave4-player-beside-*` baseline this
wave adds for exactly that purpose, and then measured: a **1.674x** rendered silhouette ratio
between the player and Ravi, against **1.665** predicted from the two bounding boxes.

So each body is fitted to the rig it replaces:

| Body | Measured | Scale | Renders at |
| ---- | -------: | ----: | ---------: |
| `blocklife_ravi_01` | 1.760 m | 1.6648 | 2.9300 m |
| `blocklife_maya_01` | 1.700 m | 1.7235 | 2.9299 m |
| `blocklife_bruno_01` | 1.840 m | 1.5924 | 2.9300 m |
| `blocklife_kim_01` | 1.710 m | 1.7135 | 2.9301 m |
| `blocklife_nisha_01` | 1.700 m | 1.7235 | 2.9299 m |
| `blocklife_person` (reference, **untouched**) | 2.930 m | 1 | 2.9300 m |

Each named NPC therefore renders at **exactly the height it had before Wave 4**, which is the
invariant that matters: nothing anchored to that height moves.

`bounds` and `anchors` are handled differently, and the difference is not cosmetic:

- **`bounds` describe the MODEL** and are validated against it, so each body keeps its own measured
  numbers (1.76 m for Ravi, and so on).
- **`anchors` are world offsets that are NOT multiplied by `def.scale`** — they place the name label
  and the interaction prompt. A body that now renders at the rig's height must therefore use the
  RIG's anchors (`headY: 2.15`), or every label attached to that NPC moves relative to where it sat
  before this wave.

That exposed a pre-existing inconsistency worth recording: **`blocklife_person` declares
`visualHeight: 1.92` but measures 2.930 m**, and 2.930 m is what it actually renders — confirmed in
the running scene, where every mounted `blocklife_person` reports a world `Box3` of h = 2.930 with
feet at y = 0. The declaration understates the model by 1.53x. Wave 4 does **not** correct it:
changing it would move the PLAYER's authored bounds, which issue #47 forbids. The one place it
surfaces is `cameraClearance.test.ts`, whose "plausible human height" upper bound is expressed in
that declared arithmetic; bodies fitted to the rig's real size necessarily exceed it, so they are
held to the stricter per-body equality gate in `wave4Contract.test.ts` instead, with the reason
documented at both sites.

The player is not rescaled: `blocklife_person` stays at `scale: 1`, gated explicitly.

`wave4Contract.test.ts` re-measures the reference rig from its own bytes, checks every pinned
height against the sha256 of the file it was measured from, and asserts `scale x measured ==
2.930 m` per body — so a re-authored body fails the gate instead of silently keeping a stale scale.
See CONVENTIONS #42.

### The Wave 0 decision, narrowed rather than weakened

Issue #38 Wave 0 recorded an owner decision that baked-material sprint bodies must stay out of
**both** the player slot and every NPC def. Half of that is permanent and still gated verbatim in
`wave0Contract.test.ts`: a baked body cannot expose the recolorable slots the save-backed player
wardrobe is built on, so it may never be the player. The other half was a blanket rule adopted
because, at the time, no baked body had an owner-approved 1:1 identity to justify a runtime slot.
Issue #47 replaces that half deliberately: a named NPC may ride the ONE approved body that depicts
that exact character, under the injective mapping and the eligibility rule above.
`CANDIDATE_CHARACTER_ASSET_IDS` remains the register of approved bodies with **no** runtime home
(today: Kabir, who is not a member of the shipped cast).

### Known limitation — the idle pose

The approved rigs ship the two clips Meshy includes free with a rig (`Walking`, `Running`) plus the
base rig's own 0.3 s `clip0`, which the Wave-0 pipeline names `Idle`. Measured from the shipped
bytes, that clip holds the **A-pose**: the hands sit at ±0.33 m lateral and 1.31 m high on a 1.76 m
body, i.e. arms out and down at roughly 45°. Walk and Run are proper gaits with the arms at the
body. So a named resident standing at an idle anchor stands with its arms slightly out.

This is an **asset** limitation, not a pipeline one, and it is the same clip set Wave 0 shipped and
the owner reviewed. Closing it needs either a paid `meshy_animate` idle (3 credits per body —
forbidden by this issue) or an in-repo authored 24-bone idle (out of scope here). The
gameplay-distance idle frames in the visual suite are the evidence for judging it at the merge
gate.

---

## 3. Priority 2 — parked-vehicle diversity

Four approved bodies project onto **all 29** authored `parked_car` / `parked_truck` PROP
placements. They are scenery: no `VehicleDef`, no collider, no seat, no tuning, no ownership
record, no save field, no traffic entry. The one-shell drivable model and the four ownable classes
are untouched, and a contract test asserts no parked body is a class body.

Covering *all* the placements is deliberate. A street that mixes a detailed GLB car with a
primitive box beside it reads worse than either alone, so the projection is total for both types —
`CarMesh` / `TruckMesh` remain the `LandmarkAsset` fallback underneath every one of them, with the
authored per-placement `def.color` intact on that branch.

### Fit — the authored envelope decides the size

`propPlacement.ts` declares the visual envelope each type already occupies (it is transcribed from
the procedural meshes, and the placement validators measure against it). Issue #47 forbids a body
that "exceeds its authored envelope", so each body is scaled UNIFORMLY to fit *inside* it rather
than the table being widened to suit the body:

```
s = floor( min( (2·visualHalf.z) / sizeX , (2·visualHalf.x) / sizeZ , vertical[1] / sizeY ) · 10⁴ ) / 10⁴
```

computed AFTER the +π/2 yaw that puts the model's own length axis (local X) on the placement's
longitudinal axis (local Z) — the convention `vehicle_compact_car_01` already ships.

| Body | Type | Envelope (L × W × H) | Scale | Rendered (L × W × H) | Binds |
|---|---|---|---|---|---|
| hatchback | `parked_car` | 4.0 × 2.0 × 1.4 | 2.1068 | 4.000 × 1.702 × 1.377 | length |
| pickup | `parked_car` | 4.0 × 2.0 × 1.4 | 1.7455 | 3.312 × 1.480 × 1.400 | height |
| delivery van | `parked_truck` | 4.6 × 2.3 × 2.1 | 2.2952 | 4.352 × 2.036 × 2.100 | height |
| box truck | `parked_truck` | 4.6 × 2.3 × 2.1 | 2.1208 | 4.026 × 1.818 × 2.100 | height |

The procedural `CarMesh` is 3.9 × 2.0 × 1.36 and `TruckMesh` 4.5 × 2.3 × 2.1, so the hatchback and
both trucks land within a few centimetres of the silhouette they replace. The pickup is the one
that gives ground: at 3.31 m it under-fills its bay by 0.69 m, because the authored 1.4 m ceiling
binds before the length does. That is a real small-utility-pickup length, not a distortion — the
scale is uniform and the source proportions are exactly as approved.

### Mapping — deterministic AND spatially balanced

[`parkedVehicleBodies.ts`](../src/game/world/parkedVehicleBodies.ts) owns the rule. A plain
`hash(id) % poolSize` is deterministic but blind: measured against the shipped placements it puts
identical bodies 5.9 m apart in the central lot and repeats one van three times across the
industrial yard. So the rule is a deterministic **spatial sweep** instead — placements are
processed in ascending id order (total, stable, independent of array position) and each takes the
pool body whose nearest already-assigned instance is farthest away, ties broken by pool order.

Measured on the shipped city:

| Type | Placements | Distribution | Closest identical pair |
|---|---|---|---|
| `parked_car` | 19 | 9 / 10 | 8.90 m (`vehicle_parked_car_01` & `_c3`) |
| `parked_truck` | 10 | 5 / 5 | 17.50 m (`s-1_-2_trucks_1` & `_3`) |

The gate asserts no two placements closer than `PARKED_BODY_MIN_SEPARATION` (8 m — two car
lengths) share a body, and that the pool is used within one placement of even. Perfect separation
across a whole camera frame is not reachable and the gate does not pretend it is: the central lot
holds three placements inside a 9 m triangle, so with two approved car bodies one repeat there is
forced by geometry.

### The honest cost

Today's parked props carry 15 distinct authored `def.color` hues on one primitive box. The
approved bodies are baked atlases with no recolorable slot (tinting one would recolour its glass
and lights — the rule Wave 1 settled), so the street trades **15 flat hues of one shape** for
**4 detailed, correctly-proportioned, textured vehicles**. The authored colours are not lost: they
still drive the procedural fallback, and they remain in `cityLayout.ts` untouched.

---

## 4. Priority 3 — one building body

`building_gate_tower_02` — the unlabelled, east-door residential-scale tower in the Downtown
Gateway, standing beside "Meridian Tower" and "Gateway Offices" — takes the approved second
apartment style, a balconied residential slab. No authored role, label or interaction is
contradicted; there is no label to contradict and no interactable on this placement.

Canonical facing is **measured, not assumed**: the intake's per-side facade profile puts 974
entrance-band vertices on the model's own +z elevation against 434–531 on the other three, and the
rendered cardinals show the single ground-floor door there. The authored EAST door therefore yaws
the body by +π/2.

```
s = floor( min( 4 / 4.73375 , 4 / 4.73215 , 15 / 22 ) · 10⁴ ) / 10⁴ = 0.6818      (HEIGHT binds)
  → model-local 6.4527 × 14.9996 × 6.4549 ; rendered 6.4549 wide × 6.4527 deep on the 8 × 8 lot
```

Height binds because the body is 22 m tall and `MAX_WORLD_RENDER_HEIGHT` is 15 — the camera-engulf
ceiling issue #46 derived from `CAMERA_OFFSET` (eye at y = 18, 3 m clearance). Two costs follow
from that, and both are consequences of a camera invariant the repo owns rather than of this
placement:

- the eight storeys read at a **1.875 m pitch**, against a 1.8 m player;
- the body **under-fills its 8 m lot by 0.77 m per side**.

`building_apartment_01` already ships the same trade at 0.6 (25 m → 15 m). `def.size` remains the
sole authority for the collider, the occluder box, routing and anchors; `renderedTopY` (14.9996) is
recomputed from the shipped bytes by `cameraClearance.test.ts`, so occlusion covers the mass the
body really has.

**Only one building was admitted.** Every other approved building was measured and rejected — see
§5. Issue #47 permits up to two; asset count is not a success metric.

---

## 5. Rejected and held — the full inventory

Nothing below is in production. Everything below stays catalogued in the read-only sprint tree.

### Humans (20 approved bodies)

| Source | Disposition |
|---|---|
| `leo-fernandes` | **REJECTED — role contradiction.** Hard hat + hi-vis construction jacket against a "Delivery guy" role with a bag accessory; measured ΔH 67°. Leo keeps his procedural body. |
| `kabir-sen-v3` | Not selected — no NPC in the shipped cast depicts Kabir. Stays a Wave-0 candidate in no runtime slot. |
| `delivery-worker` (v1) | Rejected at source by the sprint (fused bicycle, corrupted face). Never selectable — the issue names it explicitly. |
| `delivery-worker-v2`, `cafe-worker`, `shopkeeper`, `construction-worker`, `clinician`, `firefighter`, `teacher`, `student`, `office-worker`, `senior-citizen`, `fitness-citizen`, `business-professional`, `resident-a` | **Out of scope.** Priority 1 is a strict 1:1 named mapping; none of these depicts a member of the six-resident cast. Issue #47 forbids giving ambient citizens named identities or spawning population, so there is no eligible home for a role archetype in this wave. |

### Vehicles (16 approved bodies)

| Source | Disposition |
|---|---|
| `compact_sedan`, `scooter`, `utility_van`, `sports_coupe` | Already in production as the four ownable classes (Waves 0/1). Not re-projected as scenery: the "at most four additional bodies" ceiling is spent, and reusing a class body as street furniture would blur owned-vs-scenery. |
| `city_taxi` | **REJECTED — semantics.** Fits (3.39 × 1.57 × 1.40), but a yellow-and-checker taxi livery repeated across ~9 placements implies a fare service BlockLife does not model. |
| `police_car` | **REJECTED — semantics.** Fits (4.00 × 1.59 × 1.27), but a parked cruiser implies police presence that the live police/pursuit system owns. |
| `family_suv` | **REJECTED — fit.** h/l 0.579, so the authored 1.4 m ceiling shrinks it to **2.42 m** long: a toy beside a 4.0 m hatchback. Fails the scale-hierarchy bar. |
| `city_bus`, `fire_engine`, `ambulance`, `garbage_truck` | **REJECTED.** Explicitly ineligible large service bodies, and none fits either authored envelope at a believable length (bus 4.00 × 1.25, the rest height-bound to 2.5–3.1 m). |
| `bicycle` | **REJECTED — fit + no home.** 2.41 m at the car ceiling, and no authored placement type is a cycle stand. |

### Buildings (21 approved bodies)

| Source | Disposition |
|---|---|
| `park_utility_01` | **REJECTED after gameplay adjudication.** The Pier Kiosk placement (`s0_-2_pavilion`, 4 × 3.2 × 4) is a near-1:1 footprint match and it was the strongest candidate on paper — but the rendered cardinals show through-wall HOLES on three of four elevations plus ragged eaves and loose base rubble. The sprint ledger calls it "the weakest asset — meshy-5 source, mesh noise at the eaves"; the issue requires those notes to be adjudicated before admission, and at a 1:1 scale on a walk-past pier structure they read as broken geometry. |
| `mixed_use_01` | **REJECTED — scale coherence.** The largest authored lot that could take it forces s ≈ 0.481 (Gateway Offices) or 0.361 (Market Row): 1.4–1.9 m storeys against a 1.8 m player. |
| `suburban_house_01` | **REJECTED — scale coherence + slab.** s ≈ 0.385 on a 5.5 m house lot → a 3.1 m two-storey house; it also ships on a ground slab. |
| `duplex_01` | **REJECTED — fit.** 15.6 m wide against 5.5 m house lots → s ≈ 0.35, 2.3 m tall. |
| `clothing_shop_01` / `_v2` | **HELD by the issue.** Painted mannequin figures remain on the side and rear glazing; the sprint's retexture repaired only the front elevation. |
| `fire_station_01` | **REJECTED** by the issue and by the sprint (terrain slab + two clumps of embedded trees; never textured). |
| `hospital_01`, `bank_01`, `school_01`, `police_station_01`, `laundromat_01`, `clinic_01`, `pharmacy_01`, `restaurant_01` | **REJECTED — no matching role.** Each is a SPECIFIC facade and the city authors no placement of that role. Issue #47 forbids forcing one onto a differently-named building. |
| `house_01`, `apartment_01`, `shop_01`, `office_01`, `row_house_01`, `repair_garage_01`, `hotel_01` | Already in production (Waves 0/3), untouched. |

### Props

The approved park bench, streetlight, hydrant and trash bin are already in production (Waves 0/2).

| Source | Disposition |
|---|---|
| `blocklife_prop_traffic_light` | **HELD — the four-lens light stays held.** The approved signal head carries FOUR stacked lenses (a documented, accepted sprint deviation). BlockLife's signal is a live, animated **three-state** red/yellow/green machine, and issue #47 permits the light only if that contract "can be preserved visibly and mechanically". A four-lens decorative head cannot show a three-state signal without a lens that never lights or a state that never shows — i.e. a visual that contradicts the live state. Held. |
| bus shelter | Never delivered by the sprint (both attempts failed the approval bar). |

---

## 6. Fallback and failure

Every body keeps its procedural fallback and the wave adds no code path that can bypass it. Both
branches are exercised for **each source class**:

- **healthy** — the GLB renders once, with no procedural dressing behind it. The parked bodies are
  whole vehicles (wheels, glass and lights are in the baked atlas), so they REPLACE `CarMesh` /
  `TruckMesh` rather than composing over them: no duplicate wheels, no primitive shell.
- **failed** — the file is aborted at the network layer before the page loads, so `useGLTF` throws
  and the boundary renders the complete pre-wave visual: for a named resident that is the
  `blocklife_person` rig wearing its registry identity (NOT the capsule — see §2), for a parked
  placement the procedural car/truck with its authored `def.color`, and for the tower the
  procedural building with its window overlays. A third character shot aborts the identity rig
  too, so the last step of the chain is photographed rather than assumed.
- **shared-source isolation** — the four parked bodies each back several placements; a failure of
  one body must not blank the placements that use the others.
- **remount** — a streaming unload → reload must leave no stale `active` / `failed` state, which
  `glbLandmarksActive`/`Failed` and `getAssetReadiness()` report directly.

---

## 7. One determinism fix this wave had to make (and why it changed no baseline)

Four `asset-vehicle-*` driving baselines and several other car-entering shots started mismatching
on this branch. They were **not** Wave 4 content, and the investigation is recorded here because
the failure mode is easy to misread as one.

`resetGame()` re-seats the drivable shell at `CAR_SPAWN`'s y = 0.8 and physics drops it;
`VehicleController` preserves whatever vertical velocity it finds
(`setLinvel({ x: vx, y: vel.y, z: vz })`). A shot that enters the car mid-fall therefore leaves it
climbing forever, dragging the follow camera and shifting the whole frame — measured 0.302 → 0.717
over six seconds, against y = -0.00006 at the merge base. The tell is in the diff image: every
building edge AND the HUD labels appear doubled, which no content change can do.

How it was attributed rather than assumed:

| step | result |
|---|---|
| hash `-actual.png` over 3 identical runs | three DIFFERENT hashes → nondeterminism, not content |
| same spec at the merge base, 3 runs | 10/10, 10/10, 10/10 → introduced here, not inherited |
| new colliders from the parked GLBs? | no — every rapier body is `colliders={false}` |
| skinned-render CPU cost? | no — forcing primitives made the drift WORSE |
| frame-rate / dt? | no — flat 50 ms / 20 fps on both |
| main-thread stalls from GLB parsing? | no — the base had MORE and LARGER spikes |
| enter the car a few ms later | y 0.302 → 0.00089; with an 8 s settle, drift exactly **0.0** |

The fix is one wait in the shared `acquireDrivableCar` helper (`waitForVehicleGrounded`), backed
by a DEV-only `getDrivableVehiclePosition()` accessor because `getStats().position` only reports
the car once you are already driving. No tolerance was changed, no physics was changed, and with
the car grounded the branch's frames matched the committed baselines exactly — **those baselines
were not updated, because they never needed to be**. Recorded as CONVENTIONS #40.

## 8. What is NOT in this wave

No new gameplay, city expansion, mission, interaction, renderer, animation system, physics class,
entity, population, save migration or save field. No player-model replacement. No paid asset work.
No forced use of the remaining library. No bulk baseline update.
