/**
 * Issue #27 H0 — prove the production bundle ships no diagnostics. Run AFTER `vite build`.
 * Scans dist/ for any _proof directory, raw candidate, remesh input, FBX, diagnostic texture,
 * proof report, or the not-yet-approved calibration human, and FAILS (exit 1) if any is present.
 *
 * Usage: npm run build && node scripts/checkDistClean.mjs
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = join(process.cwd(), 'dist')
if (!existsSync(DIST)) {
  console.error('✗ dist/ not found — run `vite build` first.')
  process.exit(1)
}

// Forbidden: diagnostic dirs, interchange formats, raw/intermediate candidates, proof artifacts,
// and the unapproved review human. Matched against the dist-relative path.
const FORBIDDEN = [
  /(^|\/)_[^/]+\//, // any underscore-prefixed dir (e.g. _proof/)
  /\.fbx$/i,
  /(^|\/)cand1_/i,
  /(^|\/)(male|female)_(proof|control)\b/i,
  /human_gold_calibration_01/i,
  /(^|\/)report\.json$/i,
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = walk(DIST).map((p) => relative(DIST, p))
const leaks = files.filter((p) => FORBIDDEN.some((re) => re.test(p)))

if (leaks.length) {
  console.error(`✗ ${leaks.length} diagnostic/proof artifact(s) leaked into dist/:`)
  for (const l of leaks) console.error(`    dist/${l}`)
  process.exit(1)
}
console.log(`✓ dist/ clean — scanned ${files.length} files, no diagnostic/proof/review artifacts.`)
process.exit(0)
