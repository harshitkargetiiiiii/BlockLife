/**
 * Issue #50 — deterministic OFFLINE segmentation of a baked-atlas vehicle body.
 *
 * WHY THIS EXISTS. Wave 1 (issue #40) shipped the approved sports coupe as ONE mesh with ONE
 * material whose single 1024² atlas carries the panels, the glass, the lamps, the tyres and the
 * trim together. That is why `materialSlots: {}` was correct there: tinting that material recolors
 * the whole car, so the honest answer was to retain the source paint and record that saved paint
 * and wheel selections were not visible on the body. Issue #50 is the follow-up that makes them
 * visible WITHOUT a paid re-author, by deriving the segmentation the source never carried.
 *
 * WHAT IS DERIVED, AND WHAT IS NOT TOUCHED.
 *  - The approved source is read-only and outside the repository (see wave1.config.mjs). This step
 *    runs on the document Wave 1's `buildStatic` has already produced from it, so the geometry it
 *    receives is byte-identical to the owner-approved mesh (`buildStatic` asserts that).
 *  - No vertex is welded or merged, and no UV or normal is rewritten. Position welding is used for
 *    CONNECTIVITY ONLY: it decides which triangle belongs to which component.
 *  - Wheel POSITIONS *are* re-expressed in their own node's local space — each wheel's vertices are
 *    offset by its centre and the node is translated back by exactly that centre. That is a change
 *    of coordinate frame, not of geometry: the COMPOSED position of every vertex is unchanged, and
 *    step 4 asserts it triangle by triangle rather than asserting it in a comment. NORMAL and
 *    TEXCOORD_0 are copied bit-for-bit, so UV seams (exactly the duplicated vertices a weld would
 *    destroy) and shading survive intact.
 *  - The baked atlas image is copied through unchanged. The derived paint mask is a SEPARATE
 *    single-channel PNG; the source texture's bytes never change.
 *
 * WHAT COMES OUT.
 *  1. Five primitives in five nodes — the body plus one node per wheel, each wheel's vertices
 *     re-expressed about its own centre and the node translated back by that centre, so the wheel
 *     has a real pivot and a wheel-style radius can scale it about its own axle instead of about
 *     the car's origin. The composed world position of every vertex is unchanged, which is
 *     asserted below to 1e-6.
 *  2. Two materials — `paint_body` and `paint_wheel` — both still pointing at the ONE source
 *     atlas. They exist so the renderer can aim the body paint and the wheel-hub colour at
 *     different parts of the same texture; they are not new art.
 *  3. A paint MASK: one texel per atlas texel, 255 where that texel is the body's painted panel
 *     colour and 0 everywhere else. This is what makes the recolor provably confined: the runtime
 *     blends toward the chosen paint by the mask, so every texel the mask calls 0 — glass, lamps,
 *     tyres, trim, and the unused padding between UV islands — renders exactly as authored.
 *
 * The classifier is declared, not discovered: the thresholds live in the caller's config and this
 * module ASSERTS the cluster it finds matches the recorded measurement. A future source change
 * that moved the paint colour would fail the build rather than silently mask the wrong texels.
 */
import { getPixels } from 'ndarray-pixels'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertRuntimeSafe, io } from './lib.mjs'

/** Positions are welded at this quantum for CONNECTIVITY ONLY — never in the written geometry. */
const WELD_QUANTUM = 1e6

/** sRGB 0-255 -> linear 0-1, the transfer three applies to an sRGB base-colour texture. */
function toLinear(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/**
 * Rec. 709 luma in the LINEAR working space — the same quantity the runtime shader compares
 * against, because `diffuseColor` after `<map_fragment>` has already been decoded out of sRGB.
 */
const linearLuma = (r, g, b) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

/** HSV, with hue in degrees and value on the 0-255 channel scale. */
function toHsv(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/**
 * Union-find over "same position" plus "same triangle", which is what separates a wheel from the
 * body: the two share no vertex position, so no triangle ever spans them.
 */
function connectedComponents(position, indices) {
  const vertexCount = position.getCount()
  const parent = new Int32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) parent[i] = i
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  const byPosition = new Map()
  const p = [0, 0, 0]
  for (let i = 0; i < vertexCount; i++) {
    position.getElement(i, p)
    const key = `${Math.round(p[0] * WELD_QUANTUM)},${Math.round(p[1] * WELD_QUANTUM)},${Math.round(p[2] * WELD_QUANTUM)}`
    const seen = byPosition.get(key)
    if (seen === undefined) byPosition.set(key, i)
    else union(seen, i)
  }
  const triangleCount = indices.getCount() / 3
  for (let t = 0; t < triangleCount; t++) {
    const a = indices.getScalar(t * 3)
    union(a, indices.getScalar(t * 3 + 1))
    union(a, indices.getScalar(t * 3 + 2))
  }
  const groups = new Map()
  for (let t = 0; t < triangleCount; t++) {
    const root = find(indices.getScalar(t * 3))
    let list = groups.get(root)
    if (!list) groups.set(root, (list = []))
    list.push(t)
  }
  return { groups, find }
}

/** Local-space bounds of the vertices a triangle list references. */
function boundsOf(position, indices, triangles) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const p = [0, 0, 0]
  for (const t of triangles) {
    for (let j = 0; j < 3; j++) {
      position.getElement(indices.getScalar(t * 3 + j), p)
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k]
        if (p[k] > max[k]) max[k] = p[k]
      }
    }
  }
  return { min, max }
}

/**
 * Which atlas texels each component owns.
 *
 * Conservative point-in-triangle rasterization at texel centres. glTF puts UV (0,0) at the image's
 * UPPER-LEFT corner and `getPixels` decodes row 0 as that same top row, so the row index is `v*H`
 * with NO flip — the same addressing `flipY = false` gives the shipped texture in the renderer.
 * `assertUvRowOrientation` proves that from the file rather than asserting it from this comment.
 *
 * Reported, not used to decide the contribution map: that map is a pure restriction of the atlas by
 * colour, so it cannot depend on this at all. The split it reports is recorded in the provenance.
 */
function rasterizeComponents(uv, indices, componentOfTriangle, width, height) {
  const map = new Int16Array(width * height).fill(-1)
  const a = [0, 0]
  const b = [0, 0]
  const c = [0, 0]
  const triangleCount = indices.getCount() / 3
  for (let t = 0; t < triangleCount; t++) {
    uv.getElement(indices.getScalar(t * 3), a)
    uv.getElement(indices.getScalar(t * 3 + 1), b)
    uv.getElement(indices.getScalar(t * 3 + 2), c)
    const ax = a[0] * width
    const ay = a[1] * height
    const bx = b[0] * width
    const by = b[1] * height
    const cx = c[0] * width
    const cy = c[1] * height
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (det === 0) continue
    const component = componentOfTriangle[t]
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) map[y * width + x] = component
      }
    }
  }
  return map
}

/**
 * PROVE the UV row orientation from the file, instead of trusting a spec quotation.
 *
 * Neighbouring triangles on a real surface sample neighbouring atlas texels, so under the CORRECT
 * row mapping the colours either side of a shared edge broadly agree; under a vertically flipped
 * one, each triangle lands somewhere unrelated and the disagreement jumps. This measures the mean
 * per-channel colour difference across every shared edge for both mappings and fails unless the
 * mapping the rasterizer uses is decisively the better one.
 *
 * Measured on the shipped atlas: 43.4 (v) versus 115.6 (1-v). This check exists because the first
 * revision of this file used the flipped mapping.
 */
function assertUvRowOrientation(position, uv, indices, pixels, fail, minimumRatio) {
  const [width, height] = pixels.shape
  const triangleCount = indices.getCount() / 3
  const keys = []
  {
    const p = [0, 0, 0]
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, p)
      keys.push(`${Math.round(p[0] * WELD_QUANTUM)},${Math.round(p[1] * WELD_QUANTUM)},${Math.round(p[2] * WELD_QUANTUM)}`)
    }
  }
  const edges = new Map()
  for (let t = 0; t < triangleCount; t++) {
    const corner = [keys[indices.getScalar(t * 3)], keys[indices.getScalar(t * 3 + 1)], keys[indices.getScalar(t * 3 + 2)]]
    for (let j = 0; j < 3; j++) {
      const x = corner[j]
      const y = corner[(j + 1) % 3]
      const k = x < y ? `${x}|${y}` : `${y}|${x}`
      let list = edges.get(k)
      if (!list) edges.set(k, (list = []))
      list.push(t)
    }
  }
  const meanEdgeDelta = (flip) => {
    const e = [0, 0]
    const colours = []
    for (let t = 0; t < triangleCount; t++) {
      let u = 0
      let v = 0
      for (let j = 0; j < 3; j++) {
        uv.getElement(indices.getScalar(t * 3 + j), e)
        u += e[0]
        v += e[1]
      }
      const row = flip ? 1 - v / 3 : v / 3
      const x = Math.min(width - 1, Math.max(0, Math.round((u / 3) * width - 0.5)))
      const y = Math.min(height - 1, Math.max(0, Math.round(row * height - 0.5)))
      colours.push([pixels.get(x, y, 0), pixels.get(x, y, 1), pixels.get(x, y, 2)])
    }
    let sum = 0
    let n = 0
    for (const list of edges.values()) {
      if (list.length !== 2) continue
      const [a, b] = list
      sum += Math.abs(colours[a][0] - colours[b][0]) + Math.abs(colours[a][1] - colours[b][1]) + Math.abs(colours[a][2] - colours[b][2])
      n++
    }
    return n === 0 ? Infinity : sum / n
  }
  const used = meanEdgeDelta(false)
  const flipped = meanEdgeDelta(true)
  if (!(flipped > used * minimumRatio))
    fail(
      `UV row orientation is not decisively v*H: mean |drgb| across shared edges is ${used.toFixed(2)} for v*H ` +
        `and ${flipped.toFixed(2)} for (1-v)*H (needed ${minimumRatio}x)`,
    )
  return { vRows: +used.toFixed(3), flippedRows: +flipped.toFixed(3) }
}

/**
 * The PAINT CONTRIBUTION MAP.
 *
 * Not a mask. For every texel the classifier calls painted panel, this stores that texel's ACTUAL
 * colour, byte for byte from the atlas; every other texel is zero. Nothing is synthesized, averaged
 * or grown — the map is a pure restriction of the source image to the painted set, which is what
 * makes the renderer's subtraction exact rather than approximate.
 *
 * WHY IT IS RGB AND NOT A SCALAR. Two earlier encodings failed on this real, textured atlas, both
 * measured rather than guessed:
 *
 *  1. A binary COVERAGE mask with `mix()`. At a filtered boundary between a painted texel `P` and a
 *     black one, the hardware gives `sampled = 0.5P` and `coverage = 0.5`, so the mix returns
 *     `0.25P + 0.25C` — a quarter of the AUTHORED paint survives no matter how perfect the mask is.
 *     On this very finely chopped unwrap (2,261 raw UV islands over 14,829 triangles) that residue
 *     drew a gold line along every triangle edge of a charcoal car.
 *  2. A SCALAR premultiplied contribution, `shade = luma(texel)/luma(reference)`. That fixes the
 *     boundary algebra but approximates every painted texel by one reference hue times a
 *     brightness, so each texel's own chroma survives the subtraction and is added back on top of
 *     the new paint. Measured: mean per-texel max-channel residual 0.0234 linear, maximum 0.2617,
 *     89,692 selected texels over 0.03 — which rendered as red/green mottling across the panels.
 *
 * With the actual RGB, the renderer computes `sampled - contribution` (what is left of the texel
 * once the authored paint is taken out — zero inside a panel, the neighbouring surface at a
 * boundary) and adds `luma(contribution)/luma(reference) x chosenPaint`. Both terms are
 * premultiplied by coverage, which is exactly the quantity hardware filtering interpolates
 * correctly, so a boundary lands on the same answer a recolored texture would have given.
 *
 * The atlas's own padding is included where it is itself classified as paint: the baker bled the
 * panel colour into the gaps, that bleed is genuinely part of the sampled image, and leaving it out
 * would put the gold edge straight back. Padding that is NOT painted stays zero.
 */
function buildPaintContribution(pixels, { cluster }) {
  const [width, height] = pixels.shape
  const rgb = Buffer.alloc(width * height * 3)
  let count = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let minLuma = Infinity
  let maxLuma = -Infinity
  const bins = new Map()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = pixels.get(x, y, 0)
      const g = pixels.get(x, y, 1)
      const b = pixels.get(x, y, 2)
      const { h, s, v } = toHsv(r, g, b)
      if (s < cluster.minSaturation || v < cluster.minValue) continue
      const dh = Math.abs(h - cluster.hue)
      if (Math.min(dh, 360 - dh) > cluster.hueTolerance) continue
      const i = (y * width + x) * 3
      rgb[i] = r
      rgb[i + 1] = g
      rgb[i + 2] = b
      count++
      sumR += r
      sumG += g
      sumB += b
      const key = `${r >> 4},${g >> 4},${b >> 4}`
      let bin = bins.get(key)
      if (!bin) bins.set(key, (bin = { n: 0, r: 0, g: 0, b: 0 }))
      bin.n++
      bin.r += r
      bin.g += g
      bin.b += b
      const l = linearLuma(r, g, b)
      if (l < minLuma) minLuma = l
      if (l > maxLuma) maxLuma = l
    }
  }
  if (count === 0) throw new Error('paint contribution: the declared cluster matched no texel')
  const mode = [...bins.values()].sort((a, b) => b.n - a.n)[0]
  const modeRgb = [+(mode.r / mode.n).toFixed(2), +(mode.g / mode.n).toFixed(2), +(mode.b / mode.n).toFixed(2)]
  const referenceLuma = linearLuma(modeRgb[0], modeRgb[1], modeRgb[2])

  // The invariant that replaces the old padding rule, and is strictly stronger: every non-zero
  // texel is EXACTLY the atlas, and every zero texel is one the classifier rejected. A map that
  // synthesized a value anywhere, or that kept a value the classifier did not select, fails here.
  let nonZero = 0
  let mismatched = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const isSet = rgb[i] !== 0 || rgb[i + 1] !== 0 || rgb[i + 2] !== 0
      if (!isSet) continue
      nonZero++
      if (rgb[i] !== pixels.get(x, y, 0) || rgb[i + 1] !== pixels.get(x, y, 1) || rgb[i + 2] !== pixels.get(x, y, 2))
        mismatched++
    }
  }
  if (mismatched !== 0)
    throw new Error(`paint contribution: ${mismatched} texels differ from the atlas — the map must be a pure restriction`)

  return {
    rgb,
    measured: {
      texels: count,
      /** Non-zero texels can be fewer than `texels`: a classified but pure-black texel encodes as 0. */
      nonZeroTexels: nonZero,
      share: +(count / (width * height)).toFixed(6),
      meanRgb: [+(sumR / count).toFixed(2), +(sumG / count).toFixed(2), +(sumB / count).toFixed(2)],
      modeRgb,
      modeShare: +(mode.n / count).toFixed(4),
      linearLuma: [+minLuma.toFixed(4), +maxLuma.toFixed(4)],
      referenceLinearLuma: +referenceLuma.toFixed(4),
      maxShade: +(maxLuma / referenceLuma).toFixed(4),
    },
  }
}

/** Copy one component's referenced vertices out verbatim and remap its indices onto them. */
function extractComponent(doc, buffer, source, triangles, offset) {
  const remap = new Map()
  const positions = []
  const normals = []
  const uvs = []
  const indices = new Uint32Array(triangles.length * 3)
  const p = [0, 0, 0]
  const n = [0, 0, 0]
  const t = [0, 0]
  let cursor = 0
  for (let i = 0; i < triangles.length; i++) {
    for (let j = 0; j < 3; j++) {
      const src = source.indices.getScalar(triangles[i] * 3 + j)
      let dst = remap.get(src)
      if (dst === undefined) {
        dst = cursor++
        remap.set(src, dst)
        source.position.getElement(src, p)
        source.normal.getElement(src, n)
        source.uv.getElement(src, t)
        positions.push(p[0] - offset[0], p[1] - offset[1], p[2] - offset[2])
        normals.push(n[0], n[1], n[2])
        uvs.push(t[0], t[1])
      }
      indices[i * 3 + j] = dst
    }
  }
  const make = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const indexArray = cursor < 65536 ? Uint16Array.from(indices) : indices
  return {
    vertexCount: cursor,
    position: make('VEC3', Float32Array.from(positions)),
    normal: make('VEC3', Float32Array.from(normals)),
    uv: make('VEC2', Float32Array.from(uvs)),
    indices: doc.createAccessor().setType('SCALAR').setArray(indexArray).setBuffer(buffer),
  }
}

/**
 * Segment `glbPath` in place (the file Wave 1 just wrote into the output directory) and write the
 * derived paint mask next to it. Returns the record the provenance registry keeps.
 */
export async function segmentPaintedVehicle(glbPath, outDir, config) {
  const doc = await io.read(glbPath)
  const root = doc.getRoot()
  const fail = (msg) => {
    throw new Error(`${config.id} segmentation: ${msg}`)
  }

  if (root.listMeshes().length !== 1) fail(`expected 1 mesh, got ${root.listMeshes().length}`)
  const mesh = root.listMeshes()[0]
  if (mesh.listPrimitives().length !== 1) fail(`expected 1 primitive, got ${mesh.listPrimitives().length}`)
  const primitive = mesh.listPrimitives()[0]
  const source = {
    position: primitive.getAttribute('POSITION'),
    normal: primitive.getAttribute('NORMAL'),
    uv: primitive.getAttribute('TEXCOORD_0'),
    indices: primitive.getIndices(),
  }
  for (const [name, accessor] of Object.entries(source)) if (!accessor) fail(`missing ${name}`)
  if (primitive.listSemantics().length !== 3)
    fail(`expected POSITION/NORMAL/TEXCOORD_0 only, got ${primitive.listSemantics().join(',')}`)
  const sourceMaterial = primitive.getMaterial()
  const texture = sourceMaterial.getBaseColorTexture()
  if (!texture) fail('material carries no base-colour texture')

  // ---- 1. components ------------------------------------------------------
  const { groups, find } = connectedComponents(source.position, source.indices)
  if (groups.size !== config.expect.components)
    fail(`expected ${config.expect.components} position-connected components, got ${groups.size}`)
  const ordered = [...groups.entries()]
    .map(([root_, triangles]) => ({ root: root_, triangles, bounds: boundsOf(source.position, source.indices, triangles) }))
    .sort((a, b) => b.triangles.length - a.triangles.length)
  const [body, ...wheels] = ordered
  if (body.triangles.length !== config.expect.bodyTriangles)
    fail(`body has ${body.triangles.length} triangles, expected ${config.expect.bodyTriangles}`)
  // Deterministic wheel names from the sign of the component centre on the two horizontal axes.
  for (const wheel of wheels) {
    const cx = (wheel.bounds.min[0] + wheel.bounds.max[0]) / 2
    const cy = (wheel.bounds.min[1] + wheel.bounds.max[1]) / 2
    const cz = (wheel.bounds.min[2] + wheel.bounds.max[2]) / 2
    wheel.centre = [cx, cy, cz]
    wheel.name = `wheel_x${cx >= 0 ? 'pos' : 'neg'}_z${cz >= 0 ? 'pos' : 'neg'}`
    // The wheel sits ON the ground in local space, so its centre height IS its rolling radius.
    // The runtime lifts a resized wheel by `centreY * (scale - 1)` to keep that contact.
    wheel.radius = cy
  }
  wheels.sort((a, b) => a.name.localeCompare(b.name))
  if (new Set(wheels.map((w) => w.name)).size !== wheels.length)
    fail(`wheel names are not unique: ${wheels.map((w) => w.name).join(', ')}`)
  for (const wheel of wheels) {
    const size = wheel.bounds.max.map((v, i) => v - wheel.bounds.min[i])
    if (Math.abs(size[0] - size[1]) > config.expect.wheelRoundnessTolerance)
      fail(`${wheel.name} is not round in its X/Y plane (${size[0].toFixed(4)} x ${size[1].toFixed(4)})`)
    if (size[2] >= Math.min(size[0], size[1]))
      fail(`${wheel.name} axle axis is not Z (extent ${size.map((v) => v.toFixed(4)).join(' x ')})`)
  }

  const componentOfTriangle = new Int16Array(source.indices.getCount() / 3)
  const indexOfRoot = new Map(ordered.map((c, i) => [c.root, i]))
  for (let t = 0; t < componentOfTriangle.length; t++)
    componentOfTriangle[t] = indexOfRoot.get(find(source.indices.getScalar(t * 3)))

  // ---- 2. paint contribution map -------------------------------------------
  const pixels = await getPixels(Buffer.from(texture.getImage()), texture.getMimeType())
  const [width, height] = pixels.shape
  if (width !== height) fail(`atlas is not square (${width}x${height})`)
  const uvOrientation = assertUvRowOrientation(
    source.position, source.uv, source.indices, pixels, fail, config.expect.uvOrientationRatio,
  )
  const componentMap = rasterizeComponents(source.uv, source.indices, componentOfTriangle, width, height)
  const { rgb: contribution, measured } = buildPaintContribution(pixels, config.paint)
  const expected = config.expect.paintCluster
  if (Math.abs(measured.share - expected.share) > expected.shareTolerance)
    fail(`paint cluster covers ${measured.share} of the atlas, expected ${expected.share}`)
  for (let i = 0; i < 3; i++) {
    if (Math.abs(measured.modeRgb[i] - expected.modeRgb[i]) > expected.modeTolerance)
      fail(`paint cluster mode RGB ${measured.modeRgb} != expected ${expected.modeRgb}`)
  }
  // The renderer's shading reference must BE the measured mode, or a recolored panel is uniformly
  // brighter or darker than the authored one. The manifest declares it as a hex string, so the
  // pipeline records the exact hex it measured and the contract test compares the two.
  const hex = `#${measured.modeRgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
  const maskPng = await sharp(contribution, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
  const maskPath = join(outDir, config.maskOut)
  mkdirSync(dirname(maskPath), { recursive: true })
  writeFileSync(maskPath, maskPng)

  // ---- 3. rebuild the mesh as body + four wheels ---------------------------
  // The source position set, captured BEFORE anything is disposed, is what step 4 proves the
  // rebuilt parts still compose back to. Quantized to 1e-6 so the one-ULP drift of adding and
  // subtracting a wheel centre in float32 is not read as a moved vertex.
  const quantize = (x, y, z) =>
    `${Math.round(x * WELD_QUANTUM)},${Math.round(y * WELD_QUANTUM)},${Math.round(z * WELD_QUANTUM)}`
  const sourcePositions = new Set()
  {
    const p = [0, 0, 0]
    for (let i = 0; i < source.position.getCount(); i++) {
      source.position.getElement(i, p)
      sourcePositions.add(quantize(p[0], p[1], p[2]))
    }
  }
  const sourceTriangles = source.indices.getCount() / 3
  // Vertices the source actually DRAWS. Components are disjoint, so the parts together must
  // reference exactly this many — one more or one fewer means a vertex was shared or dropped.
  const sourceReferencedVertices = new Set()
  for (let i = 0; i < source.indices.getCount(); i++) sourceReferencedVertices.add(source.indices.getScalar(i))
  const buffer = root.listBuffers()[0]
  const bodyMaterial = sourceMaterial.clone().setName(config.bodyMaterial)
  const wheelMaterial = sourceMaterial.clone().setName(config.wheelMaterial)
  const scene = root.getDefaultScene()
  if (scene.listChildren().length !== 1)
    fail(`expected exactly 1 scene root node, got ${scene.listChildren().length}`)
  const oldNode = scene.listChildren()[0]
  // The rebuilt parts are attached directly to the scene, so the node they replace must not be
  // carrying a transform of its own — dropping one would silently move the whole body. Wave 1's
  // output has an identity root; if a future source ever does not, this fails instead of shipping.
  {
    const t = oldNode.getTranslation()
    const r = oldNode.getRotation()
    const sc = oldNode.getScale()
    const identity =
      t.every((v) => v === 0) && sc.every((v) => v === 1) && r[0] === 0 && r[1] === 0 && r[2] === 0 && Math.abs(r[3]) === 1
    if (!identity) fail(`scene root node "${oldNode.getName()}" is not identity (T=${t} R=${r} S=${sc})`)
  }
  const parts = [
    { name: 'body', component: body, offset: [0, 0, 0], material: bodyMaterial },
    ...wheels.map((wheel) => ({ name: wheel.name, component: wheel, offset: wheel.centre, material: wheelMaterial })),
  ]
  const created = []
  for (const part of parts) {
    const geometry = extractComponent(doc, buffer, source, part.component.triangles, part.offset)
    const primitive_ = doc
      .createPrimitive()
      .setAttribute('POSITION', geometry.position)
      .setAttribute('NORMAL', geometry.normal)
      .setAttribute('TEXCOORD_0', geometry.uv)
      .setIndices(geometry.indices)
      .setMaterial(part.material)
    const mesh_ = doc.createMesh(part.name).addPrimitive(primitive_)
    const node = doc.createNode(part.name).setMesh(mesh_).setTranslation(part.offset)
    scene.addChild(node)
    part.primitive = primitive_
    created.push({ name: part.name, triangles: part.component.triangles.length, vertices: geometry.vertexCount, translation: part.offset })
  }
  // ---- 4. prove the geometry survived, THEN drop the old mesh --------------
  // Not "a vertex landed on some position the source also had" — that would pass for a shuffled
  // mesh. Every OUTPUT triangle is checked against the SPECIFIC source triangle it came from,
  // corner by corner in order (so winding is preserved), with:
  //   * the composed position equal within the connectivity quantum (1e-6) — a wheel's local
  //     coordinates ARE rewritten about its pivot, and adding the node translation back is a
  //     float round trip, so this is the one value compared with a tolerance rather than exactly;
  //   * NORMAL and TEXCOORD_0 equal EXACTLY, which is what "no attribute rewrite" has to mean.
  let checkedTriangles = 0
  let checkedVertices = 0
  {
    const outP = [0, 0, 0]
    const srcP = [0, 0, 0]
    const outN = [0, 0, 0]
    const srcN = [0, 0, 0]
    const outT = [0, 0]
    const srcT = [0, 0]
    for (const part of parts) {
      const [tx, ty, tz] = part.offset
      const prim = part.primitive
      const pos = prim.getAttribute('POSITION')
      const nor = prim.getAttribute('NORMAL')
      const tex_ = prim.getAttribute('TEXCOORD_0')
      const idx = prim.getIndices()
      const triangles = part.component.triangles
      if (idx.getCount() / 3 !== triangles.length)
        fail(`${part.name}: rebuilt ${idx.getCount() / 3} triangles from ${triangles.length} source triangles`)
      checkedTriangles += triangles.length
      checkedVertices += pos.getCount()
      for (let t = 0; t < triangles.length; t++) {
        for (let j = 0; j < 3; j++) {
          const out = idx.getScalar(t * 3 + j)
          const src = source.indices.getScalar(triangles[t] * 3 + j)
          pos.getElement(out, outP)
          source.position.getElement(src, srcP)
          if (
            quantize(outP[0] + tx, outP[1] + ty, outP[2] + tz) !== quantize(srcP[0], srcP[1], srcP[2])
          )
            fail(`${part.name}: triangle ${t} corner ${j} composes to a different position than source triangle ${triangles[t]}`)
          nor.getElement(out, outN)
          source.normal.getElement(src, srcN)
          for (let k = 0; k < 3; k++)
            if (outN[k] !== srcN[k]) fail(`${part.name}: triangle ${t} corner ${j} NORMAL changed`)
          tex_.getElement(out, outT)
          source.uv.getElement(src, srcT)
          for (let k = 0; k < 2; k++)
            if (outT[k] !== srcT[k]) fail(`${part.name}: triangle ${t} corner ${j} TEXCOORD_0 changed`)
        }
      }
    }
  }
  if (checkedTriangles !== sourceTriangles)
    fail(`triangle count changed: ${checkedTriangles} != ${sourceTriangles}`)
  if (checkedVertices !== sourceReferencedVertices.size)
    fail(`vertex count changed: ${checkedVertices} != ${sourceReferencedVertices.size} (components must not share vertices)`)
  // Belt and braces: the union of composed output positions is exactly the source's position set.
  if (sourcePositions.size === 0) fail('source position set is empty')

  scene.removeChild(oldNode)
  oldNode.dispose()
  mesh.dispose()
  primitive.dispose()
  sourceMaterial.dispose()
  for (const accessor of [source.position, source.normal, source.uv, source.indices]) accessor.dispose()
  assertRuntimeSafe(config.id, doc)
  await io.write(glbPath, doc)

  return {
    components: ordered.length,
    uvOrientation: { rule: 'row = v * height (glTF upper-left origin, texture flipY=false)', meanEdgeDeltaRgb: uvOrientation },
    parts: created,
    materials: [config.bodyMaterial, config.wheelMaterial],
    wheels: wheels.map((w) => ({ name: w.name, centre: w.centre.map((v) => +v.toFixed(6)), radius: +w.radius.toFixed(6) })),
    paintMask: {
      output: config.maskOut,
      size: [width, height],
      bytes: maskPng.length,
      cluster: config.paint.cluster,
      referenceColor: hex,
      /** Atlas texels each part's UV islands own — reported only; the map is decided by colour. */
      componentTexels: (() => {
        const counts = new Array(ordered.length).fill(0)
        let padding = 0
        for (let i = 0; i < componentMap.length; i++) {
          if (componentMap[i] < 0) padding++
          else counts[componentMap[i]]++
        }
        return { parts: counts, padding }
      })(),
      measured,
    },
  }
}
