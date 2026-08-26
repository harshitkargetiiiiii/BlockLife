/**
 * Honest per-shard gate for a Playwright run (branch e2e-ci-telemetry-probe).
 *
 * Playwright exits 0 on a run that SKIPPED tests or matched ZERO tests (a bad --grep), and — if the
 * config left retries on — a flaky pass also exits 0. The render-suppression gate must be stricter
 * than the exit code: it reads Playwright's own JSON report and FAILS unless the shard ran cleanly.
 *
 *   node scripts/assert-playwright-run.mjs <results.json> "<label>"
 *
 * Fails (exit 1) if the report is missing/unparseable, or if for this shard:
 *   unexpected != 0  (a real failure)   |  skipped != 0  (a skip)  |
 *   flaky != 0       (a retry occurred) |  expected < 1  (the shard ran no tests)
 * Only a clean shard — every selected test passed on the first try, nothing skipped — exits 0.
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const label = process.argv[3] ?? file

function fail(msg) {
  console.error(`\n✗ [${label}] ${msg}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  fail(`could not read/parse Playwright JSON report "${file}" — the run likely crashed before writing it (${e.message}).`)
}

const s = report.stats ?? {}
const expected = s.expected ?? 0 // passed as expected
const unexpected = s.unexpected ?? 0 // failed
const flaky = s.flaky ?? 0 // passed only on retry
const skipped = s.skipped ?? 0

console.log(`[${label}] stats: expected(passed)=${expected} unexpected(failed)=${unexpected} flaky=${flaky} skipped=${skipped}`)

const problems = []
if (unexpected !== 0) problems.push(`${unexpected} test(s) FAILED`)
if (skipped !== 0) problems.push(`${skipped} test(s) SKIPPED (a gate test must never skip)`)
if (flaky !== 0) problems.push(`${flaky} test(s) FLAKY (a retry occurred — retries must be 0)`)
if (expected < 1) problems.push(`0 tests executed (empty partition — bad --grep/--shard?)`)

if (problems.length) fail(`shard is NOT clean: ${problems.join('; ')}.`)
console.log(`✓ [${label}] clean — ${expected} passed, 0 failed, 0 skipped, 0 flaky.`)
process.exit(0)
