# Character Identity & Population Visual Upgrade (issue #23)

How every person in BlockLife — the named cast, the ambient crowd, and the
player — gets a **distinct, deterministic visual identity** on the ONE rigged
character pipeline, without a second rendering, animation, dialogue or
population system, and without letting visual identity leak into gameplay
identity.

This sprint **extends** the character pipeline shipped by issue #21
(`AnimatedCharacter` + `CharacterAnimationController` + `characterMaterials` over
`assetVariants` + the `CHARACTER_ASSETS` manifest). It reinvents none of it. New
in #23: a reusable **population appearance registry**, three more recolorable
identity **axes** (skin / shoes / accessory) with a matching **accessory mesh**
on the rig, unique curated identities for the whole named cast, a bounded
**rigged ambient crowd**, an identity-aware **dialogue** header, and bounded
skinned-population **observability** for the perf report.

## The one rule (unchanged): gameplay never depends on the visual identity
A character's **gameplay/social/save id** (`npc_ravi_01`, `cit_office_worker`,
`player`) is the registry **key**. Appearance is **derived from** the id, never
the other way round. Nothing in gameplay, social, careers, housing, missions,
crime, streaming or save/load reads a colour. Every rigged character keeps the
procedural **primitive fallback**, so a missing / still-loading / broken GLB
changes only pixels — never behaviour or identity.

## Modules (`src/game/characters/`)
| File | Role |
|---|---|
| `populationAppearance.ts` | **NEW.** The one reusable identity registry: six curated palettes, `appearanceForSeed(seed)` / `appearanceForId(id)` (deterministic, reuses `routeRng`), `NAMED_IDENTITIES` (a curated unique look per named NPC), `populationAppearanceInfo()`. Produces DATA only. |
| `characterMaterials.ts` | Extended `CUSTOMIZABLE_SLOTS` to `shirt/pants/hair/skin/shoes/accessory`; `applyCharacterAppearance` recolors the three core axes always and skin/shoes/accessory only when specified (so an appearance that omits them stays byte-identical). |
| `characterTypes.ts` | `CharacterAppearance` gained optional `skinColor` / `shoesColor` / `accessoryColor` (additive; the legacy `accentColor` remains hair). |
| `characterRuntime.ts` | Added `characterPopulationStats()` — total / per-tier / model-vs-primitive counts for the perf report and the population cap test. |
| `NpcCharacter.tsx` | Named NPCs now draw their look from `appearanceForId(def.id)`. |
| `AnimatedCharacter.tsx` | Unchanged hub — reused as-is for the player, named NPCs, and the rigged ambient subset. |

Other touched files: `scripts/buildCharacterGlb.mjs` (the `accessory` scarf mesh + slot), `characterManifest.ts` (maps the `accessory` slot), `src/data/npcs.ts` (the whole cast on `blocklife_person`), `src/game/citizens/{ambientCitizenData,AmbientCitizens}.ts[x]` (the bounded rigged crowd), `src/app/DialoguePanel.tsx` + `src/styles/game.css` (the identity header), `src/game/test/gameTestApi.ts` (`getCharacterPopulationStats`).

## The registry (`populationAppearance.ts`)
Six independent, art-directed axes — **skin, hair, shirt, pants, shoes,
accessory** (~138k combinations). `appearanceForSeed` draws each axis
independently from one `createRng(seed)` stream, so two ids that collide on one
axis still differ on the others. `appearanceForId(id)` returns the curated
`NAMED_IDENTITIES[id]` for the named cast, else a stable seeded look
(`appearanceForSeed(hashString(id))`) for everyone else. Same id → same look,
every session — streaming, save/load and visual baselines stay stable.

## Named identities
All six residents (Ravi, Maya, Officer Kim, Coach Bruno, Leo, Nisha) ride the
rich in-repo **`blocklife_person`** rig (real Idle/Walk/Run + clean crossfades),
each with a curated unique identity that keeps their long-standing **signature
colour** as the shirt so the cast stays recognizable. This also retires the #21
Meshy **walk-only** limitation (Ravi/Maya were on a single-clip Meshy rig; the
two Meshy GLBs remain in-repo, reachable through the representative-player path).

## Representative player avatar path
The on-foot player already renders through `AnimatedCharacter` (tier `hero`,
`blocklife_person`) with the **wardrobe** appearance (`s.appearance`) — the
representative avatar path. The DEV/E2E `setPlayerCharacterAsset(id)` swaps the
player's body asset (e.g. to a Meshy humanoid) through the production path. The
player keeps full wardrobe control of shirt/pants/hair; the accessory scarf is a
neutral default (deliberately a **scarf, not a hat**, so it never hides the
customizable hair).

## The rigged ambient crowd (the #21 deferral)
Routing the whole ~90-strong crowd through skinning would blow the frame budget,
so a **bounded curated subset** is promoted instead:
`RIGGED_AMBIENT_IDS` = the standing/walking/queueing **core** citizens (the two
bench-sitters stay primitive — the rig has no sit clip), a hard-capped set
(`MAX_RIGGED_AMBIENT = 16`). A rigged citizen renders `AnimatedCharacter`
(tier `ambient`, scaled `0.82` to blend with the primitive crowd) as a child of
its existing group — **the group still owns position + heading + the pause-snap;
the rig is purely visual** and plays idle/walk from the citizen's own runtime via
`getNpcCharacterMotionState`. The ~50 procedural expansion citizens stay on the
cheap Cylinder+Sphere primitive.

**Distance LOD (the perf contract):** the skinned rig — 7 SkinnedMeshes, drawn
even off-camera (`frustumCulled=false`) — is mounted **only while the citizen's
sector is FULL-tier (near the player)**; a far citizen falls back to the cheap
primitive. `showRig` flips only on a `gateEntitySimulation` **tier crossing**
(never per frame, so no per-frame churn), and while stationary it never flips at
all (no thrash). `AnimatedCharacter` also takes an optional `active` predicate
that skips the mixer for a hidden actor. So a cross-district commute or any far
crowd pays **no** skinned-render cost — the on-screen skinned count stays a
handful. (This LOD is the fix for a real perf regression: without it, ~120
unculled skinned meshes rendered off-camera and slowed the headless sim enough to
overrun the yard-worker commute E2E — found by the full E2E, confirmed by an A/B
against master, then fixed here. CONVENTIONS #18.)

**Streaming-safe:** identity, position and schedule live in the citizen runtime
(ids + scalars), never in the rig — a rig that mounts/unmounts across a tier
crossing or a sector stream loses nothing. All traffic/occupancy/registry
publishing is unchanged — the rig draws the sim, it does not drive it.

## Dialogue presentation (`DialoguePanel.tsx`)
The one dialogue panel gained a header **identity avatar** (hair / skin / shirt
swatches + an accessory-tinted ring) built from `appearanceForId(dialogueNpcId)`
— the same colours the speaker wears in-world — plus a **relationship-tier
badge** for known contacts (reusing `getDerivedRelationship`). Presentation only;
no dialogue logic, templates or a second bubble system were touched.

## Performance (browser-validated)
`getCharacterPopulationStats()` reports the live skinned population; the
`asset-perf-round2` harness + the E2E cap assertion keep it honest. Measured in
the running app at the central spawn (player + 6 named + 11 rigged ambient = 18
skinned instances, full city): ~**89 fps / ~11 ms** frame, 312 draw calls. The
hard cap (`1 + 6 + MAX_RIGGED_AMBIENT`) means the crowd upgrade can never
silently regress the budget.

## Tests
- **Unit:** `populationAppearance.test.ts` (determinism, six axes, variety,
  per-NPC uniqueness, combination space); `characterMaterials.test.ts` (skin now
  isolated, an undeclared slot stays shared); `characterRuntime.test.ts`
  (`characterPopulationStats`); `ambientCitizens.test.tsx` (bounded, in-crowd,
  non-sitting rigged subset); `DialoguePanel.test.tsx` (identity avatar + tier
  badge).
- **E2E:** `character-identity-v1.spec.ts` — bounded population composition, the
  whole cast on the model with the accessory axis resolved, an ambient core
  citizen promoted to the rig, the player's full axis set, and the dialogue
  identity avatar + tier badge through the real UI.
- **Visual:** the character/social/city baselines regenerated for the new look,
  plus a dedicated `character-ambient-crowd-rigged` baseline.

## Limitations (honest)
- The ambient upgrade is a **curated subset**, not the whole crowd — a
  deliberate perf-bounded LOD, not full coverage. The expansion crowd stays
  primitive by design.
- The player's skin/shoes/accessory use rig defaults (no wardrobe control yet);
  the full axis palette is exercised by NPCs and the ambient crowd.
