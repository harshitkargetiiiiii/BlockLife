# Issue #46 — how to review the baseline migration

This package exists so the migration can be checked **from the pull request**, without cloning the
branch or re-running the visual suite.

Start here: the counts at the bottom reconcile to the branch's own `git status` (92 modified + 9
added = 101 baseline files), every one of the 92 has a labelled `expected | actual | diff` row in
[`sheets/`](sheets/), and [`adjudication.md`](adjudication.md) gives the reason behind each
verdict. Nothing was bulk-updated and nothing was accepted that this issue should not bless.

## `expected | actual | diff` for every modified baseline

[`sheets/`](sheets/) holds ten paginated contact sheets covering **all 92 existing baselines this
branch modifies** — not a sample. Each row is one adjudicated image: the committed baseline as it
was, the capture that replaced it, a red-overlay diff, and a caption with the snapshot name, its
spec, its measured diff in pixels and ratio, and its verdict.

The 92 split into two kinds, and the sheets keep them apart because they were judged differently:

- **89 accepted as captured** (sheets 1–9). These FAILED the no-update sweep — Playwright produced
  the diff — and each was accepted because the change is a merged, approved asset body.
- **3 rejected-and-reframed** (sheet 10). These PASSED the sweep, so there was no mismatch to
  adjudicate: they were *deliberately* replaced because review rejected the first attempt at the
  §3 fade evidence as unjudgeable. Playwright never produced a diff for them, so the overlay on
  sheet 10 is computed the same way (changed pixels red over a whitened original) and labelled as
  computed.

| sheet | rows | from … to |
| --- | --- | --- |
| `sheet-01.jpg` | 10 | `asset-building-apartment` … `asset-vehicle-van` |
| `sheet-02.jpg` | 10 | `character-ambient-crowd-rigged` … `city-morning` |
| `sheet-03.jpg` | 10 | `city-night` … `crime-cruiser-closeup` |
| `sheet-04.jpg` | 10 | `crime-hud-l1` … `economy-storage-transfer` |
| `sheet-05.jpg` | 10 | `economy-wardrobe-locked` … `driving-compact` |
| `sheet-06.jpg` | 10 | `driving-scooter` … `wave0-candidate-kabir-walk` |
| `sheet-07.jpg` | 10 | `wave0-candidate-ravi-close` … `wave0-sedan-driving-seat` |
| `sheet-08.jpg` | 10 | `wave1-scooter-active-front` … `wave2-streetlight-context-central` |
| `sheet-09.jpg` | 9 | `wave2-streetlight-context-east` … `wave2-trashbin-context-east` |
| `sheet-10.jpg` | 3 | the **rejected-and-reframed** fade baselines (`wave3-apartment/hotel/townhomes-occlusion-fade`) |

Rows are at a third of native width (400 × 225 from 1280 × 720), which is legible at GitHub's
full-width image view and keeps the whole package to ~3 MB. `sheets/sheets.json` is the machine-
readable index. [`adjudication.md`](adjudication.md) is the matching ledger — one row per image,
with the reason behind each verdict.

**Red = changed.** The finding to check on sheets 1–9, row by row, is that in every one of them the
**subject of the test is grey** and the red is a merged, approved asset body (Waves 0–3), that
body's label height, or — in exactly one row, `character-player-beside-kim` — the occlusion fade
this issue corrected. Sheet 10 is the opposite by design: those three are wholesale reframes, so
most of the frame changes.

For a pixel-exact look at any single image, the PR's own Files-changed view renders the committed
baseline against the migrated one with a slider; every migrated image is a changed PNG under
`tests/visual/*-snapshots/`.

## The occlusion-fade A/B pairs (§3)

These are not in the sheets, because they were re-captured wholesale and most have no prior image
to diff against. They are committed as ordinary baselines and read directly in the PR:
`tests/visual/wave3-asset-visuals.spec.ts-snapshots/wave3-{body}-occlusion-fade.png` and
`…-occlusion-control.png`.

Both frames of a pair are taken from **one paused instant** — same clock, HUD, camera, player and
ambient poses — with only `setOcclusionEnabled` changed between the shutters, and the test asserts
that. Start with the apartment pair: the control has the player completely hidden behind an opaque
facade (only the name label and the interact prompt betray them) and the faded frame shows them
through the body.

Three of the six bodies can show a true reveal and three cannot, for a reason that is derived
rather than observed. See
[`../../VISUAL_QUALITY_AND_BASELINE_INTEGRITY.md`](../../VISUAL_QUALITY_AND_BASELINE_INTEGRITY.md)
§3 for the derivation and the over-fade limitation it exposes.

## Counts

| | |
| --- | --- |
| Mismatches found — full no-update sweep at the merge base, 289 cases | **88** |
| …plus one introduced by the §3 occluder fix and adjudicated | 1 |
| **Existing baselines adjudicated and modified** | **92** |
| &nbsp;&nbsp;• accepted as captured (had a real mismatch) | 89 |
| &nbsp;&nbsp;• rejected-and-reframed (passed, deliberately re-shot after review) | 3 |
| **New baselines this issue creates** | **9** |
| &nbsp;&nbsp;• 6 `-occlusion-control` (the A/B control half, all six bodies) | |
| &nbsp;&nbsp;• 3 `-occlusion-fade` for bodies that had none (`shop`, `house`, `garage`) | |
| **Rejected with no replacement** (change refused, cause fixed instead) | **0** |
| **Baseline files touched** | 92 modified + 9 added = **101** |

Every one of the 101 is covered: the 92 modified appear as a row on sheets 1–10, and the 9 added
are committed baselines readable directly in the PR (they have no prior image by definition).
