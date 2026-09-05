# Issue #47 Wave 4 — visual review evidence

Everything a reviewer needs to check the baseline work on
`feat/issue-47-asset-integration-wave-4`, in the order it was actually done.

| File | What it holds |
| ---- | ------------- |
| [`inventory.md`](inventory.md) | Both complete `--no-update` inventories over all 367 visual tests — before any baseline was touched, and again after the rig-fit fix — and how each reconciles. |
| [`adjudication.md`](adjudication.md) | Per-image verdicts for every existing baseline this branch changes — 16 adopted, 2 held back, 0 rejected-without-replacement. |
| [`flagged-customization-shots.md`](flagged-customization-shots.md) | The two baselines that were **refused**, with the full bisect that attributes them. **Read this one.** |
| [`new-baselines.md`](new-baselines.md) | The 75 new `wave4-*` baselines: what each group proves and the inspection pass over them. |
| [`e2e.md`](e2e.md) | The one real E2E regression this wave caused (the accessory-slot contract), how it was fixed without weakening it, and why the remaining sweep failures are unattributed. |
| [`new-sheets/`](new-sheets/) | Contact sheets of all 75 new baselines, 15 per sheet, as reviewed. |
| [`sheets/`](sheets/) | The committed `expected \| actual \| diff` contact sheets the adjudication was done from. |

## The short version

- **367** visual tests defined. The first complete no-update inventory found **96** failures — **75**
  new Wave 4 baselines (missing, not changed) and **21** existing mismatches.
- **3** of the 21 were a real determinism defect (a screenshot taken of a still-falling car), fixed
  **in code** rather than adjudicated away — they now pass against their untouched baselines.
- Capturing the new baselines then exposed a **defect in this wave** (every named resident at ~58 %
  of the player's height). It was fixed, gated, and all 75 were recaptured.
- The complete inventory was re-run after that fix: **367 defined / 363 passed / 4 failed / 0
  skipped**, counts reconciled, all 25 specs.
- Final: **16 existing baselines modified**, **75 new**, **2 refused and left failing**, **1**
  pre-existing flake left alone. **0** bulk-updated.

## Three things to look at first

**1. The new baselines caught a real defect in this wave, and it was fixed rather than adopted.**
The first capture of the 75 new images showed every named resident at **~58 % of the player's
height**. The approved bodies are authored at real human height (1.70–1.84 m); `blocklife_person`,
which those NPCs rendered as before this wave and which the player still renders as, measures
**2.930 m**. The whole structural gate passed while this was true — canonical 24-bone rig, matching
hierarchy signature, valid skin weights, grounded base, measured height equal to declared height —
because every one of those checks asks whether the body is internally consistent, and none compares
it to what it replaces. It was caught by *looking at* `wave4-player-beside-ravi`, then measured: a
**1.674x** rendered silhouette ratio against **1.665** predicted from the two bounding boxes. Each
body is now fitted (`scale = 2.930 / measured`) so it renders at exactly its pre-wave height, and
that ratio is gated per body in `wave4Contract.test.ts`. The first 75 baselines were discarded and
recaptured. See CONVENTIONS #42 and `docs/ASSET_INTEGRATION_WAVE_4.md` §2.

**2. Two customization baselines are knowingly left failing.** `painted-sports` and
`wheels-offroad` render the Wave-1 sports GLB on this branch instead of the paintable procedural
shell, which erases the very evidence they are named to prove. They were not adopted, so they fail.
The bisect that attributes this — including the merge base passing even with 15 extra seconds, and
the branch passing again with the four parked bodies unmounted — is in
[`flagged-customization-shots.md`](flagged-customization-shots.md).

**3. An earlier attribution run in this branch's history was invalid** and its conclusion was
retracted. A leftover vite dev server from this worktree was still bound to `:5199`, and
`playwright.config.ts` sets `reuseExistingServer: !CI`, so runs launched from the merge-base
worktree were served *this branch's* application code. Every base measurement quoted in these
documents was retaken with Playwright owning its own dev server. The lesson is written up as a
convention so it cannot be repeated silently.
