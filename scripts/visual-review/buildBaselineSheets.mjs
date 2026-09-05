/**
 * Contact sheets for baselines that have NO predecessor — the new-image half of a migration.
 *
 * `buildContactSheets.mjs` lays out `expected | actual | diff` triplets, which is the right shape
 * for adjudicating a CHANGED baseline. A brand-new baseline has nothing to compare against, so the
 * review question is different: does this frame show what the test claims? That needs the frames
 * side by side with their names, densely enough to actually look at all of them.
 *
 *   node scripts/visual-review/buildBaselineSheets.mjs <snapshotDir> <outDir> [--title "..."] [--cols 3] [--rows 5]
 */
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'

const [dir, outDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const title = arg('title', 'new baselines')
const COLS = Number(arg('cols', 3))
const ROWS = Number(arg('rows', 5))
if (!dir || !outDir) { console.error('usage: buildBaselineSheets.mjs <snapshotDir> <outDir>'); process.exit(1) }

const CELL_W = 420, CAP_H = 24, PAD = 10, HEADER = 44
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
if (!files.length) { console.error(`no PNGs in ${dir}`); process.exit(1) }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const svgText = (w, h, text, size, weight, fill, bg) =>
  Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<text x="6" y="${h / 2 + size / 3}" font-family="ui-monospace,Menlo,monospace" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text></svg>`)

mkdirSync(outDir, { recursive: true })
const perSheet = COLS * ROWS
const sheets = []
for (let s = 0; s * perSheet < files.length; s++) {
  const slice = files.slice(s * perSheet, (s + 1) * perSheet)
  const first = await sharp(join(dir, slice[0])).metadata()
  const cellH = Math.round((first.height / first.width) * CELL_W)
  const rows = Math.ceil(slice.length / COLS)
  const W = COLS * CELL_W + (COLS + 1) * PAD
  const H = HEADER + rows * (cellH + CAP_H + PAD) + PAD
  const layers = [{ input: svgText(W, HEADER, `${title} — sheet ${s + 1}/${Math.ceil(files.length / perSheet)} (${slice.length} images)`, 17, 700, '#111', '#e8e8ea'), top: 0, left: 0 }]
  for (let i = 0; i < slice.length; i++) {
    const cx = i % COLS, cy = Math.floor(i / COLS)
    const left = PAD + cx * (CELL_W + PAD)
    const top = HEADER + PAD + cy * (cellH + CAP_H + PAD)
    layers.push({ input: await sharp(join(dir, slice[i])).resize(CELL_W).toBuffer(), top, left })
    const name = basename(slice[i]).replace(/-chromium-darwin\.png$/, '')
    layers.push({ input: svgText(CELL_W, CAP_H, name, 12, 600, '#111', '#d4d4d8'), top: top + cellH, left })
  }
  const file = join(outDir, `new-${String(s + 1).padStart(2, '0')}.jpg`)
  await sharp({ create: { width: W, height: H, channels: 3, background: '#fafafa' } })
    .composite(layers).jpeg({ quality: 82 }).toFile(file)
  console.log(`wrote ${file} (${slice.length} images)`)
  sheets.push({ file: basename(file), images: slice.map((f) => basename(f)) })
}
writeFileSync(join(outDir, 'sheets.json'), JSON.stringify({ title, total: files.length, sheets }, null, 1))
console.log(`wrote ${join(outDir, 'sheets.json')} — ${files.length} images over ${sheets.length} sheet(s)`)
