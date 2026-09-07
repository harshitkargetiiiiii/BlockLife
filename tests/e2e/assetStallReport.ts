/**
 * Pure analysis for a GLB that never commits, for issue #47's shard 8 investigation.
 *
 * The failing boot in `visual-upgrade-perf.spec.ts` waits 45 s for `assetsSettled()` and, when it
 * loses, reports that exactly one instance of `vehicle_compact_car_01` is unresolved. Earlier
 * instrumentation established only that the file's HTTP response completed. That is NOT enough to
 * locate the stall, for two reasons this module is built to address:
 *
 *  - Completion *by the timeout instant* says nothing about WHEN the request started or finished.
 *    If Wave 4's four extra GLB requests in the same sector delayed the shell's request, that is a
 *    payload effect and the timings would show it.
 *  - Completion also says nothing about what happened AFTER the bytes arrived. Parse, decode and
 *    commit all follow, and the extra assets contend for exactly those.
 *
 * So this records WHEN each network stage happened, rather than only whether it happened. It is
 * deliberately limited to that: it observes the load from outside the render and cannot see parse,
 * decode, Suspense, commit or effects. Those are covered by the separate DEV stage probe
 * (`src/game/assets/assetStallProbe.ts`), and the two are read together.
 *
 * Kept pure and separate from the spec so it is unit-testable without a browser (the same split
 * issue #46 §5 used for the visual framing solver).
 */

/**
 * One poll of the DEV readiness API during boot.
 *
 * Every timestamp in this module is wall-clock `Date.now()`, because the inputs come from two
 * different processes: stage marks are recorded in the BROWSER, network timings in the NODE test
 * process. `performance.now()` is relative to each document's own time origin and cannot be
 * compared across them, so all three sources record epoch milliseconds and this reporter normalises
 * them to a single `t0`.
 */
export interface ReadinessSample {
  epochMs: number
  /** Asset ids readiness is still waiting on (`unresolvedByAsset`). */
  unresolvedIds: readonly string[]
  /** Asset ids with at least one committed instance (`glbActive`). */
  activeIds: readonly string[]
}

/** Network timing for one `.glb`, in the same clock as `ReadinessSample.tMs`. */
export interface GlbRequestTiming {
  file: string
  startEpochMs: number
  /**
   * The request's TERMINAL event — response completed, or the request failed. `null` means it was
   * still in flight.
   *
   * A failed request is terminal too: it is no longer in flight and never will be. An earlier
   * version left this `null` on failure, which made the request look permanently outstanding and
   * kept it in the concurrency counts forever. Pair it with `failed` to tell the two apart.
   */
  endEpochMs: number | null
  /** True when the terminal event was a failure rather than a completed response. */
  failed?: boolean
}

/** A render/commit milestone recorded in the browser (`assetStallProbe`). */
export interface StageMark {
  stage: string
  epochMs: number
}

export type StallStage =
  | 'never-requested'
  /** Terminated by failure — nothing arrived, and nothing ever will. */
  | 'request-failed'
  | 'request-outstanding'
  | 'arrived-never-committed'
  | 'committed'

export interface StallReport {
  assetId: string
  file: string
  stage: StallStage
  requestStartMs: number | null
  /** When the bytes ARRIVED. `null` if the request failed or never terminated. */
  requestFinishMs: number | null
  /** The terminal event, success or failure. `null` if still in flight at the cut-off. */
  requestEndMs: number | null
  /** Start → terminal event. */
  networkMs: number | null
  /**
   * How long the boot kept waiting AFTER the bytes arrived. The key number.
   *
   * `null` when nothing arrived (failed, still in flight, or never requested). It can never be
   * negative: everything is cut off at `gaveUpEpochMs` before this is computed, so an arrival is by
   * construction at or before the moment the wait gave up.
   */
  waitedAfterArrivalMs: number | null
  /**
   * Peers first OBSERVED committed in a sample after this file's bytes arrived.
   *
   * CONTEXT ONLY, and meaningful only when `peersBaselineAvailable` is true. This does NOT show the
   * stalled body was "skipped": samples are ~500 ms apart and observe only post-commit state, so a
   * peer committing later is equally consistent with the stalled body being mid-parse, mid-decode or
   * awaiting Suspense. Read it with the stage marks, which are what actually locate the stall.
   */
  peersCommittedAfterArrival: string[]
  /**
   * Whether any sample exists at or before arrival to serve as a baseline.
   *
   * Sampling starts only after `ready()`, so a fast response can finish before the first sample.
   * With no baseline there is nothing to diff against — every already-committed body would look
   * "new" and the peer list would be fabricated wholesale. When this is false,
   * `peersCommittedAfterArrival` is empty and carries NO claim about what committed when.
   */
  peersBaselineAvailable: boolean
  /** Other GLB requests still in flight when this one started / finished. */
  concurrentAtStart: number
  concurrentAtFinish: number
  /** First sample in which the id was OBSERVED unresolved — not when it registered as expected. */
  firstUnresolvedMs: number | null
  /** Last sample in which the id was OBSERVED unresolved. */
  lastUnresolvedMs: number | null
  /** Render/commit milestones, normalised onto the same `t0` as everything else. */
  stages: { stage: string; msSinceT0: number }[]
  /**
   * Milestones never reached.
   *
   * If `hook-returned` is among them the component never got past `useGLTF`, which leaves GLTF
   * parse, decode and Suspense-resume unresolved BETWEEN THEMSELVES — narrowing the question, not
   * answering it.
   */
  missingStages: string[]
}

/** The milestones the probe can emit, in the order React reaches them. */
export const EXPECTED_STAGES = ['hook-returned', 'clone-built', 'react-commit', 'active-effect'] as const

/**
 * Requests genuinely in flight at `atEpoch` — started, and not yet terminated by EITHER success or
 * failure.
 */
const inFlightAt = (timings: readonly GlbRequestTiming[], atEpoch: number, exclude: string): number =>
  timings.filter(
    (t) =>
      t.file !== exclude &&
      t.startEpochMs <= atEpoch &&
      (t.endEpochMs === null || t.endEpochMs > atEpoch),
  ).length

/**
 * Cut every source off at the instant the wait gave up.
 *
 * The report is assembled by `await`ing further browser queries, so samples, timings and stage
 * marks all keep moving while it is built. Anything after `gaveUpEpochMs` is not evidence about the
 * failure — it happened after it — and letting it through produced nonsense such as a negative
 * "waited after arrival". A terminal event later than the cut-off is rewritten to `null`: as of the
 * cut-off that request was still in flight, which is the truthful statement.
 */
export function cutOffAt(
  samples: readonly ReadinessSample[],
  timings: readonly GlbRequestTiming[],
  stageMarks: readonly StageMark[],
  gaveUpEpochMs: number,
): { samples: ReadinessSample[]; timings: GlbRequestTiming[]; stageMarks: StageMark[] } {
  return {
    samples: samples.filter((s) => s.epochMs <= gaveUpEpochMs),
    timings: timings
      .filter((t) => t.startEpochMs <= gaveUpEpochMs)
      .map((t) =>
        t.endEpochMs !== null && t.endEpochMs > gaveUpEpochMs
          ? { ...t, endEpochMs: null, failed: false }
          : { ...t },
      ),
    stageMarks: stageMarks.filter((m) => m.epochMs <= gaveUpEpochMs),
  }
}

/**
 * Condense a boot's samples + network timings into the one paragraph a reader needs.
 *
 * `timeoutMs` is when the wait gave up, so `waitedAfterArrivalMs` measures the window in which the
 * body had its bytes and still did not commit.
 */
export function summarizeStall(
  assetId: string,
  file: string,
  samples: readonly ReadinessSample[],
  timings: readonly GlbRequestTiming[],
  stageMarks: readonly StageMark[],
  t0EpochMs: number,
  gaveUpEpochMs: number,
): StallReport {
  const rel = (epoch: number) => epoch - t0EpochMs
  // Everything is cut off at the failure boundary FIRST, so nothing that happened after the wait
  // gave up can reach the report — see `cutOffAt`.
  const cut = cutOffAt(samples, timings, stageMarks, gaveUpEpochMs)
  const own = cut.timings.find((t) => t.file === file) ?? null
  const unresolvedSamples = cut.samples.filter((s) => s.unresolvedIds.includes(assetId))
  const committed = cut.samples.some((s) => s.activeIds.includes(assetId))

  const terminal = own?.endEpochMs ?? null
  const requestFailed = own?.failed === true && terminal !== null
  // "Arrival" means BYTES, so a failed request has none even though it terminated.
  const arrival = requestFailed ? null : terminal

  let stage: StallStage
  if (committed) stage = 'committed'
  else if (!own) stage = 'never-requested'
  else if (requestFailed) stage = 'request-failed'
  else if (terminal === null) stage = 'request-outstanding'
  else stage = 'arrived-never-committed'
  // Ids that were NOT active in some sample at/before arrival but ARE active in a later sample.
  // A baseline is required. Sampling starts only after `ready()`, so the response can finish before
  // the first sample; with nothing at/before arrival every already-committed body would look new and
  // the peer list would be pure fabrication. Report nothing rather than something false.
  const baselineSamples = arrival === null ? [] : cut.samples.filter((s) => s.epochMs <= arrival)
  const peersBaselineAvailable = baselineSamples.length > 0
  const peers = new Set<string>()
  if (arrival !== null && peersBaselineAvailable) {
    const before = new Set<string>()
    for (const s of baselineSamples) for (const id of s.activeIds) before.add(id)
    for (const s of cut.samples) {
      if (s.epochMs <= arrival) continue
      for (const id of s.activeIds) if (!before.has(id) && id !== assetId) peers.add(id)
    }
  }

  const seen = new Set(cut.stageMarks.map((m) => m.stage))
  return {
    assetId,
    file,
    stage,
    requestStartMs: own ? rel(own.startEpochMs) : null,
    requestFinishMs: arrival !== null ? rel(arrival) : null,
    requestEndMs: terminal !== null ? rel(terminal) : null,
    networkMs: own && terminal !== null ? terminal - own.startEpochMs : null,
    waitedAfterArrivalMs: arrival !== null ? gaveUpEpochMs - arrival : null,
    peersCommittedAfterArrival: [...peers].sort(),
    peersBaselineAvailable,
    concurrentAtStart: own ? inFlightAt(cut.timings, own.startEpochMs, file) : 0,
    concurrentAtFinish: terminal !== null ? inFlightAt(cut.timings, terminal, file) : 0,
    firstUnresolvedMs: unresolvedSamples[0] ? rel(unresolvedSamples[0].epochMs) : null,
    lastUnresolvedMs: unresolvedSamples.length
      ? rel(unresolvedSamples[unresolvedSamples.length - 1].epochMs)
      : null,
    stages: cut.stageMarks.map((m) => ({ stage: m.stage, msSinceT0: rel(m.epochMs) })),
    missingStages: EXPECTED_STAGES.filter((st) => !seen.has(st)),
  }
}
