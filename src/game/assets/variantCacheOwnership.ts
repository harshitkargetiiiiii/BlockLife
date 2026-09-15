import type * as THREE from 'three'
import type { VariantCacheSnapshot } from './variantMaterialCache'

/**
 * Issue #67 — ownership-aware attribution for the shared variant-material cache.
 *
 * Issue #25's Stage A gate asserted that the cache held ZERO keys, because no GLB placement used it yet. Approved
 * office projections now legitimately share one immutable tinted set, so "zero" is obsolete — and a bare nonzero
 * count proves nothing either way. This module replaces the count with attribution:
 *
 *   - every actual key must be one of the combinations DERIVED from authored, loadable projections and declared slot
 *     names (`variantCacheExpectations.ts`), never from whatever happens to be observed;
 *   - each key holds exactly its declared slot materials, each allocated once;
 *   - a mesh rendering a cached material must sit inside the mounted model of a placement that projects onto that key
 *     with that asset — wherever in the scene the mesh is;
 *   - a projected placement whose model is mounted must render the ONE shared material for every declared name;
 *   - across a remount a key keeps the same material identities and no key appears.
 *
 * Whether a model is mounted is read from explicit branch evidence — the DEV marker `LandmarkAsset` puts on each
 * instance's cloned GLB root — never inferred from material names. A key with no current consumer is VALID: the cache
 * is process-lifetime by design, so membership outlives its last mounted placement. Positive sharing is a separate
 * question (`consumersOfVariantCacheKey`) a caller asks only after deliberately mounting consumers.
 *
 * Pure data in, problems out: no THREE import at runtime, no cache access, no mutation.
 */

/** `userData` key LandmarkAsset sets, in DEV only, on each instance's own cloned GLB root (never the shared source). */
export const LANDMARK_GLB_ROOT_MARKER = 'landmarkGlbAssetId'
/** Usage placement id for a mesh under no authored placement group. */
export const UNPLACED = '(unplaced)'
/** Usage asset id for a mesh under no `asset:<id>` slot group. */
export const NO_ASSET_SLOT = '(no-asset-slot)'

export interface VariantCacheExpectation {
  readonly key: string
  readonly assetId: string
  /** Distinct declared slot material names, sorted: exactly the materials the shared set must hold. */
  readonly materialNames: readonly string[]
  /** Authored placements whose projection resolves to this combination, sorted. */
  readonly placementIds: readonly string[]
}

export interface VariantCacheUsageMaterial {
  readonly name: string
  /** The material the mesh renders when not faded: an active occlusion fade clone is resolved back to its original. */
  readonly uuid: string
  /** Present only when the mesh is currently showing an occlusion fade clone of `uuid`. */
  readonly fadeCloneUuid?: string
  /** True when the mesh sits under a marked GLB root (a mounted model), false for fallback or foreign geometry. */
  readonly inModel: boolean
}

export interface VariantCacheUsage {
  readonly placementId: string
  readonly assetId: string
  /** Asset ids carried by marked GLB roots under this slot: the actual mounted-model evidence, sorted. */
  readonly modelAssetIds: readonly string[]
  /** Distinct materials, sorted. Every material for a scanned slot; only cached materials for anything else. */
  readonly materials: readonly VariantCacheUsageMaterial[]
}

export type VariantCacheProblemCode =
  | 'stats-mismatch'
  | 'duplicate-key'
  | 'duplicate-expectation'
  | 'duplicate-usage'
  | 'unknown-key'
  | 'forbidden-asset-key'
  | 'unexpected-material'
  | 'missing-material'
  | 'duplicate-material'
  | 'unknown-owner'
  | 'forbidden-owner'
  | 'cached-material-outside-model'
  | 'wrong-asset-usage'
  | 'missing-material-usage'
  | 'missing-key'
  | 'uncached-projected-material'
  | 'removed-key'
  | 'rebuilt-key'
  | 'added-key'
  | 'unknown-added-key'

export interface VariantCacheProblem {
  readonly code: VariantCacheProblemCode
  readonly key?: string
  readonly placementId?: string
  readonly detail: string
}

export interface VariantCacheOwnershipInput {
  readonly stats: { readonly keys: number; readonly materials: number }
  readonly snapshot: VariantCacheSnapshot
  readonly usage: readonly VariantCacheUsage[]
  readonly expectations: readonly VariantCacheExpectation[]
  /** Assets that must never own a shared entry nor render a cached material, whatever the expectations say. */
  readonly noCacheAssetIds: readonly string[]
}

const assetOfKey = (key: string) => key.split('|')[0]
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function sortProblems(problems: VariantCacheProblem[]): VariantCacheProblem[] {
  const s = (p: VariantCacheProblem) => `${p.code}\u0000${p.key ?? ''}\u0000${p.placementId ?? ''}\u0000${p.detail}`
  return problems.sort((a, b) => cmp(s(a), s(b)))
}

function repeated(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out = new Set<string>()
  for (const v of values) (seen.has(v) ? out : seen).add(v)
  return [...out]
}

/** Strict attribution of one cache state and the scene that renders it. An empty result is the only pass. */
export function checkVariantCacheOwnership(input: VariantCacheOwnershipInput): VariantCacheProblem[] {
  const { stats, snapshot, usage, expectations, noCacheAssetIds } = input
  const problems: VariantCacheProblem[] = []

  // Duplicates are detected on the raw lists, before anything is keyed into a Map that would silently merge them.
  for (const key of repeated(snapshot.entries.map((e) => e.key))) problems.push({ code: 'duplicate-key', key, detail: 'key listed more than once' })
  for (const key of repeated(expectations.map((e) => e.key))) problems.push({ code: 'duplicate-expectation', key, detail: 'expectation listed more than once' })
  for (const id of repeated(expectations.flatMap((e) => e.placementIds))) problems.push({ code: 'duplicate-expectation', placementId: id, detail: 'placement expected under more than one key' })
  for (const pair of repeated(usage.map((u) => `${u.placementId}\u0000${u.assetId}`))) {
    const [placementId, assetId] = pair.split('\u0000')
    problems.push({ code: 'duplicate-usage', placementId, detail: `${assetId} slot reported more than once` })
  }

  const entryMaterials = snapshot.entries.reduce((n, e) => n + e.materials.length, 0)
  if (stats.keys !== snapshot.entries.length || stats.materials !== entryMaterials || snapshot.keys !== snapshot.entries.length || snapshot.materials !== entryMaterials) {
    problems.push({ code: 'stats-mismatch', detail: `stats ${stats.keys}/${stats.materials}, snapshot ${snapshot.keys}/${snapshot.materials}, entries ${snapshot.entries.length}/${entryMaterials}` })
  }

  const expectedByKey = new Map(expectations.map((e) => [e.key, e]))
  const expectedByPlacement = new Map(expectations.flatMap((e) => e.placementIds.map((id) => [id, e] as const)))
  const cachedByUuid = new Map<string, { key: string; name: string }>()
  const cachedUuid = new Map<string, string>() // `${key}\0${name}` -> uuid
  const presentKeys = new Set(snapshot.entries.map((e) => e.key))

  for (const entry of snapshot.entries) {
    const { key } = entry
    if (noCacheAssetIds.includes(assetOfKey(key))) problems.push({ code: 'forbidden-asset-key', key, detail: `${assetOfKey(key)} must never own a shared variant entry` })
    for (const name of repeated(entry.materials.map((m) => m.name))) problems.push({ code: 'duplicate-material', key, detail: `"${name}" allocated more than once for this key` })
    for (const m of entry.materials) {
      const other = cachedByUuid.get(m.uuid)
      if (other) problems.push({ code: 'duplicate-material', key, detail: `material ${m.uuid} is also cached under ${other.key}` })
      else cachedByUuid.set(m.uuid, { key, name: m.name })
      if (!cachedUuid.has(`${key}\u0000${m.name}`)) cachedUuid.set(`${key}\u0000${m.name}`, m.uuid)
    }
    const exp = expectedByKey.get(key)
    if (!exp) {
      problems.push({ code: 'unknown-key', key, detail: `not derived from any loadable authored projection with declared slots (${entry.materials.length} materials)` })
      continue
    }
    const names = new Set(entry.materials.map((m) => m.name))
    for (const name of names) if (!exp.materialNames.includes(name)) problems.push({ code: 'unexpected-material', key, detail: `"${name}" is not a declared slot material` })
    for (const name of exp.materialNames) if (!names.has(name)) problems.push({ code: 'missing-material', key, detail: `declared slot material "${name}" is not in the shared set` })
  }

  for (const record of usage) {
    const exp = expectedByPlacement.get(record.placementId)

    // Who renders a cached material — anywhere in the scene, under any asset or none.
    for (const m of record.materials) {
      const cached = cachedByUuid.get(m.uuid)
      if (!cached) continue
      if (noCacheAssetIds.includes(record.assetId)) problems.push({ code: 'forbidden-owner', key: cached.key, placementId: record.placementId, detail: `${record.assetId} renders cached "${m.name}"` })
      else if (!exp || exp.key !== cached.key || exp.assetId !== record.assetId) problems.push({ code: 'unknown-owner', key: cached.key, placementId: record.placementId, detail: `${record.assetId} renders cached "${m.name}" but does not project onto this key` })
      else if (!m.inModel) problems.push({ code: 'cached-material-outside-model', key: cached.key, placementId: record.placementId, detail: `cached "${m.name}" rendered outside a mounted ${exp.assetId} model` })
    }

    if (!exp) continue
    if (record.assetId !== exp.assetId) {
      problems.push({ code: 'wrong-asset-usage', key: exp.key, placementId: record.placementId, detail: `slot renders ${record.assetId}, projection resolves ${exp.assetId}` })
      continue
    }
    for (const foreign of record.modelAssetIds.filter((id) => id !== exp.assetId)) {
      problems.push({ code: 'wrong-asset-usage', key: exp.key, placementId: record.placementId, detail: `mounted model root is marked ${foreign}, projection resolves ${exp.assetId}` })
    }
    // No marked root of this asset: the slot shows its loading/failed fallback. Materials are not consulted for that.
    if (!record.modelAssetIds.includes(exp.assetId)) continue
    const modelMaterials = record.materials.filter((m) => m.inModel)
    for (const name of exp.materialNames) {
      const uuids = [...new Set(modelMaterials.filter((m) => m.name === name).map((m) => m.uuid))]
      if (uuids.length === 0) {
        problems.push({ code: 'missing-material-usage', key: exp.key, placementId: record.placementId, detail: `mounted model renders no material named "${name}"` })
        continue
      }
      if (uuids.length > 1) problems.push({ code: 'duplicate-material', key: exp.key, placementId: record.placementId, detail: `"${name}" rendered with ${uuids.length} distinct materials` })
      if (!presentKeys.has(exp.key)) {
        problems.push({ code: 'missing-key', key: exp.key, placementId: record.placementId, detail: 'projected model is mounted but its shared set was never built' })
        continue
      }
      for (const uuid of uuids) {
        if (uuid !== cachedUuid.get(`${exp.key}\u0000${name}`)) problems.push({ code: 'uncached-projected-material', key: exp.key, placementId: record.placementId, detail: `"${name}" renders private material ${uuid}` })
      }
    }
  }

  return sortProblems(problems)
}

/** Placements whose MOUNTED model currently renders at least one material cached under `key` (positive sharing evidence). */
export function consumersOfVariantCacheKey(snapshot: VariantCacheSnapshot, usage: readonly VariantCacheUsage[], key: string): string[] {
  const uuids = new Set(snapshot.entries.filter((e) => e.key === key).flatMap((e) => e.materials.map((m) => m.uuid)))
  return [...new Set(usage.filter((u) => u.materials.some((m) => m.inModel && uuids.has(m.uuid))).map((u) => u.placementId))].sort(cmp)
}

/**
 * Remount identity: every key present before must still hold the SAME material identities after, and — unless the
 * caller explicitly allows newly mounted content — no key may appear. A newly appearing key that is not derived from
 * an authored projection is always a failure.
 */
export function compareVariantCacheSnapshots(
  before: VariantCacheSnapshot,
  after: VariantCacheSnapshot,
  expectations: readonly VariantCacheExpectation[],
  options: { readonly allowAddedExpectedKeys?: boolean } = {},
): VariantCacheProblem[] {
  const problems: VariantCacheProblem[] = []
  for (const key of repeated(before.entries.map((e) => e.key))) problems.push({ code: 'duplicate-key', key, detail: 'listed more than once before' })
  for (const key of repeated(after.entries.map((e) => e.key))) problems.push({ code: 'duplicate-key', key, detail: 'listed more than once after' })
  const identity = (e: VariantCacheSnapshot['entries'][number]) => e.materials.map((m) => `${m.name}=${m.uuid}`).sort(cmp).join(',')
  const afterByKey = new Map(after.entries.map((e) => [e.key, e]))
  const beforeKeys = new Set(before.entries.map((e) => e.key))
  for (const entry of before.entries) {
    const next = afterByKey.get(entry.key)
    if (!next) problems.push({ code: 'removed-key', key: entry.key, detail: 'key disappeared from a process-lifetime cache' })
    else if (identity(next) !== identity(entry)) problems.push({ code: 'rebuilt-key', key: entry.key, detail: `[${identity(entry)}] became [${identity(next)}]` })
  }
  const expectedKeys = new Set(expectations.map((e) => e.key))
  for (const entry of after.entries) {
    if (beforeKeys.has(entry.key)) continue
    if (!expectedKeys.has(entry.key)) problems.push({ code: 'unknown-added-key', key: entry.key, detail: 'appeared and is not derived from any authored projection' })
    else if (!options.allowAddedExpectedKeys) problems.push({ code: 'added-key', key: entry.key, detail: 'appeared across a remount of the same content' })
  }
  return sortProblems(problems)
}

/**
 * Plain-data usage scan, read on demand. One record per `asset:<id>` slot of a scanned asset (every material, even
 * with no mesh at all), plus one record per slot or placement — of ANY asset, or of no asset slot — whose meshes render
 * a cached material (only those materials). Model mounting comes from the `LANDMARK_GLB_ROOT_MARKER` on a cloned GLB
 * root between the mesh and its slot. A mesh showing an occlusion fade clone is resolved back to the original it
 * restores (occlusion is never disabled for this). Returns strings only — no scene reference escapes.
 */
export function collectVariantCacheUsage(
  root: THREE.Object3D | null,
  options: {
    readonly placementIds: ReadonlySet<string>
    /** Slots recorded in full. Everything else is recorded only where it renders a cached material. */
    readonly assetIds: ReadonlySet<string>
    readonly cachedUuids: ReadonlySet<string>
    /** Active fade clone uuid → the original material uuid its mesh restores to. */
    readonly fadeOriginalByUuid?: ReadonlyMap<string, string>
  },
): VariantCacheUsage[] {
  if (!root) return []
  interface Acc { placementId: string; assetId: string; full: boolean; modelAssetIds: Set<string>; materials: Map<string, VariantCacheUsageMaterial> }
  const records = new Map<unknown, Acc>()
  const placementOf = (node: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = node; p; p = p.parent) if (options.placementIds.has(p.name)) return p.name
    return UNPLACED
  }

  root.traverse((node) => {
    if (!node.name.startsWith('asset:')) return
    const assetId = node.name.slice('asset:'.length)
    if (!options.assetIds.has(assetId)) return
    const acc: Acc = { placementId: placementOf(node), assetId, full: true, modelAssetIds: new Set(), materials: new Map() }
    // Marked roots are gathered from the slot itself, not from material-bearing meshes: a mounted model whose meshes or
    // materials are gone is still a mounted model, and must then fail its declared materials rather than pass as fallback.
    node.traverse((d) => {
      const marker = d.userData?.[LANDMARK_GLB_ROOT_MARKER]
      if (typeof marker === 'string') acc.modelAssetIds.add(marker)
    })
    records.set(node, acc)
  })

  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    let slot: THREE.Object3D | null = null
    let modelAssetId: string | null = null
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) {
      const marker = p.userData?.[LANDMARK_GLB_ROOT_MARKER]
      if (modelAssetId === null && typeof marker === 'string') modelAssetId = marker
      if (p.name.startsWith('asset:')) {
        slot = p
        break
      }
    }
    const placementId = placementOf(slot ?? mesh)
    const recordKey = slot ?? `${UNPLACED}\u0000${placementId}`
    let acc = records.get(recordKey)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue
      const original = options.fadeOriginalByUuid?.get(material.uuid)
      const uuid = original ?? material.uuid
      if (!acc?.full && !options.cachedUuids.has(uuid)) continue
      if (!acc) {
        acc = { placementId, assetId: slot ? slot.name.slice('asset:'.length) : NO_ASSET_SLOT, full: false, modelAssetIds: new Set(), materials: new Map() }
        records.set(recordKey, acc)
      }
      const entry: VariantCacheUsageMaterial = original
        ? { name: material.name, uuid, fadeCloneUuid: material.uuid, inModel: modelAssetId !== null }
        : { name: material.name, uuid, inModel: modelAssetId !== null }
      acc.materials.set(`${uuid}\u0000${entry.fadeCloneUuid ?? ''}\u0000${entry.inModel}`, Object.freeze(entry))
    }
    if (acc && modelAssetId !== null) acc.modelAssetIds.add(modelAssetId)
  })

  return [...records.values()]
    .map((acc) => Object.freeze({
      placementId: acc.placementId,
      assetId: acc.assetId,
      modelAssetIds: Object.freeze([...acc.modelAssetIds].sort(cmp)),
      materials: Object.freeze([...acc.materials.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.uuid, b.uuid) || cmp(a.fadeCloneUuid ?? '', b.fadeCloneUuid ?? '') || Number(a.inModel) - Number(b.inModel))),
    }))
    .sort((a, b) => cmp(a.placementId, b.placementId) || cmp(a.assetId, b.assetId))
}
