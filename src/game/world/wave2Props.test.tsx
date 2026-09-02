import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { Props } from './Props'
import { STREET_PROP_ASSET_IDS } from './propAssetIds'
import { ASSET_MANIFEST_BY_ID } from '../assets/assetManifest'

/**
 * Issue #42 Wave 2 — the RENDER-TREE half of the prop contract, which the byte-level
 * `wave2Contract.test.ts` cannot see:
 *
 *  - a successful GLB load renders exactly ONE visible body (the model), never the model plus
 *    the procedural prop it replaced;
 *  - a missing/corrupt GLB renders the COMPLETE original procedural prop;
 *  - a streetlight keeps its FUNCTIONAL night illumination on both branches — on the GLB body at
 *    the model's own measured lantern, on the fallback at the procedural pole's bulb height.
 */

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

/** A stand-in for a loaded model: one named group holding one mesh, like every Wave 2 GLB. */
function glbScene(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'glb-root'
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
  return root
}

/** One authored placement per target type — the real ids from cityLayout. */
const CASES = [
  { type: 'street_lamp', placementId: 'prop_street_lamp_01', assetId: STREET_PROP_ASSET_IDS.street_lamp!, fallbackMesh: 'street_lamp-pole' },
  { type: 'hydrant', placementId: 'prop_hydrant_01', assetId: STREET_PROP_ASSET_IDS.hydrant!, fallbackMesh: 'hydrant-fallback' },
  { type: 'trash_can', placementId: 'prop_trash_can_01', assetId: STREET_PROP_ASSET_IDS.trash_can!, fallbackMesh: 'trash_can-fallback' },
] as const

async function renderProp(placementId: string) {
  return ReactThreeTestRenderer.create(<Props only={[placementId]} kiosk={false} />)
}

/** The three.js object for an authored placement group. */
function placementObject(
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
  placementId: string,
): THREE.Object3D {
  const node = renderer.scene.findAll((n) => n.props.name === placementId)[0]
  expect(node, `placement group ${placementId}`).toBeTruthy()
  return node.instance as THREE.Object3D
}

function countNamed(root: THREE.Object3D, name: string): number {
  let n = 0
  root.traverse((o) => { if (o.name === name) n++ })
  return n
}

beforeEach(() => {
  useGLTFMock.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('issue #42 Wave 2 — one prop body renders, never two', () => {
  for (const { type, placementId, assetId, fallbackMesh } of CASES) {
    it(`${type}: a loaded GLB replaces the procedural body — no duplicate prop`, async () => {
      useGLTFMock.mockReturnValue({ scene: glbScene() })
      const renderer = await renderProp(placementId)
      const group = placementObject(renderer, placementId)

      // The placement group still exists under its authored id, and the archetype slot is inside it.
      expect(countNamed(group, `asset:${assetId}`), `${type} asset slot`).toBe(1)
      // The model mounted...
      expect(countNamed(group, 'glb-root'), `${type} GLB body`).toBe(1)
      // ...and the procedural body it replaced is GONE. Rendering both is the "duplicate prop"
      // defect issue #42 rules out.
      expect(countNamed(group, fallbackMesh), `${type} procedural body must not double up`).toBe(0)
      await renderer.unmount()
    })

    it(`${type}: a failed GLB renders the COMPLETE original procedural prop`, async () => {
      useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
      const renderer = await renderProp(placementId)
      const group = placementObject(renderer, placementId)
      expect(countNamed(group, 'glb-root'), `${type} no model`).toBe(0)
      expect(countNamed(group, fallbackMesh), `${type} procedural body`).toBe(1)
      await renderer.unmount()
    })
  }
})

describe('issue #42 Wave 2 — the streetlight keeps its functional night illumination', () => {
  it('the GLB body carries the bulb + ground pool, positioned on ITS OWN lantern', async () => {
    useGLTFMock.mockReturnValue({ scene: glbScene() })
    const renderer = await renderProp('prop_street_lamp_01')
    const group = placementObject(renderer, 'prop_street_lamp_01')

    expect(countNamed(group, 'glb-root'), 'model mounted').toBe(1)
    // Exactly one bulb and one ground pool — the light is a bounded sibling, not a second lamp.
    expect(countNamed(group, 'street_lamp-bulb'), 'one bulb').toBe(1)
    expect(countNamed(group, 'street_lamp-glow'), 'one ground pool').toBe(1)
    // ...and no procedural pole or lantern geometry is retained alongside the model.
    expect(countNamed(group, 'street_lamp-pole'), 'no duplicate pole').toBe(0)

    const light = ASSET_MANIFEST_BY_ID.get(STREET_PROP_ASSET_IDS.street_lamp!)!.nightLight!
    const bulb = group.getObjectByName('street_lamp-bulb')!
    expect(bulb.position.toArray(), 'bulb sits on the model’s lantern').toEqual(light.position)
    // The shared 0.26 sphere is SCALED to the lantern rather than a second geometry being allocated.
    expect(bulb.scale.x, 'bulb scaled to the lantern').toBeCloseTo(light.bulbRadius / 0.26, 6)
    // The pool still lies on the ground under the prop, exactly where it always has.
    const glow = group.getObjectByName('street_lamp-glow')!
    expect(glow.position.toArray()).toEqual([0, 0.09, 0])
    await renderer.unmount()
  })

  it('a failed GLB restores the complete lamp — pole AND its original light', async () => {
    useGLTFMock.mockImplementation(() => { throw new Error('404 model not found') })
    const renderer = await renderProp('prop_street_lamp_01')
    const group = placementObject(renderer, 'prop_street_lamp_01')

    expect(countNamed(group, 'street_lamp-pole'), 'pole restored').toBe(1)
    expect(countNamed(group, 'street_lamp-bulb'), 'bulb restored').toBe(1)
    expect(countNamed(group, 'street_lamp-glow'), 'ground pool restored').toBe(1)
    // Byte-for-byte the pre-Wave-2 lamp: bulb at the top of the 3.8-unit pole, unit-scaled.
    const bulb = group.getObjectByName('street_lamp-bulb')!
    expect(bulb.position.toArray()).toEqual([0, 3.85, 0])
    expect(bulb.scale.toArray()).toEqual([1, 1, 1])
    await renderer.unmount()
  })
})
