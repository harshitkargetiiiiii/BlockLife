import { describe, expect, it } from 'vitest'
import {
  summarizeStall,
  type GlbRequestTiming,
  type ReadinessSample,
  type StageMark,
} from './assetStallReport'

const ID = 'vehicle_compact_car_01'
const FILE = 'compact_sedan_01.glb'
// A deliberately large epoch, so any accidental use of a raw timestamp instead of a t0-relative
// one shows up as an absurd number rather than passing by luck.
const T0 = 1_800_000_000_000
const sample = (offset: number, unresolvedIds: string[], activeIds: string[]): ReadinessSample => ({
  epochMs: T0 + offset, unresolvedIds, activeIds,
})
const net = (file: string, start: number, end: number | null): GlbRequestTiming => ({
  file, startEpochMs: T0 + start, endEpochMs: end === null ? null : T0 + end,
})
const netFailed = (file: string, start: number, end: number): GlbRequestTiming => ({
  file, startEpochMs: T0 + start, endEpochMs: T0 + end, failed: true,
})
const mark = (stage: string, offset: number): StageMark => ({ stage, epochMs: T0 + offset })
const ALL = ['hook-returned', 'clone-built', 'react-commit', 'active-effect']

describe('summarizeStall — locating a GLB that never commits (issue #47 shard 8)', () => {
  it('normalises browser and Node timestamps onto one t0', () => {
    // Stage marks come from the browser, network timings from the Node process. Both are epoch
    // milliseconds; every reported field must be relative to t0, never a raw epoch.
    const r = summarizeStall(
      ID, FILE,
      [sample(1_000, [ID], [])],
      [net(FILE, 800, 2_000)],
      [mark('hook-returned', 1_500)],
      T0, T0 + 45_000,
    )
    expect(r.requestStartMs).toBe(800)
    expect(r.requestFinishMs).toBe(2_000)
    expect(r.firstUnresolvedMs).toBe(1_000)
    expect(r.stages).toEqual([{ stage: 'hook-returned', msSinceT0: 1_500 }])
    for (const v of [r.requestStartMs, r.requestFinishMs, r.firstUnresolvedMs]) {
      expect(v!).toBeLessThan(1_000_000) // i.e. not a raw epoch
    }
  })

  it('reports arrived-never-committed and how long the boot waited after the bytes landed', () => {
    const r = summarizeStall(
      ID, FILE,
      [sample(1_000, [ID], ['a']), sample(30_000, [ID], ['a', 'b'])],
      [net(FILE, 800, 2_000), net('parked_hatchback_01.glb', 900, 1_500)],
      [], T0, T0 + 45_000,
    )
    expect(r.stage).toBe('arrived-never-committed')
    expect(r.networkMs).toBe(1_200)
    expect(r.waitedAfterArrivalMs).toBe(43_000)
  })

  it('a missing hook-returned leaves parse/decode/Suspense unseparated — all four are listed', () => {
    const r = summarizeStall(ID, FILE, [sample(1_000, [ID], [])], [net(FILE, 100, 900)], [], T0, T0 + 45_000)
    expect(r.stages).toEqual([])
    expect(r.missingStages).toEqual(ALL)
  })

  it('locates a stall that got past the hook but never committed', () => {
    const r = summarizeStall(
      ID, FILE, [sample(1_000, [ID], [])], [net(FILE, 100, 900)],
      [mark('hook-returned', 950), mark('clone-built', 980)],
      T0, T0 + 45_000,
    )
    expect(r.stages.map((x) => x.stage)).toEqual(['hook-returned', 'clone-built'])
    expect(r.missingStages).toEqual(['react-commit', 'active-effect'])
  })

  it('reports NO peers when the response finished before the first sample', () => {
    // Sampling starts only after ready(), so arrival can precede every sample. With no baseline to
    // diff against, treating it as empty made every already-committed body look new — a fabricated
    // peer list. It must report nothing, and say so explicitly.
    const r = summarizeStall(
      ID, FILE,
      [sample(9_000, [ID], ['already_a', 'already_b'])], // first sample is AFTER arrival
      [net(FILE, 100, 900)],
      [], T0, T0 + 45_000,
    )
    expect(r.peersBaselineAvailable).toBe(false)
    expect(r.peersCommittedAfterArrival).toEqual([])
  })

  it('lists peers that first committed after arrival, as CONTEXT only (not proof of skipping)', () => {
    const r = summarizeStall(
      ID, FILE,
      [sample(1_000, [ID], ['early']), sample(5_000, [ID], ['early', 'late_a', 'late_b'])],
      [net(FILE, 500, 2_000)], [], T0, T0 + 45_000,
    )
    expect(r.peersBaselineAvailable).toBe(true)
    expect(r.peersCommittedAfterArrival).toEqual(['late_a', 'late_b'])
  })

  it('distinguishes a request that never finished from one that never started', () => {
    const outstanding = summarizeStall(ID, FILE, [sample(1_000, [ID], [])], [net(FILE, 900, null)], [], T0, T0 + 45_000)
    expect(outstanding.stage).toBe('request-outstanding')
    expect(outstanding.waitedAfterArrivalMs).toBeNull()

    const absent = summarizeStall(ID, FILE, [sample(1_000, [ID], [])], [net('other.glb', 10, 20)], [], T0, T0 + 45_000)
    expect(absent.stage).toBe('never-requested')
    expect(absent.requestStartMs).toBeNull()
  })

  it('reports committed when the body did come up', () => {
    const r = summarizeStall(ID, FILE, [sample(1_000, [], [ID])], [net(FILE, 100, 900)],
      [mark('hook-returned', 200), mark('clone-built', 210), mark('react-commit', 220), mark('active-effect', 230)],
      T0, T0 + 45_000)
    expect(r.stage).toBe('committed')
    expect(r.missingStages).toEqual([])
  })

  it('treats a FAILED request as terminal, not outstanding', () => {
    const r = summarizeStall(ID, FILE, [sample(1_000, [ID], [])], [netFailed(FILE, 100, 400)], [], T0, T0 + 45_000)
    expect(r.stage).toBe('request-failed')
    expect(r.requestEndMs).toBe(400)
    // Nothing ARRIVED, so there is no arrival and no "waited after arrival".
    expect(r.requestFinishMs).toBeNull()
    expect(r.waitedAfterArrivalMs).toBeNull()
  })

  it('excludes a failed request from concurrency once it has terminated', () => {
    // Previously a failure left the end unstamped, so a dead request counted as in flight forever
    // and inflated every later concurrency reading.
    const r = summarizeStall(
      ID, FILE, [sample(1_000, [ID], [])],
      [net(FILE, 1_000, 5_000), netFailed('parked_pickup_01.glb', 100, 900)],
      [], T0, T0 + 45_000,
    )
    expect(r.concurrentAtStart).toBe(0)
    expect(r.concurrentAtFinish).toBe(0)
  })

  it('does not let anything after the give-up instant contaminate the report', () => {
    const gaveUp = 30_000
    const r = summarizeStall(
      ID, FILE,
      [
        sample(1_000, [ID], ['before']),
        sample(40_000, [], ['before', 'after_the_end']), // post-give-up sample
      ],
      [
        net(FILE, 100, 35_000), // terminates AFTER give-up
        net('late.glb', 31_000, 32_000), // starts after give-up
      ],
      [mark('hook-returned', 33_000)], // recorded after give-up
      T0, T0 + gaveUp,
    )
    // As of the cut-off the request had NOT terminated, so no arrival and no negative wait.
    expect(r.stage).toBe('request-outstanding')
    expect(r.requestEndMs).toBeNull()
    expect(r.waitedAfterArrivalMs).toBeNull()
    // The post-give-up sample, request and stage mark are all excluded.
    expect(r.lastUnresolvedMs).toBe(1_000)
    expect(r.stages).toEqual([])
    expect(r.missingStages).toEqual(ALL)
    expect(r.concurrentAtStart).toBe(0)
  })

  it('never reports a negative waitedAfterArrivalMs', () => {
    // By semantics, not by clamping: the arrival is cut off at give-up, so it cannot be later.
    for (const end of [10_000, 29_999, 30_000, 30_001, 44_000]) {
      const r = summarizeStall(ID, FILE, [sample(1_000, [ID], [])], [net(FILE, 100, end)], [], T0, T0 + 30_000)
      if (r.waitedAfterArrivalMs !== null) expect(r.waitedAfterArrivalMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('counts concurrent in-flight GLB requests at start and finish', () => {
    const r = summarizeStall(
      ID, FILE, [sample(1_000, [ID], [])],
      [
        net(FILE, 1_000, 5_000),
        net('parked_hatchback_01.glb', 900, 6_000),
        net('parked_pickup_01.glb', 950, 2_000),
        net('arch_house_01.glb', 100, 200),
      ],
      [], T0, T0 + 45_000,
    )
    expect(r.concurrentAtStart).toBe(2)
    expect(r.concurrentAtFinish).toBe(1)
  })
})
