# Asset Harvest Provenance Ledger (issue #25)

Committed **text-only** provenance for every Meshy generation in the Visual Upgrade & Meshy Asset
Harvest sprint. Raw candidates, reference images, and dashboard/plan screenshots are kept **private**
(in Meshy + the gitignored `asset-archive/`), never committed. Only accepted, optimized production
GLBs enter `public/assets/models/`.

Per task: semantic id · prompt (summary) · reference-image task id · model task/model id · date ·
quoted debit · actual debit · plan/terms URL · privacy · status (accepted/rejected + reason) ·
optimization · final repo path.

## Stage A (calibration) — credit envelope ≤158, floor balance 2,674

Balance ledger (recorded before/after each paid op):

| # | Operation | Asset | Quoted | Before | After | Actual debit | Cumulative | Task/Model ID | Status |
|---|-----------|-------|-------:|-------:|------:|-------------:|-----------:|---------------|--------|
| — | (starting balance) | — | — | 2832 | — | — | 0 | — | — |
| 1 | text_to_image (reference) | arch_residential_house_01 | | | | | | | pending |
| 2 | text_to_image (reference) | prop_job_kiosk_01 | | | | | | | pending |
| 3 | image_to_3d (attempt 1) | arch_residential_house_01 | | | | | | | pending |
| 4 | image_to_3d (attempt 1) | prop_job_kiosk_01 | | | | | | | pending |
| 5 | image_to_3d (attempt 2, optional) | arch_residential_house_01 | | | | | | | conditional |
| 6 | image_to_3d (attempt 2, optional) | prop_job_kiosk_01 | | | | | | | conditional |
| 7 | remesh (selected final) | arch_residential_house_01 | | | | | | | pending |
| 8 | remesh (selected final) | prop_job_kiosk_01 | | | | | | | pending |
| 9 | retexture (if necessary) | arch_residential_house_01 | | | | | | | conditional |

### arch_residential_house_01
- **Semantic id:** `arch_residential_house_01`
- **Intended placement:** reusable residential-house archetype ([5,4,5]); Stage A calibration =
  central `building_house_r1` at [-14,-54] (visualAssetId projection).
- **Prompt:** _(recorded at generation)_
- **Reference-image task id / model task id:** _(recorded at generation)_
- **Plan/terms URL:** https://www.meshy.ai/legal (Premium monthly, captured Stage A)
- **Privacy:** private
- **Status:** pending
- **Optimization:** _(remesh/texture 1K via scripts/optimizeGlb.mjs — recorded on accept)_
- **Final repo path:** `public/assets/models/city/arch_residential_house_01.glb` (only if accepted)

### prop_job_kiosk_01
- **Semantic id:** `prop_job_kiosk_01` (existing disabled manifest slot; fallback `JobKioskMesh`)
- **Intended placement:** central Job Board kiosk singleton (`JOB_KIOSK`, cityLayout.ts).
- **Prompt:** _(recorded at generation)_
- **Reference-image task id / model task id:** _(recorded at generation)_
- **Plan/terms URL:** https://www.meshy.ai/legal (Premium monthly, captured Stage A)
- **Privacy:** private
- **Status:** pending
- **Optimization:** _(recorded on accept)_
- **Final repo path:** `public/assets/models/props/prop_job_kiosk_01.glb` (only if accepted)
