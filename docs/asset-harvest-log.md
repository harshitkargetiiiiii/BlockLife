# Asset Harvest Provenance Ledger (issue #25)

Committed **text-only** provenance for every Meshy generation in the Visual Upgrade & Meshy
Asset Harvest sprint. Raw candidates, reference images, and dashboard/plan screenshots are kept
**private** (in Meshy + the gitignored `asset-archive/`), never committed. Only accepted,
optimized production GLBs enter `public/assets/models/`.

## Stage A (calibration) — COMPLETE ✅

Account: Meshy Premium monthly (plan terms: https://www.meshy.ai/legal). Envelope ≤158 expiring
credits, floor balance 2674, permanent credits not authorized. **Actual total spend: 78.**
No second attempts (both first 3D attempts accepted). No Meshy remesh/retexture: lowpoly
image_to_3d already yielded in-budget triangles; textures optimized locally 2K→1K via
`scripts/optimizeGlb.mjs` (the same path used for `blocklife_apartment_hq_01`).

### Balance ledger (recorded before/after each paid op)

| # | Operation | Model | Asset | Quoted | Before | After | Debit | Cumulative | Task ID |
|---|-----------|-------|-------|-------:|-------:|------:|------:|-----------:|---------|
| 0 | (start) | — | — | — | — | 2832 | — | 0 | — |
| 1 | text_to_image | nano-banana-pro | arch_residential_house_01 (ref) | 9 | 2832 | 2823 | 9 | 9 | 01a02116-6ed7-7ff3-a24b-b03f2475c417 |
| 2 | text_to_image | nano-banana-pro | prop_job_kiosk_01 (ref) | 9 | 2823 | 2814 | 9 | 18 | 01a02117-3b7a-7de5-a0de-9984c4f02fa5 |
| 3 | image_to_3d | meshy-6 (latest), lowpoly | arch_residential_house_01 | 30 | 2814 | 2784 | 30 | 48 | 01a02118-c472-71e9-b5e6-4f0808c5ef30 |
| 4 | image_to_3d | meshy-6 (latest), lowpoly | prop_job_kiosk_01 | 30 | 2784 | 2754 | 30 | 78 | 01a0211e-1041-71bc-af99-123cb189d2b6 |

**Ending balance 2754** (78 spent, 80 of the 158 envelope unused; floor 2674 respected; permanent
credits untouched). Note: the image_to_3d submission price was **30** (not the schema's "20"),
matching the conservative p_gen=30 scenario the 158 envelope was sized for.

### arch_residential_house_01 — ACCEPTED
- **Prompt:** "A single small stylized low-poly two-story suburban house, three-quarter isometric
  view, gently sloped roof, a simple front door and a few square windows, warm muted colors
  (soft terracotta walls, cream trim, warm brown roof), clean flat low-poly geometry with soft
  chamfered edges, no text no logos no signage, neutral blank surfaces, cohesive cozy game art
  style, a single centered object on a plain light gray background, soft even studio lighting"
- **Reference-image task:** 01a02116-6ed7-7ff3-a24b-b03f2475c417 (text-to-image, nano-banana-pro)
- **Model task:** 01a02118-c472-71e9-b5e6-4f0808c5ef30 (image-to-3d, meshy-6 latest, lowpoly, textured)
- **Metrics:** 7936 tris, 1024 texture, 455.8 KB (city budget 60000 tris / 1024 tex — PASS)
- **Optimization:** `scripts/optimizeGlb.mjs` texture 2048→1024 (2.18 MB → 0.46 MB). No Meshy remesh.
- **Calibration:** uniform scale 2.95 fills the [5,4,5] template footprint; center-origin model →
  positionOffset [0, 2.81, 0] grounds the base. Facing south (+z, door side).
- **Privacy:** private. **Plan/terms:** https://www.meshy.ai/legal (Premium, 2026-08-20).
- **Final repo path:** `public/assets/models/city/arch_residential_house_01.glb`

### prop_job_kiosk_01 — ACCEPTED
- **Prompt:** "A small stylized low-poly information kiosk / job notice board, three-quarter
  isometric view, a slim upright rectangular board on a small base with a little canopy roof on
  top, a few blank empty poster panels on the front (absolutely no text, no logos, no writing),
  warm muted teal and warm wood colors, clean flat low-poly geometry with soft chamfered edges,
  neutral blank surfaces, cohesive cozy game art style, a single centered object on a plain light
  gray background, soft even studio lighting"
- **Reference-image task:** 01a02117-3b7a-7de5-a0de-9984c4f02fa5 (text-to-image, nano-banana-pro)
- **Model task:** 01a0211e-1041-71bc-af99-123cb189d2b6 (image-to-3d, meshy-6 latest, lowpoly, textured)
- **Metrics:** 4703 tris, 1024 texture, 445.9 KB (prop budget 10000 tris / 1024 tex — PASS)
- **Optimization:** `scripts/optimizeGlb.mjs` texture 2048→1024 (2.94 MB → 0.45 MB). No Meshy remesh.
- **Calibration:** uniform scale 1.3 + positionOffset [0, 1.24, 0] fit the ~1.7×2.2×0.5 kiosk
  footprint (center-origin model grounded). Existing `JobKioskMesh` fallback + CityColliders collider.
- **Privacy:** private. **Plan/terms:** https://www.meshy.ai/legal (Premium, 2026-08-20).
- **Final repo path:** `public/assets/models/props/prop_job_kiosk_01.glb`

No rejected candidates (both first attempts accepted). Rejected candidates, raw un-optimized GLBs,
and reference images remain private in `asset-archive/` (gitignored) + the Meshy account.
