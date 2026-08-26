/**
 * Issue #34 Phase B — DEV-ONLY bounded diagnostic event ring buffer.
 *
 * Records observations only. Nothing here influences a decision, mutates
 * simulation state, or changes any output: every call site captures values that
 * already exist and pushes a plain snapshot. The whole module is behind
 * `import.meta.env.DEV` at every call site so it tree-shakes out of production
 * (asserted by the dist-exclusion gate). Delete with the Phase B branch.
 */

export interface Issue34Event {
  seq: number
  kind: string
  wallMs: number
  data: Record<string, unknown>
}

const MAX_EVENTS = 600

const buffer: Issue34Event[] = []
let seq = 0
let dropped = 0

export function pushIssue34Event(kind: string, data: Record<string, unknown>): void {
  if (buffer.length >= MAX_EVENTS) {
    dropped++
    return
  }
  buffer.push({ seq: seq++, kind, wallMs: Math.round(performance.now()), data })
}

export function getIssue34Events(): { events: Issue34Event[]; dropped: number; total: number } {
  return { events: buffer.map((e) => ({ ...e, data: { ...e.data } })), dropped, total: seq }
}

export function resetIssue34Events(): void {
  buffer.length = 0
  seq = 0
  dropped = 0
}
