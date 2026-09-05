/**
 * Turn a Playwright visual run's `test-results/` output into the mismatch inventory a baseline
 * migration has to adjudicate — one row per changed image, with the spec it came from and the
 * measured diff.
 *
 * Issue #46 established the procedure: run the complete suite no-update, INVENTORY the mismatches
 * by spec and test, build `expected | actual | diff` sheets, adjudicate every frame individually,
 * and only then update the images you approved. This is the inventory step as a re-runnable tool,
 * so the list is derived from the run rather than typed by hand.
 *
 *   node scripts/visual-review/collectMismatches.mjs [testResultsDir] [--json rows.json]
 *
 * Playwright writes `<name>-expected.png`, `<name>-actual.png` and `<name>-diff.png` into a
 * per-test directory whenever `toHaveScreenshot` fails. A MISSING baseline produces only
 * `-actual.png` (there was nothing to compare), which is a different thing and is reported
 * separately — a new baseline is not an adjudicated change.
 *
 * The output feeds `buildContactSheets.mjs` directly.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const jsonIdx = args.indexOf('--json')
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null
const ROOT = args[0] && !args[0].startsWith('--') ? args[0] : 'test-results'

if (!existsSync(ROOT)) {
  console.error(`no ${ROOT}/ — run the visual suite first (it is only written on failure)`)
  process.exit(1)
}

/** `test-results/<spec-slug>-<test-slug>-chromium/` → the images it holds. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(ROOT)
const byBase = new Map()
for (const f of files) {
  const m = /^(.*)-(expected|actual|diff|previous)\.png$/.exec(f)
  if (!m) continue
  const [, base, kind] = m
  if (!byBase.has(base)) byBase.set(base, {})
  byBase.get(base)[kind] = f
}

/** The error-context file Playwright writes beside the images carries the measured diff. */
function measuredDiff(dir) {
  const ctx = join(dir, 'error-context.md')
  if (!existsSync(ctx)) return {}
  const text = readFileSync(ctx, 'utf8')
  const px = /(\d+)\s+pixels?\s+\(ratio\s+([\d.]+)/.exec(text)
  return px ? { diffPixels: Number(px[1]), diffRatio: Number(px[2]) } : {}
}

const changed = []
const added = []
for (const [base, imgs] of [...byBase].sort()) {
  const dir = base.slice(0, base.lastIndexOf('/'))
  const name = base.slice(base.lastIndexOf('/') + 1)
  const row = {
    name,
    spec: dir.slice(dir.lastIndexOf('/') + 1),
    ...measuredDiff(dir),
    expected: imgs.expected ?? null,
    actual: imgs.actual ?? null,
    diff: imgs.diff ?? null,
    verdict: 'UNADJUDICATED',
    note: '',
  }
  if (row.expected && row.actual) changed.push(row)
  else if (row.actual) added.push(row)
}

console.log(`CHANGED (an existing baseline mismatched — must be adjudicated one by one): ${changed.length}`)
for (const r of changed) console.log(`  ${r.name}  [${r.spec}]  ${r.diffPixels ?? '?'} px`)
console.log(`\nNEW (no committed baseline to compare — a new image, not a migration): ${added.length}`)
for (const r of added) console.log(`  ${r.name}  [${r.spec}]`)

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(changed, null, 2) + '\n')
  console.log(`\nwrote ${jsonOut} — ${changed.length} rows to adjudicate`)
}
