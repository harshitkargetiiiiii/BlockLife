import { afterEach, describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { VehicleAsset } from './VehicleAsset'
import { ASSET_MANIFEST_BY_ID, type AssetManifestEntry } from './assetManifest'
import { VEHICLE_DEFS } from '../vehicles/vehicleRegistry'
import { VehicleVisual } from '../vehicles/VehicleVisual'
import { registry } from '../world/runtimeRegistry'

const useGLTFMock = vi.hoisted(() => vi.fn())
vi.mock('@react-three/drei', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGLTF: useGLTFMock,
}))

/**
 * The paint mask (issue #50) is a real network load, exactly like the GLB above, so it is stubbed
 * exactly like the GLB above — otherwise every test driving the REAL sports manifest entry would
 * suspend forever on a URL jsdom cannot fetch, and the fallback assertions would pass for the wrong
 * reason. Only `useLoader` is replaced; the rest of the fiber module (which the test renderer
 * itself uses) is the real one.
 */
const useLoaderMock = vi.hoisted(() => {
  // ONE object for every call, as R3F's loader cache returns. Identity is the point: a mock that
  // minted a new texture per render would change the instance memo's key every render and rebuild
  // the materials behind the test's back. It is the FACTORY implementation rather than one applied
  // later, because `mockReset`/`restoreAllMocks` restores exactly this.
  const shared = {}
  return vi.fn(() => shared)
})
vi.mock('@react-three/fiber', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLoader: useLoaderMock,
}))

function vehicleEntry(overrides: Partial<AssetManifestEntry>): AssetManifestEntry {
  return {
    id: 'vehicle_compact_car_01',
    label: 'Test car',
    category: 'vehicles',
    glbPath: 'assets/models/vehicles/compact_sedan_01.glb',
    fallbackKey: 'CarMesh',
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    positionOffset: [0, 0, 0],
    attribution: null,
    license: null,
    enabled: true,
    materialSlots: { paint: ['body'], wheel: ['tire'] },
    ...overrides,
  }
}

function Fallback() {
  return <mesh name="carmesh-fallback" />
}

afterEach(() => {
  useGLTFMock.mockReset()
  useLoaderMock.mockReset()
  vi.restoreAllMocks()
})

describe('VehicleAsset (R3F, §5 one-shell GLB adapter)', () => {
  it('renders the CarMesh fallback when the class has no asset id', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={null} paint="#3aa6a0">
        <Fallback />
      </VehicleAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
    expect(useGLTFMock).not.toHaveBeenCalled()
    await renderer.unmount()
  })

  it('renders the fallback when the entry is disabled', async () => {
    // A class whose manifest entry is disabled keeps the CarMesh (injected here so
    // the test is independent of whether the real compact ships a GLB yet).
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#3aa6a0" entry={vehicleEntry({ enabled: false })}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
    expect(useGLTFMock).not.toHaveBeenCalled()
    await renderer.unmount()
  })

  it('projects the GLB and paints the body slot when enabled', async () => {
    const glbScene = new THREE.Group()
    glbScene.name = 'car-root'
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ name: 'body', color: '#ffffff' }),
    )
    glbScene.add(body)
    useGLTFMock.mockReturnValue({ scene: glbScene })

    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#ff0000" entry={vehicleEntry({})}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(useGLTFMock).toHaveBeenCalledWith(expect.stringContaining('compact_sedan_01.glb'))
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(0)
    // The cloned body material carries the requested paint (isolated, not the source).
    const root = renderer.scene
      .findAll((n) => (n.instance as THREE.Object3D)?.name === 'car-root')[0]
      .instance as THREE.Group
    let painted = ''
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m?.name === 'body') painted = m.color.getHexString()
    })
    expect(painted).toBe('ff0000')
    await renderer.unmount()
  })

  it('falls back to CarMesh (and warns dev-only) when the GLB fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useGLTFMock.mockImplementation(() => {
      throw new Error('404 model not found')
    })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#3aa6a0" entry={vehicleEntry({})}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vehicle_compact_car_01'), expect.any(Error))
    await renderer.unmount()
  })

  it('feeds the shared settle counters so assetsSettled() stays honest', async () => {
    const glbScene = new THREE.Group()
    glbScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'body' })))
    useGLTFMock.mockReturnValue({ scene: glbScene })
    const expected0 = registry.glbLandmarksExpected
    const active0 = registry.glbLandmarksActive
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId="vehicle_compact_car_01" paint="#3aa6a0" entry={vehicleEntry({})}>
        <Fallback />
      </VehicleAsset>,
    )
    expect(registry.glbLandmarksExpected).toBe(expected0 + 1)
    expect(registry.glbLandmarksActive).toBe(active0 + 1)
    await renderer.unmount()
    // Symmetric teardown — counters return to baseline (no leak across streaming).
    expect(registry.glbLandmarksExpected).toBe(expected0)
    expect(registry.glbLandmarksActive).toBe(active0)
  })
})

/**
 * Issue #40 Wave 1 §"Missing-file tests prove each class falls back to CarMesh".
 *
 * Every owned vehicle class now ships a real GLB body, so the fallback contract has to hold
 * PER CLASS, not just for the one class that happened to have a model first. These drive the
 * REAL manifest entries — not a synthetic fixture — so enabling a class without a working
 * file, or renaming a path, is caught here rather than as a hole in the world.
 */
describe('every owned vehicle class falls back to CarMesh when its GLB is missing (issue #40)', () => {
  const classes = VEHICLE_DEFS.map((d) => ({ defId: d.id, assetId: d.assetId! }))

  it('covers all four dealership classes', () => {
    expect(classes.map((c) => c.defId).sort()).toEqual(['veh_compact', 'veh_scooter', 'veh_sports', 'veh_van'])
    for (const c of classes) expect(ASSET_MANIFEST_BY_ID.get(c.assetId), `${c.defId} manifest entry`).toBeTruthy()
  })

  for (const { defId, assetId } of VEHICLE_DEFS.map((d) => ({ defId: d.id, assetId: d.assetId! }))) {
    it(`${defId}: a missing/failed ${assetId} model still renders the shell`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // Exactly what a deleted or 404ing file does inside useGLTF's suspense path.
      useGLTFMock.mockImplementation(() => {
        throw new Error(`404 ${assetId} not found`)
      })
      const renderer = await ReactThreeTestRenderer.create(
        <VehicleAsset assetId={assetId} paint="#3aa6a0" entry={ASSET_MANIFEST_BY_ID.get(assetId)}>
          <Fallback />
        </VehicleAsset>,
      )
      expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(assetId), expect.any(Error))
      await renderer.unmount()
    })
  }
})

/**
 * Issue #40 Codex review, finding 1 — no duplicate fittings on the GLB path.
 *
 * Every approved Wave 1 body contains its own wheels and lights in its single baked mesh, so the
 * unconditional procedural `CarFittings` sibling drew a second full set on top: four oversized
 * car wheels on a two-wheeled scooter, and headlight/taillight boxes over baked ones. These
 * assert the render tree itself, per branch, so the defect cannot come back silently.
 *
 * Counting rule: the procedural wheel is the only mesh built from a CylinderGeometry, and the
 * headlight/taillight boxes are the only ones using the shared light materials — so the branch
 * can be identified structurally rather than by name.
 */
describe('GLB bodies do not get duplicate procedural wheels or lights (issue #40)', () => {
  const wheels = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
    r.scene.findAll((n) => {
      const g = (n.instance as THREE.Mesh)?.geometry as THREE.BufferGeometry | undefined
      return g?.type === 'CylinderGeometry'
    }).length
  const taillights = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
    r.scene.findAll((n) => (n.instance as THREE.Object3D)?.name === 'taillight').length
  const occupants = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
    r.scene.findAll((n) => {
      const g = (n.instance as THREE.Mesh)?.geometry as THREE.BufferGeometry | undefined
      return g?.type === 'SphereGeometry'
    }).length

  function glbScene() {
    const g = new THREE.Group()
    g.name = 'glb-body'
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'baked_atlas' })))
    return g
  }

  it('the procedural fallback keeps the COMPLETE fittings — four wheels and both taillights', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId={null} color="#3aa6a0" showDriver showPassenger />,
    )
    expect(wheels(renderer), 'fallback wheels').toBe(4)
    expect(taillights(renderer), 'fallback taillights').toBe(2)
    expect(occupants(renderer), 'fallback occupants').toBe(2)
    await renderer.unmount()
  })

  it('a mounted GLB body adds NO procedural wheels or lights, but keeps its occupants', async () => {
    useGLTFMock.mockReturnValue({ scene: glbScene() })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId="vehicle_utility_van_01" color="#3aa6a0" showDriver showPassenger />,
    )
    // The model's own wheels and lamps are inside its mesh — nothing procedural may be layered
    // on top, or the render is a multi-wheel hybrid with a second pair of tail lamps.
    expect(wheels(renderer), 'no duplicate wheels over a GLB body').toBe(0)
    expect(taillights(renderer), 'no duplicate tail lamps over a GLB body').toBe(0)
    // ...but the one fitting the model genuinely lacks survives.
    expect(occupants(renderer), 'occupants kept').toBe(2)
    expect(renderer.scene.findAll((n) => (n.instance as THREE.Object3D)?.name === 'glb-body')).toHaveLength(1)
    await renderer.unmount()
  })

  it('a FAILED GLB falls back to the complete set — a broken model never yields a wheelless car', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useGLTFMock.mockImplementation(() => {
      throw new Error('404 model not found')
    })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId="vehicle_utility_van_01" color="#3aa6a0" showDriver />,
    )
    expect(wheels(renderer), 'fallback restores the wheels').toBe(4)
    expect(taillights(renderer), 'fallback taillights').toBe(2)
    await renderer.unmount()
  })

  it('a baked-atlas body is not tinted, while the fallback shell still paints', async () => {
    const scene = glbScene()
    useGLTFMock.mockReturnValue({ scene })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleVisual assetId="vehicle_utility_van_01" color="#ff0000" showDriver={false} />,
    )
    const root = renderer.scene
      .findAll((n) => (n.instance as THREE.Object3D)?.name === 'glb-body')[0]
      .instance as THREE.Group
    let tinted: string | null = null
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m?.name === 'baked_atlas') tinted = m.color.getHexString()
    })
    // White = untouched. Applying the paint here would recolor windows, lights and tyres too.
    expect(tinted, 'the baked atlas keeps its source paint').toBe('ffffff')
    await renderer.unmount()
  })
})

/**
 * Issue #50 — the derived-segmentation path, driven through the REAL manifest entry.
 *
 * These cover the three things the mechanism can get wrong in ways a screenshot of one car would
 * not reveal: two instances of one file quietly sharing a material, a wheel transform that
 * accumulates across style changes, and the fallback chain silently changing shape now that a
 * second file (the mask) is part of the GLB branch.
 */
describe('issue #50 — masked paint and wheel styles on the derived sports body', () => {
  const SPORTS = 'vehicle_sports_car_01'
  const sportsEntry = () => ASSET_MANIFEST_BY_ID.get(SPORTS)!

  /** A stand-in shaped like the file the intake step actually writes. */
  function derivedScene() {
    const root = new THREE.Group()
    root.name = 'sports-root'
    const atlas = new THREE.Texture()
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'paint_body' }))
    ;(body.material as THREE.MeshStandardMaterial).map = atlas
    const bodyNode = new THREE.Group()
    bodyNode.name = 'body'
    bodyNode.add(body)
    root.add(bodyNode)
    for (const w of sportsEntry().paintMask!.wheelNodes) {
      const node = new THREE.Group()
      node.name = w.name
      node.position.set(0, w.radius, 0)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'paint_wheel' }))
      ;(mesh.material as THREE.MeshStandardMaterial).map = atlas
      node.add(mesh)
      root.add(node)
    }
    return root
  }

  const materialsNamed = (
    r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
    name: string,
  ): THREE.MeshStandardMaterial[] => {
    const found: THREE.MeshStandardMaterial[] = []
    for (const node of r.scene.findAll((n) => (n.instance as THREE.Object3D)?.name === 'sports-root')) {
      ;(node.instance as THREE.Object3D).traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        // The source material keeps its authored name through the clone, so this finds both the
        // untouched and the masked ones — which is the point: the masked one must have replaced it.
        if (m && m.name === name && !found.includes(m)) found.push(m)
      })
    }
    return found
  }

  const uniformsOf = (m: THREE.MeshStandardMaterial) => {
    const shader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: '#include <map_pars_fragment>\n#include <map_fragment>', vertexShader: '' }
    m.onBeforeCompile!(shader as never, null as never)
    return shader.uniforms
  }

  it('paints the body without a material slot, and leaves the wheel material a separate target', async () => {
    useGLTFMock.mockImplementation(() => ({ scene: derivedScene() }))
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={SPORTS} paint="#2c2c33" wheelHub="#c9ccd1" entry={sportsEntry()}>
        <Fallback />
      </VehicleAsset>,
    )
    // The empty `materialSlots` map is still in force — nothing is tinted through the §3 path.
    const body = materialsNamed(renderer, 'paint_body')
    const wheel = materialsNamed(renderer, 'paint_wheel')
    expect(body, 'one masked body material').toHaveLength(1)
    expect(wheel, 'one masked wheel material shared by the four wheels').toHaveLength(1)
    for (const m of [...body, ...wheel]) expect(m.color.getHexString(), 'no whole-material tint').toBe('ffffff')
    // ...and the recolor is carried by the uniforms instead.
    const bodyUniforms = uniformsOf(body[0])
    expect((bodyUniforms.uPaintColor.value as THREE.Color).getHexString()).toBe('2c2c33')
    expect(bodyUniforms.uPaintStrength.value).toBe(1)
    const wheelUniforms = uniformsOf(wheel[0])
    expect((wheelUniforms.uPaintColor.value as THREE.Color).getHexString()).toBe('c9ccd1')
    await renderer.unmount()
  })

  it('keeps two instances of the SAME cached source visually independent', async () => {
    // The defect this guards is the one the §3 variant system exists to prevent, reached by a
    // different route: if the masked material were not cloned per instance, painting the parked
    // car would repaint the one being driven — and the shared drei cache scene would be mutated
    // for every instance mounted afterwards.
    //
    // So the mock returns ONE scene object to both instances, exactly as `useGLTF` does. A mock
    // that builds a fresh scene per call cannot model that at all: it would pass with no cloning.
    const shared = derivedScene()
    const sourceMaterials = new Map<string, THREE.MeshStandardMaterial>()
    shared.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m && !sourceMaterials.has(m.name)) sourceMaterials.set(m.name, m)
    })
    useGLTFMock.mockImplementation(() => ({ scene: shared }))

    const a = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={SPORTS} paint="#c25b52" entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    const b = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={SPORTS} paint="#4c956c" entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    const ma = materialsNamed(a, 'paint_body')[0]
    const mb = materialsNamed(b, 'paint_body')[0]
    expect(ma).not.toBe(mb)
    expect(ma).not.toBe(sourceMaterials.get('paint_body'))
    expect((uniformsOf(ma).uPaintColor.value as THREE.Color).getHexString()).toBe('c25b52')
    expect((uniformsOf(mb).uPaintColor.value as THREE.Color).getHexString()).toBe('4c956c')

    // Repaint ONE of them and the other must not move — nor may the cached source material.
    await a.update(
      <VehicleAsset assetId={SPORTS} paint="#2c2c33" entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    expect((uniformsOf(ma).uPaintColor.value as THREE.Color).getHexString()).toBe('2c2c33')
    expect((uniformsOf(mb).uPaintColor.value as THREE.Color).getHexString()).toBe('4c956c')
    for (const [name, source] of sourceMaterials) {
      expect(source.color.getHexString(), `cached ${name} colour untouched`).toBe('ffffff')
      expect(source.onBeforeCompile, `cached ${name} program untouched`).toBe(THREE.Material.prototype.onBeforeCompile)
    }
    await a.unmount()
    await b.unmount()
  })

  it('applies a wheel style ABSOLUTELY — repeated changes do not compound', async () => {
    useGLTFMock.mockImplementation(() => ({ scene: derivedScene() }))
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={SPORTS} paint="#2c2c33" wheelScale={1} entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    const wheelNodes = () => {
      const root = renderer.scene.findAll((n) => (n.instance as THREE.Object3D)?.name === 'sports-root')[0]
        .instance as THREE.Object3D
      return sportsEntry().paintMask!.wheelNodes.map((w) => ({ decl: w, node: root.getObjectByName(w.name)! }))
    }
    for (const { node } of wheelNodes()) expect(node.scale.toArray()).toEqual([1, 1, 1])
    const baseY = wheelNodes().map(({ node }) => node.position.y)

    // Off-road, then off-road again, then back to standard — the classic compounding trap.
    await renderer.update(
      <VehicleAsset assetId={SPORTS} paint="#2c2c33" wheelScale={1.18} entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    const afterFirst = wheelNodes().map(({ node }) => [...node.scale.toArray(), node.position.y])
    await renderer.update(
      <VehicleAsset assetId={SPORTS} paint="#5b7fc2" wheelScale={1.18} entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    expect(wheelNodes().map(({ node }) => [...node.scale.toArray(), node.position.y])).toEqual(afterFirst)
    // The entry's own cap — this body's arches clear 1.04, so the advertised 1.18 is reduced to it
    // (see wheelClearance.test.ts for the measurement). The transform must apply the CAP, not the
    // request, and must still put the contact patch on the road.
    const cap = sportsEntry().paintMask!.maxWheelRadiusScale
    for (const { decl, node } of wheelNodes()) {
      expect(node.scale.toArray(), 'radial plane only, clamped to the arch').toEqual([cap, cap, 1])
      // Ground contact: centre + lift - scaled radius is back at the model's own y = 0.
      expect(node.position.y - decl.radius * cap).toBeCloseTo(0, 6)
    }
    await renderer.update(
      <VehicleAsset assetId={SPORTS} paint="#2c2c33" wheelScale={1} entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    expect(wheelNodes().map(({ node }) => node.scale.toArray())).toEqual([[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]])
    expect(wheelNodes().map(({ node }) => node.position.y), 'returns exactly to the authored pose').toEqual(baseY)
    await renderer.unmount()
  })

  it('still falls back to the complete CarMesh when the mask cannot load', async () => {
    // The mask is part of the GLB branch, so its failure has to behave like the body's: a whole
    // procedural car, not a Meshy body with no paint and not a wheelless one.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useGLTFMock.mockImplementation(() => ({ scene: derivedScene() }))
    useLoaderMock.mockImplementation(() => {
      throw new Error('404 sports_car_01_paint_mask.png not found')
    })
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={SPORTS} paint="#2c2c33" entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    expect(renderer.scene.findAll((n) => n.props.name === 'carmesh-fallback')).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(SPORTS), expect.any(Error))
    await renderer.unmount()
  })

  it('releases the branch and the counters symmetrically, mask or no mask', async () => {
    useGLTFMock.mockImplementation(() => ({ scene: derivedScene() }))
    const expected0 = registry.glbLandmarksExpected
    const active0 = registry.glbLandmarksActive
    const renderer = await ReactThreeTestRenderer.create(
      <VehicleAsset assetId={SPORTS} paint="#2c2c33" entry={sportsEntry()}><Fallback /></VehicleAsset>,
    )
    expect(registry.glbLandmarksExpected).toBe(expected0 + 1)
    expect(registry.glbLandmarksActive).toBe(active0 + 1)
    await renderer.unmount()
    expect(registry.glbLandmarksExpected).toBe(expected0)
    expect(registry.glbLandmarksActive).toBe(active0)
  })
})
