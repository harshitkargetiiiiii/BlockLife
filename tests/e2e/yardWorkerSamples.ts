import type { ConsoleMessage, Page, TestInfo } from '@playwright/test'

/**
 * Test-only evidence for issue #34 Track B: where the yard worker is while
 * `citizen-destinations.spec.ts` waits for it to arrive.
 *
 * The CI trace at 6868c81 recorded the trip state once, before the 380 s arrival wait, and nothing
 * after it: `waitForFunction` returns nothing when it times out. A failure therefore could not be
 * told apart as slow progress, a stall, a crossing wait or a route change.
 *
 * The wait itself is unchanged: the same Boolean predicate, Playwright's default polling, the timeout
 * the caller passes. The predicate additionally emits one small tagged console record on its FIRST
 * poll, then at most once per `intervalMs`, and on the poll that sees arrival. The test collects the
 * records as they arrive (bounded) and, on success OR failure, attaches what it already has. Nothing is
 * evaluated after the wait ends, no timer or second evaluation loop runs beside it, and no game or test
 * API is added — the records read `getCitizenTripState`, `getPedestrianCrossingState` and
 * `getRenderStats`, all existing.
 */

export interface YardSamplingArg {
  /** Console prefix that marks a record. */
  tag: string
  /** Minimum page time between periodic records. */
  intervalMs: number
  /** Most records the page emits before the arrival record (which is always allowed once). */
  max: number
}

export const YARD_SAMPLING: YardSamplingArg = { tag: 'YARD_WORKER_SAMPLE ', intervalMs: 20_000, max: 24 }

export interface YardSample {
  kind: 'initial' | 'periodic' | 'arrived'
  seq: number
  /** `performance.now()` in the page when the record was taken. */
  pageMs: number
  trip: {
    phase: string
    destinationId: string | null
    waypointIndex: number
    waypointCount: number
    recoveryStage: number
    tripsCompleted: number
    suspended: boolean
    routeEdges: number
    routeEnd: string | null
  } | null
  ped: { state: string; crosswalkId: string | null; waitTime: number; position: [number, number] } | null
  /** `getRenderStats().samples`: frames the perf probe has seen since load. */
  frames: number | null
  /** `getRenderStats().frameMsBuckets`: cumulative since load. */
  frameMsBuckets: number[] | null
  /** Bucket upper bounds (ms); on the initial record only. */
  frameMsBucketBounds?: (number | null)[]
}

export interface YardRecord extends YardSample {
  /** `Date.now()` in the test process when the console event was received. */
  receivedEpochMs: number
}

/**
 * The ORIGINAL arrival predicate — its Boolean is computed first, exactly as before, and returned
 * unchanged. Sampling is a side effect inside a try/catch so it can never throw or alter the result.
 * Runs in the page, so it must stay self-contained (no module-scope references).
 */
export function yardWorkerArrived(arg: YardSamplingArg): boolean {
  const arrived =
    window.GAME_TEST_API!.getCitizenTripState('cit_dd_yard_worker')?.phase === 'performing_activity'
  try {
    const w = window as unknown as { __yardWorkerSampling?: { emitted: number; nextAt: number } }
    const now = performance.now()
    const first = !w.__yardWorkerSampling
    if (first) w.__yardWorkerSampling = { emitted: 0, nextAt: 0 }
    const s = w.__yardWorkerSampling!
    const cap = arrived ? arg.max + 1 : arg.max
    if ((first || arrived || now >= s.nextAt) && s.emitted < cap) {
      const api = window.GAME_TEST_API!
      const trip = api.getCitizenTripState('cit_dd_yard_worker')
      const ped = api.getPedestrianCrossingState('cit_dd_yard_worker')
      const render = (
        api as unknown as {
          getRenderStats?: () => { samples: number; frameMsBuckets: number[]; frameMsBucketBounds: (number | null)[] }
        }
      ).getRenderStats?.()
      const r2 = (v: number) => Math.round(v * 100) / 100
      s.emitted += 1
      s.nextAt = now + arg.intervalMs
      console.log(
        arg.tag +
          JSON.stringify({
            kind: arrived ? 'arrived' : first ? 'initial' : 'periodic',
            seq: s.emitted,
            pageMs: Math.round(now),
            trip: trip
              ? {
                  phase: trip.phase,
                  destinationId: trip.destinationId,
                  waypointIndex: trip.waypointIndex,
                  waypointCount: trip.waypointCount,
                  recoveryStage: trip.recoveryStage,
                  tripsCompleted: trip.tripsCompleted,
                  suspended: trip.suspended,
                  routeEdges: trip.routeEdgeIds.length,
                  routeEnd: trip.routeEdgeIds.length ? trip.routeEdgeIds[trip.routeEdgeIds.length - 1] : null,
                }
              : null,
            ped: ped
              ? {
                  state: ped.state,
                  crosswalkId: ped.crosswalkId,
                  waitTime: r2(ped.waitTime),
                  position: [r2(ped.position[0]), r2(ped.position[1])],
                }
              : null,
            frames: render ? render.samples : null,
            frameMsBuckets: render ? render.frameMsBuckets : null,
            frameMsBucketBounds: first && render ? render.frameMsBucketBounds : undefined,
          }),
      )
    }
  } catch {
    // Sampling must never change what the wait observes.
  }
  return arrived
}

/** Collects tagged records from console text, bounded at `max`. */
export function createYardCollector(tag: string, max: number) {
  const records: YardRecord[] = []
  const counts = { dropped: 0, malformed: 0 }
  return {
    records,
    counts,
    onText(text: string, receivedEpochMs: number): void {
      if (!text.startsWith(tag)) return
      if (records.length >= max) {
        counts.dropped++
        return
      }
      try {
        records.push({ receivedEpochMs, ...(JSON.parse(text.slice(tag.length)) as YardSample) })
      } catch {
        counts.malformed++
      }
    },
  }
}

export interface YardReport {
  citizenId: 'cit_dd_yard_worker'
  outcome: 'arrived' | 'no arrival observed (the wait threw; its error propagates unchanged)'
  waitMs: number
  sampling: YardSamplingArg
  received: number
  droppedOverCap: number
  malformed: number
  /** Age of the newest record when the wait ended, by the test process's receipt clock. */
  lastSample: { kind: string; seq: number; ageAtWaitEndMs: number } | null
  terminalState: string
  limits: string[]
  records: YardRecord[]
}

export function buildYardReport(input: {
  arrived: boolean
  waitStartEpochMs: number
  waitEndEpochMs: number
  sampling: YardSamplingArg
  records: YardRecord[]
  dropped: number
  malformed: number
}): YardReport {
  const last = input.records.length ? input.records[input.records.length - 1] : null
  const arrivalRecorded = input.records.some((r) => r.kind === 'arrived')
  return {
    citizenId: 'cit_dd_yard_worker',
    outcome: input.arrived ? 'arrived' : 'no arrival observed (the wait threw; its error propagates unchanged)',
    waitMs: input.waitEndEpochMs - input.waitStartEpochMs,
    sampling: input.sampling,
    received: input.records.length,
    droppedOverCap: input.dropped,
    malformed: input.malformed,
    lastSample: last ? { kind: last.kind, seq: last.seq, ageAtWaitEndMs: input.waitEndEpochMs - last.receivedEpochMs } : null,
    terminalState: input.arrived
      ? arrivalRecorded
        ? 'captured: the record taken on the poll that saw arrival'
        : 'MISSING: arrival was observed but its record was not received'
      : 'MISSING: the wait ended without arrival and nothing was evaluated afterwards; the state after the last record (see lastSample.ageAtWaitEndMs) is unknown',
    limits: [
      'Records are taken only on the predicate’s own polls: the first, at most one per interval, and the arrival poll. Anything between two records (a crossing wait, a stop, a recovery, a route change) can be missed.',
      'frames / frameMsBuckets are cumulative render-probe counts. Their deltas bound rendered frames and frame time between records; they do not measure citizen movement time (a citizen steps at most min(dt, 0.1) s per frame of its own update).',
      'A stationary position or recoveryStage > 0 is not by itself obstruction: crossing waits (ped.state, waitTime), suspension and route changes (destinationId, routeEdges, routeEnd, waypointCount) must be ruled out, and a mixed or unknown reading is valid.',
    ],
    records: input.records,
  }
}

/**
 * Runs the unchanged arrival wait with sampling, then attaches the records it already collected —
 * on success or failure. The listener is always removed; attaching never throws, so the wait's own
 * result or error is what the test sees.
 */
export async function waitForYardWorkerArrival(
  page: Page,
  testInfo: TestInfo,
  timeout: number,
  sampling: YardSamplingArg = YARD_SAMPLING,
): Promise<void> {
  const collector = createYardCollector(sampling.tag, sampling.max + 1)
  const onConsole = (msg: ConsoleMessage) => collector.onText(msg.text(), Date.now())
  page.on('console', onConsole)
  const waitStartEpochMs = Date.now()
  let arrived = false
  try {
    await page.waitForFunction(yardWorkerArrived, sampling, { timeout })
    arrived = true
  } finally {
    page.off('console', onConsole)
    try {
      const report = buildYardReport({
        arrived,
        waitStartEpochMs,
        waitEndEpochMs: Date.now(),
        sampling,
        records: collector.records,
        dropped: collector.counts.dropped,
        malformed: collector.counts.malformed,
      })
      await testInfo.attach('yard-worker-samples.json', {
        body: JSON.stringify(report, null, 1),
        contentType: 'application/json',
      })
      // One line in the Actions log, which outlives the 7-day artifact.
      console.log(`YARD_WORKER_SAMPLES ${JSON.stringify(report)}`)
    } catch {
      // Evidence is best-effort; it must never replace the wait's own outcome.
    }
  }
}
