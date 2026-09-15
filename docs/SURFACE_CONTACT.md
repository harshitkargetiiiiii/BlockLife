# Legacy sidewalk render height (issue #58)

Issue #58 found the player's shoes hidden while standing on the central inner sidewalk (recorded origin X −21.856, Z −18.344). The legacy central and district sidewalks were 0.12 m boxes centred at 0.06, so their visible top was **0.12**. Every walkable collider in the city has its top at **Y = 0**, and people and cars render from Y = 0. A shoe about 0.12 m tall standing on Y = 0 was therefore hidden inside the slab. The Gateway and compiled sectors do not have this outlier: they render sidewalks and plazas as planes at **0.03**.

This slice is a **bounded first candidate**, not visual acceptance.

## Policy: flat support, one sidewalk render layer

Physical support stays flat at Y = 0. The legacy sidewalks move onto the existing 0.03 layer, and the paint that sat on or beside them moves with them. Named heights live in [`src/game/world/surfaceHeights.ts`](../src/game/world/surfaceHeights.ts).

| Layer | Before | After | Source |
|---|---:|---:|---|
| Legacy sidewalk slab top (30 pieces: 10 in `Roads.tsx`, 20 in `Districts.tsx`) | 0.12 | **0.03** | same as Gateway / compiled sidewalks |
| Legacy slab thickness | 0.12 | 0.12 | unchanged; so the centre is **−0.03** (a centre of +0.03 would leave the top at 0.09) |
| Legacy curb-ramp pads (8, `Districts.tsx`) | 0.13 | **0.045** | the compiled crossing curb-ramp tier |
| Market curb-space stripes (3, `Districts.tsx`) | 0.065 | **0.032** | the residential curb-space stripe tier |

**Unchanged:**
- all slab X/Z footprints, connector gaps, materials and shadow flags, and every other mesh these renderers draw;
- roads (0.02), gutters, lane and crosswalk paint, plaza and seams, lawns, parking and aprons;
- the Gateway and compiled sectors, generated surface details and crossing art;
- all colliders, routes, anchors, doors and props;
- player, NPC, citizen and vehicle transforms; the wardrobe; every asset byte.

No actor Y offset, collider, step or suspension logic was added.

## What this does and does not change

- **Height mismatch:** it removes 9 cm of the mismatch. At the recorded origin roughly the top 0.089 m of a 0.12 m shoe is now above the pavement (arithmetic, not a render result). The lower ~0.03 m still lies behind the 0.03 layer, as it already did on Gateway and compiled sidewalks.
- **Curb rise:** the visible road-to-sidewalk rise drops from 10 cm to **1 cm**. Curb readability and edge shadows at the ordinary camera are not proven by this change.
- **Why not raise support instead:** a raised-sidewalk policy (support at 0.12) would need support sampling for kinematic people and cars, step traversal for the player capsule and car body, door and prop bases, and streaming floor seams. It is deliberately **not** attempted here.

## Gates

**`src/game/world/surfaceContact.test.tsx`** renders the real `Roads`, `Districts` and a compiled sector, and checks:
- **Named heights:** the slab top (not the centre) is 0.03.
- **Slabs:** all 30 have tops 0.03, bottoms −0.09, thickness 0.12 and shadow flags, with X/Z footprints equal to the **pre-change** capture.
- **Decals:** all 8 ramps and 3 stripes are at their exact positions and tiers.
- **Complete render trees:** mapping only those 41 heights back to their old values reproduces the pre-change mesh-dump digests of `Roads` (92 meshes) and `Districts` (201 meshes), captured at `c6d369bc` before this change.
- **Reported point:** the recorded origin lies on exactly the west inner strip.
- **Support:** the city ground collider still has its top at 0, and no sidewalk collider exists. These two are source-text checks.
- **Reference layer:** compiled sidewalk and plaza planes are still at 0.03, and the Gateway sidewalk planes at 0.03 (source text).

## Status

Source and CPU tests only; **no in-game evidence yet.**
- **Needs native judgement:** shoe visibility, curb readability, paint, shadow, prop and door contact, vehicle wheels, save/load and streaming contact.
- **A negative result is valid:** it must not be answered with character offsets, collision changes or weaker assertions.
