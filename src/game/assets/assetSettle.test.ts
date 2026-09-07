import { describe, expect, it } from 'vitest'
import {
  ASSET_SETTLE_QUIET_MS,
  assetGraphPending,
  isAssetGraphSettled,
  isSceneReady,
  unresolvedByAsset,
  unresolvedInstances,
  type AssetGraphCounters,
} from './assetSettle'

/**
 * Issue #46 §4 — the settle gate, as arithmetic.
 *
 * The regression this file exists for is the one a code review caught after the first
 * implementation: an error boundary that incremented `failed` and never released it on unmount
 * turned the counter into a tally of failures ever seen rather than a census of failed
 * instances. The scenario below is the exact sequence — a failure, its unmount, then a fresh
 * SLOW remount — and it is nasty precisely because a slow load is the one case where quiescence
 * cannot help: nothing moves the mount graph while the network is working.
 */
const graph = (o: Partial<AssetGraphCounters>): AssetGraphCounters => {
  const g = { expected: 0, active: 0, failed: 0, epoch: 1, changedAt: 0, ...o }
  // Unless a case says otherwise, every unresolved instance belongs to an id that has NOT failed
  // — i.e. the strict reading. Cases about unreachable files set `unresolved` explicitly.
  return { ...g, unresolved: o.unresolved ?? Math.max(0, g.expected - g.active - g.failed) }
}
const QUIET = ASSET_SETTLE_QUIET_MS

describe('asset settle gate', () => {
  it('is never true before anything has mounted, no matter how long it has been quiet', () => {
    // The boot vacuity: 0 >= 0 is trivially "settled" on an empty graph.
    expect(isAssetGraphSettled(graph({ epoch: 0 }), 10_000)).toBe(false)
    expect(isAssetGraphSettled(graph({ epoch: 0, expected: 0 }), 1e9)).toBe(false)
  })

  it('a previously-mounted but now EMPTY graph never settles, however long it stays quiet', () => {
    // The third disguise of the same vacuity. After a full teardown — entering an interior, a
    // reset, the world unmounting — every counter is zero while `epoch` still remembers that
    // something once mounted. `unresolved` is 0, `pending` is 0, and the quiet window elapses,
    // so every other clause is satisfied by a scene that does not exist. "Nothing is mounted"
    // must never read as "everything is ready".
    const emptyAfterTeardown = graph({ expected: 0, active: 0, failed: 0, epoch: 77, changedAt: 1_000 })
    expect(emptyAfterTeardown.unresolved).toBe(0)
    expect(assetGraphPending(emptyAfterTeardown)).toBe(0)
    expect(isAssetGraphSettled(emptyAfterTeardown, 1_000 + QUIET), 'just past the window').toBe(false)
    expect(isAssetGraphSettled(emptyAfterTeardown, 1_000 + QUIET * 1000), 'and long after it').toBe(false)

    // It only settles once a graph is actually mounted and committed again.
    const remounted = graph({ expected: 5, active: 5, failed: 0, epoch: 90, changedAt: 50_000 })
    expect(isAssetGraphSettled(remounted, 50_000 + QUIET)).toBe(true)
  })

  it('the scene-ready gate inherits that: an empty graph is never ready either', () => {
    const empty = graph({ expected: 0, epoch: 77, changedAt: 0 })
    expect(isSceneReady(empty, { glbActive: [], glbFailed: [] }, QUIET * 1000, [])).toBe(false)
    // …not even when the id it is asked for is somehow still recorded as active.
    expect(
      isSceneReady(empty, { glbActive: ['building_office_01'], glbFailed: [] }, QUIET * 1000, ['building_office_01']),
    ).toBe(false)
  })

  it('is false while anything is still loading', () => {
    expect(isAssetGraphSettled(graph({ expected: 3, active: 1 }), 10_000)).toBe(false)
    expect(assetGraphPending(graph({ expected: 3, active: 1 }))).toBe(2)
  })

  it('is false until the graph has held still for the quiet window', () => {
    const g = graph({ expected: 2, active: 2, changedAt: 1_000 })
    expect(isAssetGraphSettled(g, 1_000 + QUIET - 1)).toBe(false)
    expect(isAssetGraphSettled(g, 1_000 + QUIET)).toBe(true)
  })

  it('a NEGATIVE pending is a broken census, not a settled scene', () => {
    // More instances committed/failed than are mounted. That cannot happen if the counters are
    // kept honestly, so it means the accounting has drifted — which is exactly the shape the
    // leaked `failed` produced. `pending <= 0` called this settled and let the gate open on a
    // half-built scene; the guard is `assetGraphPending(c) >= 0`, so a negative census fails
    // loudly. (It is deliberately NOT `=== 0`: the per-asset `unresolved` clause is what proves
    // nothing is in flight, and a positive raw pending is legitimate once an unreachable id has
    // been excluded there — see the aborted-file case below.)
    const corrupt = graph({ expected: 1, active: 0, failed: 2, epoch: 5, changedAt: 0 })
    expect(assetGraphPending(corrupt)).toBe(-1)
    expect(isAssetGraphSettled(corrupt, QUIET * 100), 'must refuse a corrupt census').toBe(false)
    // The realistic version: one instance in flight while a stale failure hides it.
    const leaked = graph({ expected: 1, active: 0, failed: 1, epoch: 6, changedAt: 0 })
    expect(assetGraphPending(leaked)).toBe(0)
    // …which is why the leak had to be fixed at the source: with correct accounting the same
    // moment reads pending 1 and stays unsettled.
    const honest = graph({ expected: 1, active: 0, failed: 0, epoch: 6, changedAt: 0 })
    expect(assetGraphPending(honest)).toBe(1)
    expect(isAssetGraphSettled(honest, QUIET * 100)).toBe(false)
  })

  it('a remount trough cannot pass: the counters read 0 but the graph just moved', () => {
    // resetGame() tears every instance down. expected/active/failed all hit 0 — which the old
    // `active + failed >= expected` comparison called settled — but the teardown IS a change.
    const trough = graph({ expected: 0, active: 0, failed: 0, epoch: 42, changedAt: 5_000 })
    expect(isAssetGraphSettled(trough, 5_000 + 10)).toBe(false)
  })

  it('FAIL -> UNMOUNT -> SLOW REMOUNT cannot settle early (the leaked-failure regression)', () => {
    // 1. One instance mounts and fails.
    let t = 1_000
    const failed = graph({ expected: 1, active: 0, failed: 1, epoch: 2, changedAt: t })
    expect(isAssetGraphSettled(failed, t + QUIET)).toBe(true) // correctly settled: it resolved

    // 2. It unmounts. With correct lifetime accounting BOTH counters return to 0; the bug left
    //    `failed: 1` behind.
    t = 2_000
    const afterUnmount = graph({ expected: 0, active: 0, failed: 0, epoch: 3, changedAt: t })
    const buggyAfterUnmount = graph({ expected: 0, active: 0, failed: 1, epoch: 3, changedAt: t })

    // 3. A fresh instance mounts and starts a SLOW load. Nothing else touches the graph while
    //    the file is in flight, so the quiet window elapses on a scene that is still loading.
    t = 3_000
    // Rebuilt through `graph`, never spread over a built object: `unresolved` is DERIVED, and a
    // spread would carry the previous value while `expected` changed underneath it.
    const loading = graph({ ...afterUnmount, expected: 1, epoch: 4, changedAt: t, unresolved: undefined })
    const buggyLoading = graph({ ...buggyAfterUnmount, expected: 1, epoch: 4, changedAt: t, unresolved: undefined })

    const wellPastQuiet = t + QUIET * 10
    expect(assetGraphPending(loading), 'one instance genuinely in flight').toBe(1)
    expect(isAssetGraphSettled(loading, wellPastQuiet), 'must NOT settle while loading').toBe(false)

    // This is what the leak did, and why the quiet window alone was not enough.
    expect(assetGraphPending(buggyLoading), 'the leak hides the in-flight instance').toBe(0)
    expect(isAssetGraphSettled(buggyLoading, wellPastQuiet), 'the leak opened the gate early').toBe(true)

    // 4. The load commits; now — and only now — the scene is settled.
    t = 9_000
    const committed = graph({ ...loading, active: 1, epoch: 5, changedAt: t, unresolved: undefined })
    expect(isAssetGraphSettled(committed, t + QUIET - 1)).toBe(false)
    expect(isAssetGraphSettled(committed, t + QUIET)).toBe(true)
  })

  it('a second failure while one is already failed still leaves nothing pending', () => {
    const g = graph({ expected: 2, active: 0, failed: 2, epoch: 7, changedAt: 100 })
    expect(assetGraphPending(g)).toBe(0)
    expect(isAssetGraphSettled(g, 100 + QUIET)).toBe(true)
  })
})

describe('unresolved instances (what readiness actually waits on)', () => {
  const per = (m: Record<string, [number, number, number]>) =>
    Object.entries(m).map(([id, [expected, active, failed]]) => [id, { expected, active, failed }] as const)

  it('counts instances still in flight for ids whose file is fine', () => {
    expect(unresolvedInstances(per({ a: [4, 4, 0] }))).toBe(0)
    expect(unresolvedInstances(per({ a: [4, 1, 0] })), 'three still loading').toBe(3)
    expect(unresolvedInstances(per({ a: [4, 2, 0], b: [2, 0, 0] }))).toBe(4)
  })

  it('an id whose file is UNREACHABLE is resolved, including its permanently-suspended instances', () => {
    // Measured against a deliberately-aborted file: 22 of 24 trash bins threw and were counted
    // failed; 2 stayed suspended forever because drei never re-rendered them to throw. Suspense
    // shows those 2 the SAME procedural fallback their failed siblings show, and the mount graph
    // then sat still for 37 s. They are not loading, and readiness must not wait on them.
    expect(unresolvedInstances(per({ prop_trash_bin_01: [24, 0, 22] }))).toBe(0)
    const g = graph({ expected: 24, active: 0, failed: 22, epoch: 9, changedAt: 0, unresolved: 0 })
    expect(isAssetGraphSettled(g, QUIET)).toBe(true)
  })

  it('…and that does NOT re-open the leaked-failure hole', () => {
    // The regression it superficially resembles: a stale failure from an UNMOUNTED instance
    // hiding a genuinely loading new one. Those counts are released on unmount, so the id has
    // failed: 0 — and its pending instance still blocks.
    expect(unresolvedInstances(per({ building_office_01: [1, 0, 0] })), 'loading, nothing failed').toBe(1)
    const g = graph({ expected: 1, active: 0, failed: 0, epoch: 4, changedAt: 0 })
    expect(g.unresolved).toBe(1)
    expect(isAssetGraphSettled(g, QUIET * 100)).toBe(false)
  })

  it('one unreachable id does not excuse a different id that is still loading', () => {
    expect(unresolvedInstances(per({ prop_trash_bin_01: [24, 0, 22], building_office_01: [1, 0, 0] }))).toBe(1)
  })

  describe('unresolvedByAsset — the per-id breakdown a timed-out boot reports', () => {
    it('names only the ids readiness is actually waiting on', () => {
      expect(unresolvedByAsset(per({ a: [4, 4, 0] })), 'nothing in flight').toEqual([])
      expect(unresolvedByAsset(per({ a: [4, 1, 0] }))).toEqual([
        { id: 'a', unresolved: 3, expected: 4, active: 1, failed: 0 },
      ])
    })

    it('excludes an unreachable id, exactly as the predicate does', () => {
      // The 2 permanently-suspended trash bins are NOT what a boot is waiting for, so a timeout
      // report that named them would send a reader after the wrong body.
      expect(unresolvedByAsset(per({ prop_trash_bin_01: [24, 0, 22] }))).toEqual([])
      expect(unresolvedByAsset(per({ prop_trash_bin_01: [24, 0, 22], building_office_01: [1, 0, 0] }))).toEqual([
        { id: 'building_office_01', unresolved: 1, expected: 1, active: 0, failed: 0 },
      ])
    })

    it('orders by how much each id is holding up, then by id', () => {
      const out = unresolvedByAsset(per({ b: [2, 0, 0], a: [9, 0, 0], c: [2, 0, 0] }))
      expect(out.map((u) => u.id)).toEqual(['a', 'b', 'c'])
      expect(out[0].unresolved).toBe(9)
    })

    it('ALWAYS sums to unresolvedInstances, so the diagnostic cannot drift from the predicate', () => {
      // The whole point of the report is that it explains the number readiness blocks on. If these
      // two ever disagree, the report is pointing somewhere the predicate is not looking.
      const cases: Record<string, [number, number, number]>[] = [
        { a: [4, 4, 0] },
        { a: [4, 1, 0] },
        { a: [4, 2, 0], b: [2, 0, 0] },
        { prop_trash_bin_01: [24, 0, 22] },
        { prop_trash_bin_01: [24, 0, 22], building_office_01: [1, 0, 0] },
        { a: [1, 0, 2] }, // corrupt: more failed than expected
        { a: [0, 0, 0] },
        { a: [3, 1, 1], b: [5, 5, 0], c: [2, 0, 0] },
      ]
      for (const m of cases) {
        const sum = unresolvedByAsset(per(m)).reduce((n, u) => n + u.unresolved, 0)
        expect(sum, JSON.stringify(m)).toBe(unresolvedInstances(per(m)))
      }
    })
  })

  it('still refuses a corrupt census even when nothing is unresolved', () => {
    const corrupt = graph({ expected: 1, active: 0, failed: 2, epoch: 5, changedAt: 0, unresolved: 0 })
    expect(assetGraphPending(corrupt)).toBe(-1)
    expect(isAssetGraphSettled(corrupt, QUIET * 100)).toBe(false)
  })
})

describe('scene-ready gate (settled AND the named bodies are up)', () => {
  const settled = graph({ expected: 4, active: 4, epoch: 9, changedAt: 0 })
  const now = QUIET
  const branches = (active: string[], failed: string[] = []) => ({ glbActive: active, glbFailed: failed })

  it('requires the named body, not merely a finished load', () => {
    expect(isSceneReady(settled, branches([]), now, ['building_office_01'])).toBe(false)
    expect(isSceneReady(settled, branches(['building_office_01']), now, ['building_office_01'])).toBe(true)
  })

  it('with nothing named, it is exactly the settle gate', () => {
    expect(isSceneReady(settled, branches([]), now, [])).toBe(true)
    expect(isSceneReady(settled, branches([]), now - 1, [])).toBe(false)
    expect(isSceneReady(graph({ epoch: 0 }), branches([]), 1e9, [])).toBe(false)
  })

  it('a MIXED archetype — three committed, one fell back — is not ready', () => {
    // arch_house_01 backs four placements. If one instance fails, a procedural house is in the
    // frame; the id is legitimately in BOTH lists and a shot that names it must not pass.
    const mixed = branches(['arch_house_01'], ['arch_house_01'])
    expect(isSceneReady(settled, mixed, now, ['arch_house_01'])).toBe(false)
    // Once the failed instance goes away, the same id is ready.
    expect(isSceneReady(settled, branches(['arch_house_01']), now, ['arch_house_01'])).toBe(true)
  })

  it('a remount that starts after the body is up still blocks the shot', () => {
    // The two-phase version passed here: the required id was active, so the second wait was
    // satisfied even though the graph had just been torn down and was pending again.
    const remounting = graph({ expected: 6, active: 1, failed: 0, epoch: 12, changedAt: 10_000 })
    const up = branches(['building_apartment_01'])
    expect(isSceneReady(remounting, up, 10_000 + QUIET * 5, ['building_apartment_01'])).toBe(false)
    // Only when the rest of the graph settles too.
    const done = graph({ ...remounting, active: 6, changedAt: 20_000, unresolved: undefined })
    expect(isSceneReady(done, up, 20_000 + QUIET, ['building_apartment_01'])).toBe(true)
  })

  it('every named body must be up, not just one of them', () => {
    const two = ['vehicle_utility_van_01', 'building_shop_01']
    expect(isSceneReady(settled, branches(['vehicle_utility_van_01']), now, two)).toBe(false)
    expect(isSceneReady(settled, branches(two), now, two)).toBe(true)
  })
})
