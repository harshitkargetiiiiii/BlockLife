# BlockLife Asset Style Bible & Harvest Acceptance Rubric (issue #25)

The single locked reference for every generated asset in the Visual Upgrade & Meshy Asset Harvest
sprint. Generation must not begin until this is committed. One coherent kit — not unrelated AI models.

## Locked visual language
- **Camera:** fixed orthographic isometric. Every asset must read at that distance.
- **Silhouette first:** forms distinguishable by shape alone; no fine geometry that vanishes at
  camera distance.
- **Palette:** warm, slightly exaggerated, muted saturation (matches existing tans / olives /
  terracotta / teal). One flat/near-flat color per material zone; no photoreal gradients.
- **Geometry:** clean, chamfer-light low-poly, manifold where possible. Budgets below.
- **Materials:** simple PBR, **≤3 zones/asset**, reusing named slots (`wall`, `trim`, `paint`) so
  one GLB tints many ways. **Neutral/light base albedo** on tint slots so runtime `map × color`
  never muddies. Night windows come from the repo's `glbWindowGlowMaterial` overlay — **no baked
  emission**.
- **Orientation & pivot:** canonical facing **+z** (front toward +z); **ground pivot** at base
  center (feet/base at y≈0). Authored to sit inside the existing authored footprint, never resizing
  it.
- **Lighting-ready:** neutral baked albedo, no baked lighting/shadows; must read under day, night,
  rain, fog, and building-occlusion fade.
- **IP-clean:** no logos, trademarks, readable brand names, copyrighted characters or real
  architecture. **Signage surfaces left blank/neutral** (the game adds text via overlays).

## Per-category budgets (asset-report gate: `scripts/assetReport.mjs`)
| Category | Max triangles | Max texture | Target GLB bytes |
|---|---|---|---|
| building (city) | 60,000 (target ≤12k) | 1024 | ≤0.8 MB |
| prop | 10,000 (target ≤4–6k) | 1024 (small props 512) | ≤0.4 MB |
| vehicle | 40,000 (target ≤12k) | 1024 | ≤0.7 MB |

Production payload cap ≤12 MB total / ≤24 texture objects. Assets that do not fit stay archival.

## Reference & generation workflow
One master style sheet (this doc) → per-asset original prompt + one Meshy-generated reference image
→ `image_to_3d` (textured) → `remesh` to budget → optional `retexture`. References are original or
Meshy-generated for BlockLife only; retained with prompt + provenance in `asset-harvest-log.md`.
All generations kept **private**.

## Stage A acceptance rubric (each accepted asset must satisfy ALL)
1. Clearly matches this low-poly visual language.
2. Clean silhouette at gameplay camera distance.
3. No branding, text artifacts, floating geometry, or broken surfaces.
4. Correct **+z** canonical facing.
5. Correct **ground pivot** (base at y≈0).
6. Production GLB within its assigned byte / triangle / material / texture limits.
7. No texture above the approved maximum (1024; small props 512).
8. Material slots recolor without mutating sibling instances.
9. Procedural fallback still renders on **disabled, missing, loading, and failed** GLB paths.
10. No collision / routing / interaction / occlusion / gameplay-coordinate change.
11. No unexplained performance-cap breach vs the pinned baseline.
12. A visible improvement in controlled before/after screenshots (identical camera/time/weather/sector).

If an asset cannot pass within its authorized attempts (≤2 per asset, second attempt only as a
documented deliberate decision), keep its procedural fallback, document the rejection, and stop
Stage A honestly.

## Stage A scope (this authorization only)
Exactly two calibration assets: `arch_residential_house_01` (building) and `prop_job_kiosk_01`
(small prop). ≤158 expiring credits, floor balance 2,674, permanent credits not authorized. No
Stage B asset, no optional bank, no freight/rollout/characters/interiors. No merge.
