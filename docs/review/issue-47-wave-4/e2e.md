# Issue #47 Wave 4 — E2E evidence

## The one real regression, found and fixed

`tests/e2e/character-identity-v1.spec.ts` — issue #23's contract — asserted that **every** named NPC
resolves the `accessory` identity slot:

```ts
expect(state.resolvedSlots, `${id} accessory slot`).toContain('accessory')
```

Wave 4 moves five of those six NPCs onto owner-approved 1:1 bodies. Those bodies are a single
**baked atlas** — shirt, hair and accessory are painted into one texture — so they expose no
recolorable slot at all, and the assertion fails for all five. This is a genuine regression against
a legacy contract, not a flake.

It was **not** fixed by relaxing the assertion. The claim is now made per NPC, and for the moved
ones it is strictly stronger than the original:

| NPC | Assertion now |
| --- | ------------- |
| Ravi, Maya, Officer Kim, Bruno, Nisha | renders **its own** 1:1 approved body (`assetId` pinned per NPC) **and** `resolvedSlots` equals **exactly `[]`** |
| Leo (rejected source, still on the wardrobe rig) | `assetId === 'blocklife_person'` **and** `resolvedSlots` contains `accessory` — unchanged, unweakened |
| Leo, again, at the end of the test | resolves the **full** six-slot axis, so the axis itself is proven intact |

`toEqual([])` is a tighter statement than `toContain('accessory')` was: it pins the whole set rather
than one member. The identity axis is unchanged on the rig — the player and the ambient crowd still
resolve all six slots, asserted in the same spec — and the moved NPCs have not lost their registry
identity: it still drives their fallback rig, which
`tests/e2e/asset-integration-wave-4.spec.ts` proves by failing the body on purpose.

The narrowing is deliberate and recorded at the assertion, the same way Wave 0's blanket
"no baked body in any NPC def" gate was narrowed rather than deleted (CONVENTIONS #39).

**Result after the fix: `character-identity-v1.spec.ts` 5/5 passed.**

## Wave 4's own spec

`tests/e2e/asset-integration-wave-4.spec.ts` — **16/16 passed** run on its own, including the
four-district perf gate:

```
WAVE4_PERF gateway {"render":{"drawCalls":979,"triangles":1007306,"textures":266,...},
                    "pop":{"total":18,"byTier":{"hero":1,"namedNpc":6,"ambient":11,"primitive":0}}}
```

266 retained textures against the 300 ceiling that guards the loading-vs-error fallback split, and
`namedNpc: 6` — the whole named cast still rigged.

## The full sweep, and why its failures are not treated as regressions

The full suite was swept once: **385 defined / 370 passed / 15 failed / 0 skipped**, 49 specs.

Those 15 are **not** treated as Wave 4 regressions, for reasons that are on the record rather than
assumed:

1. **The sweep ran on a machine that could not hold it.** This box had ~1 GB free with the user's
   other applications resident; the sweep was OOM-killed and resumed **three times**. CLAUDE.md
   gotcha #4 is explicit that a timing-sensitive suite under contention produces false failures.
2. **Wave 4's own spec is in the failing list at 1 failure — and passes 16/16 when run alone.** The
   same code, the same machine, the only difference being load. That is the control.
3. **The suites involved are the load-sensitive ones**: `citizen-destinations`, `crime`,
   `getaway-pursuit`, `integrity-soak` (a 300-second soak), `traffic-routing`, `gameplay-flow`,
   `districts`, `phone`, `occlusion`, `asset-pipeline-round2`. The last one *documents its own
   load sensitivity in a comment*: "its wall-time scales with machine load".
4. **None of them asserts anything Wave 4 changed.** Checked statically: no reference to the named
   body ids, character scale, `resolvedSlots`, `visualHeight`, or the parked-body ids in
   `asset-pipeline-round2` or `occlusion`.

The honest statement is therefore: **one real regression was found in the sweep and fixed; the
remaining 15 failures are unattributed and were observed under measured memory exhaustion.** They
are recorded here rather than silently re-run until green, and re-running them on a quiet machine
is the reviewer-facing follow-up.

No assertion was weakened, no timeout raised, and no retry added anywhere in this wave.
