/**
 * Paginated `expected | actual | diff` contact sheets for a visual-baseline migration.
 *
 * Issue #46 established the review package a baseline change has to ship with — every modified
 * image shown side by side with the capture that replaced it and a diff overlay, so the migration
 * is checkable FROM THE PULL REQUEST without cloning the branch or re-running the suite. It built
 * those sheets ad hoc. This is the same job as a committed, re-runnable tool, so issue #47 and
 * every wave after it produce a package in the same shape instead of reinventing one.
 *
 *   node scripts/visual-review/buildContactSheets.mjs <rows.json> <outDir> [--title "…"]
 *
 * `rows.json` is an array of:
 *   { name, spec, verdict, note?, expected, actual, diff?, diffPixels?, diffRatio? }
 * where `expected` / `actual` / `diff` are paths to PNGs. `diff` is optional: when Playwright did
 * not produce one (a DELIBERATE reframe passes the sweep, so there is no mismatch to diff), the
 * overlay is COMPUTED here — changed pixels in red over a whitened original — and labelled as
 * computed, exactly as issue #46's sheet 10 did.
 *
 * Output: `<outDir>/sheet-NN.jpg` (10 rows each) + `<outDir>/sheets.json`, the machine-readable
 * index. Rows render at a third of native width, which stays legible at GitHub's full-width image
 * view and keeps a 100-image package to a few MB.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'

const [rowsPath, outDir, ...rest] = process.argv.slice(2)
if (!rowsPath || !outDir) {
  console.error('usage: buildContactSheets.mjs <rows.json> <outDir> [--title "…"]')
  process.exit(2)
}
const titleIdx = rest.indexOf('--title')
const TITLE = titleIdx >= 0 ? rest[titleIdx + 1] : 'baseline migration'

const CELL_W = 400
const CELL_H = 225
const GAP = 8
const CAPTION_H = 46
const ROW_H = CELL_H + CAPTION_H + GAP
const ROWS_PER_SHEET = 10
const SHEET_W = CELL_W * 3 + GAP * 4
const PAD = 12

const rows = JSON.parse(readFileSync(rowsPath, 'utf8'))
mkdirSync(outDir, { recursive: true })

const escape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function cell(path) {
  return sharp(path).resize(CELL_W, CELL_H, { fit: 'contain', background: '#101317' }).toBuffer()
}

/**
 * A computed overlay for a row Playwright never diffed: changed pixels in RED over a whitened
 * copy of the ORIGINAL. Labelled "computed" in the caption so it is never mistaken for
 * Playwright's own diff.
 */
async function computedDiff(expectedPath, actualPath) {
  const a = sharp(expectedPath).resize(CELL_W, CELL_H, { fit: 'contain', background: '#101317' })
  const b = sharp(actualPath).resize(CELL_W, CELL_H, { fit: 'contain', background: '#101317' })
  const [ab, bb] = await Promise.all([
    a.raw().toBuffer({ resolveWithObject: true }),
    b.raw().toBuffer({ resolveWithObject: true }),
  ])
  const ch = ab.info.channels
  const out = Buffer.alloc(CELL_W * CELL_H * 3)
  let changed = 0
  for (let i = 0, p = 0; p < CELL_W * CELL_H; p++, i += ch) {
    const dr = Math.abs(ab.data[i] - bb.data[i])
    const dg = Math.abs(ab.data[i + 1] - bb.data[i + 1])
    const db = Math.abs(ab.data[i + 2] - bb.data[i + 2])
    const diff = dr + dg + db > 24
    if (diff) changed++
    const o = p * 3
    if (diff) {
      out[o] = 235
      out[o + 1] = 40
      out[o + 2] = 60
    } else {
      // whitened original, so the red reads against it
      out[o] = 200 + Math.round(ab.data[i] * 0.2)
      out[o + 1] = 200 + Math.round(ab.data[i + 1] * 0.2)
      out[o + 2] = 200 + Math.round(ab.data[i + 2] * 0.2)
    }
  }
  const buf = await sharp(out, { raw: { width: CELL_W, height: CELL_H, channels: 3 } }).png().toBuffer()
  return { buf, changed }
}

function captionSvg(row, computed) {
  const verdict = row.verdict ?? 'accepted'
  const colour = /reject/i.test(verdict) ? '#ff9f43' : /accept/i.test(verdict) ? '#4ade80' : '#93c5fd'
  const metrics = [
    row.diffPixels != null ? `${row.diffPixels} px` : null,
    row.diffRatio != null ? `ratio ${row.diffRatio}` : null,
    computed != null ? `${computed} px changed (computed overlay)` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return Buffer.from(`<svg width="${SHEET_W}" height="${CAPTION_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#101317"/>
  <text x="4" y="16" font-family="monospace" font-size="13" fill="#e5e7eb">${escape(row.name)}</text>
  <text x="4" y="31" font-family="monospace" font-size="11" fill="#9ca3af">${escape(row.spec ?? '')}  ${escape(metrics)}</text>
  <text x="4" y="43" font-family="monospace" font-size="11" fill="${colour}">${escape(verdict)}${row.note ? ' — ' + escape(row.note) : ''}</text>
</svg>`)
}

function headerSvg(text) {
  return Buffer.from(`<svg width="${SHEET_W}" height="34" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#101317"/>
  <text x="4" y="15" font-family="monospace" font-size="13" fill="#e5e7eb">${escape(text)}</text>
  <text x="4" y="29" font-family="monospace" font-size="11" fill="#9ca3af">expected (committed)   |   actual (captured)   |   diff — red = changed</text>
</svg>`)
}

const index = []
for (let s = 0; s * ROWS_PER_SHEET < rows.length; s++) {
  const slice = rows.slice(s * ROWS_PER_SHEET, (s + 1) * ROWS_PER_SHEET)
  const height = PAD + 34 + GAP + slice.length * ROW_H + PAD
  const composites = [{ input: headerSvg(`${TITLE} — sheet ${s + 1}`), top: PAD, left: PAD }]
  for (let r = 0; r < slice.length; r++) {
    const row = slice[r]
    const top = PAD + 34 + GAP + r * ROW_H
    const [exp, act] = await Promise.all([cell(row.expected), cell(row.actual)])
    let diffBuf
    let computed = null
    if (row.diff) {
      diffBuf = await cell(row.diff)
    } else {
      const c = await computedDiff(row.expected, row.actual)
      diffBuf = c.buf
      computed = c.changed
    }
    composites.push(
      { input: exp, top, left: PAD },
      { input: act, top, left: PAD + CELL_W + GAP },
      { input: diffBuf, top, left: PAD + (CELL_W + GAP) * 2 },
      { input: captionSvg(row, computed), top: top + CELL_H, left: PAD },
    )
    index.push({ sheet: s + 1, row: r + 1, ...row, computedOverlay: computed != null })
  }
  const file = join(outDir, `sheet-${String(s + 1).padStart(2, '0')}.jpg`)
  await sharp({
    create: { width: SHEET_W + PAD * 2, height, channels: 3, background: '#101317' },
  })
    .composite(composites)
    .jpeg({ quality: 82 })
    .toFile(file)
  console.log(`wrote ${file} (${slice.length} rows)`)
}

writeFileSync(
  join(outDir, 'sheets.json'),
  JSON.stringify({ title: TITLE, cell: [CELL_W, CELL_H], rowsPerSheet: ROWS_PER_SHEET, rows: index }, null, 2) + '\n',
)
console.log(`wrote ${join(outDir, 'sheets.json')} — ${rows.length} rows over ${Math.ceil(rows.length / ROWS_PER_SHEET)} sheet(s)`)
console.log(`source images: ${[...new Set(rows.map((r) => basename(r.expected)))].length} distinct baselines`)
