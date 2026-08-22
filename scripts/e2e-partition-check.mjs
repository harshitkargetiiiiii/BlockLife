/**
 * E2E partition accounting (branch e2e-ci-telemetry-probe).
 *
 * Proves the render-suppression rollout partitions the suite EXACTLY ONCE:
 *   simulation-only (@simulation-only)  +  normal-render (everything else)  =  full suite
 * with an empty intersection and a complete union — deterministically, from Playwright's own
 * `--list` output, so the CI gate can't run a test twice or drop one silently.
 *
 * Usage: node scripts/e2e-partition-check.mjs [expectedTotal]
 *   expectedTotal defaults to 367 (the accepted baseline). If legitimate branch changes alter the
 *   total, pass the new number; the script still enforces union==total and empty intersection.
 */
import { execSync } from 'node:child_process'

const EXPECTED = Number(process.argv[2] ?? 367)
const TAG = '@simulation-only'

// One test identity = "file:line:col › full title" — stable + unique across a run.
function listIds(extraArgs) {
  const out = execSync(`npx playwright test tests/e2e ${extraArgs} --list`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  })
  const ids = []
  for (const line of out.split('\n')) {
    const m = line.match(/›\s*((?:tests\/)?e2e\/\S+\.spec\.ts:\d+:\d+)\s*›\s*(.+?)\s*$/)
    if (m) ids.push(`${m[1]} › ${m[2]}`)
  }
  return ids
}

const all = listIds('')
const sim = listIds(`--grep "${TAG}"`)
const normal = listIds(`--grep-invert "${TAG}"`)

const setAll = new Set(all)
const setSim = new Set(sim)
const setNormal = new Set(normal)

const problems = []
// Uniqueness within each list (a duplicate id would corrupt the accounting).
if (setAll.size !== all.length) problems.push(`duplicate ids in full list (${all.length} vs ${setAll.size} unique)`)
if (setSim.size !== sim.length) problems.push(`duplicate ids in simulation-only list`)
if (setNormal.size !== normal.length) problems.push(`duplicate ids in normal-render list`)
// Exact partition.
if (sim.length + normal.length !== all.length) problems.push(`sim(${sim.length}) + normal(${normal.length}) != total(${all.length})`)
const intersection = [...setSim].filter((id) => setNormal.has(id))
if (intersection.length) problems.push(`non-empty intersection (${intersection.length}): ${intersection.slice(0, 3).join(' | ')}`)
const union = new Set([...setSim, ...setNormal])
if (union.size !== setAll.size) problems.push(`union(${union.size}) != full suite(${setAll.size})`)
const missing = [...setAll].filter((id) => !union.has(id))
if (missing.length) problems.push(`missing from both partitions (${missing.length}): ${missing.slice(0, 3).join(' | ')}`)
if (all.length !== EXPECTED) problems.push(`total ${all.length} != expected ${EXPECTED} — if a legitimate branch change altered the suite, re-run with the new expected total and justify it`)

console.log(`E2E partition accounting:`)
console.log(`  full suite:       ${all.length}`)
console.log(`  simulation-only:  ${sim.length}  (@simulation-only, render-suppressed)`)
console.log(`  normal-render:    ${normal.length}  (normal WebGL rendering)`)
console.log(`  intersection:     ${intersection.length}`)
console.log(`  union == suite:   ${union.size === setAll.size}`)
console.log(`  expected total:   ${EXPECTED}`)

if (problems.length) {
  console.error(`\n✗ partition accounting FAILED:`)
  for (const p of problems) console.error(`    - ${p}`)
  process.exit(1)
}
console.log(`\n✓ partition is exact-once: ${sim.length} + ${normal.length} = ${all.length}, empty intersection, complete union.`)
process.exit(0)
