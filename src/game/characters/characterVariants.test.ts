import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyCharacterVariants,
  bodyBuildScale,
  BODY_BUILDS,
  BODY_BUILD_KEYS,
  HAIR_VARIANTS,
  ACCESSORY_VARIANTS,
} from './characterMaterials'
import { appearanceForSeed, appearanceForId, NAMED_IDENTITIES } from './populationAppearance'
import type { CharacterAppearance } from './characterTypes'
import { NPC_DEFS } from '../../data/npcs'

/**
 * Issue #23 / PR #24 blocking-1: real GEOMETRY variants (body silhouette, hairstyle,
 * accessory TYPE) — not just colour. Proves the choices are deterministic, mutually
 * compatible (one shown, rest hidden; recolor untouched), and visibly distinct.
 */
const base: CharacterAppearance = { shirtColor: '#fff', pantsColor: '#000', accentColor: '#111' }

function makeRig(): THREE.Group {
  const g = new THREE.Group()
  for (const v of ['short', 'long', 'bun']) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    m.name = `person_hair__${v}`
    g.add(m)
  }
  for (const v of ['scarf', 'glasses', 'bag']) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    m.name = `person_accessory__${v}`
    g.add(m)
  }
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  shirt.name = 'person_shirt'
  g.add(shirt)
  return g
}
const shown = (g: THREE.Group, prefix: string) =>
  g.children.filter((c) => c.name.startsWith(prefix) && c.visible).map((c) => c.name)

describe('character geometry variants (issue #23 / PR #24 blocking-1)', () => {
  it('shows exactly the chosen hair + accessory mesh, hides the rest, leaves others alone', () => {
    const g = makeRig()
    applyCharacterVariants(g, { ...base, hairVariant: 'long', accessoryVariant: 'bag' })
    expect(shown(g, 'person_hair__')).toEqual(['person_hair__long'])
    expect(shown(g, 'person_accessory__')).toEqual(['person_accessory__bag'])
    expect(g.getObjectByName('person_shirt')!.visible).toBe(true) // non-variant untouched
  })

  it('defaults to short / scarf when unspecified', () => {
    const g = makeRig()
    applyCharacterVariants(g, base)
    expect(shown(g, 'person_hair__')).toEqual(['person_hair__short'])
    expect(shown(g, 'person_accessory__')).toEqual(['person_accessory__scarf'])
  })

  it('bald / none hide the whole group', () => {
    const g = makeRig()
    applyCharacterVariants(g, { ...base, hairVariant: 'bald', accessoryVariant: 'none' })
    expect(shown(g, 'person_hair__')).toEqual([])
    expect(shown(g, 'person_accessory__')).toEqual([])
  })

  it('bodyBuildScale composes a positive silhouette (defaults to average)', () => {
    expect(bodyBuildScale(base)).toEqual(BODY_BUILDS.average)
    expect(bodyBuildScale({ ...base, bodyBuild: 'broad' })).toEqual(BODY_BUILDS.broad)
    for (const k of BODY_BUILD_KEYS) expect(BODY_BUILDS[k].every((n) => n > 0)).toBe(true)
  })

  it('appearanceForSeed fills all three geometry axes from the valid sets, deterministically', () => {
    const a = appearanceForSeed(4242)
    expect(HAIR_VARIANTS).toContain(a.hairVariant)
    expect(ACCESSORY_VARIANTS).toContain(a.accessoryVariant)
    expect(BODY_BUILD_KEYS).toContain(a.bodyBuild)
    expect(appearanceForId('cit_zzz')).toEqual(appearanceForId('cit_zzz'))
  })

  it('the crowd is visibly distinct — many silhouette/hair/accessory combos across the seeds', () => {
    const combos = new Set(
      Array.from({ length: 200 }, (_, i) => {
        const a = appearanceForSeed(i * 2654435761)
        return `${a.bodyBuild}|${a.hairVariant}|${a.accessoryVariant}`
      }),
    )
    expect(combos.size).toBeGreaterThan(20)
  })

  it('every named NPC has valid geometry variants and the cast is visibly distinct', () => {
    for (const def of NPC_DEFS) {
      const a = NAMED_IDENTITIES[def.id]
      expect(HAIR_VARIANTS).toContain(a.hairVariant)
      expect(ACCESSORY_VARIANTS).toContain(a.accessoryVariant)
      expect(BODY_BUILD_KEYS).toContain(a.bodyBuild)
    }
    const hairs = new Set(NPC_DEFS.map((d) => NAMED_IDENTITIES[d.id].hairVariant))
    const accs = new Set(NPC_DEFS.map((d) => NAMED_IDENTITIES[d.id].accessoryVariant))
    const builds = new Set(NPC_DEFS.map((d) => NAMED_IDENTITIES[d.id].bodyBuild))
    expect(hairs.size).toBeGreaterThanOrEqual(2)
    expect(accs.size).toBeGreaterThanOrEqual(3)
    expect(builds.size).toBeGreaterThanOrEqual(3)
  })
})
