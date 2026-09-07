import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh'
import { NodeIO } from '@gltf-transform/core'
import { ASSET_MANIFEST_BY_ID } from './assetManifest'
import { wheelNodeTransform } from './maskedPaint'
import { WHEEL_STYLES } from '../vehicles/vehicleCustomization'

/**
 * Issue #50 — the derived wheel pivots must not drive the tyre through the bodywork.
 *
 * Ground contact and arch clearance are different questions and the first does not imply the
 * second: a scaled wheel lifted back onto the road can still pass through the wing above it. The
 * only honest test is the geometry itself, so this reads the SHIPPED bytes, composes each wheel
 * node's real transform with the runtime's own `wheelNodeTransform`, and counts actual
 * triangle/triangle intersections against the body.
 *
 * It gates the declaration in both directions. The declared `maxWheelRadiusScale` must CLEAR (zero
 * intersections at every wheel) and must be TIGHT (the next step up collides), so it cannot be
 * quietly lowered to a value that trivially passes, and the advertised off-road radius cannot be
 * quietly restored.
 */

const GLB = 'public/assets/models/vehicles/sports_car_01.glb'
const ENTRY = ASSET_MANIFEST_BY_ID.get('vehicle_sports_car_01')!
const MASK = ENTRY.paintMask!

interface Part {
  name: string
  geometry: THREE.BufferGeometry
}

async function loadParts(radialScale: number): Promise<{ body: Part; wheels: Part[] }> {
  const doc = await new NodeIO().readBinary(new Uint8Array(readFileSync(GLB)))
  const radii = new Map(MASK.wheelNodes.map((w) => [w.name, w.radius]))
  const parts: Part[] = []
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const primitive = mesh.listPrimitives()[0]
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(primitive.getAttribute('POSITION')!.getArray()!), 3),
    )
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(primitive.getIndices()!.getArray()!), 1))
    const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix())
    const radius = radii.get(node.getName())
    if (radius !== undefined) {
      // EXACTLY what the renderer does, so this measures the shipped transform and not a
      // reimplementation of it.
      const { scale, liftY } = wheelNodeTransform(radius, radialScale, Infinity)
      matrix.elements[13] += liftY
      matrix.multiply(new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]))
    }
    geometry.applyMatrix4(matrix)
    geometry.computeBoundingBox()
    parts.push({ name: node.getName(), geometry })
  }
  const body = parts.find((p) => !radii.has(p.name))!
  return { body, wheels: parts.filter((p) => radii.has(p.name)) }
}

function intersectingPairs(body: THREE.BufferGeometry, wheel: THREE.BufferGeometry): number {
  const bodyBvh = new MeshBVH(body)
  const wheelBvh = new MeshBVH(wheel)
  let pairs = 0
  const segment = new THREE.Line3()
  bodyBvh.bvhcast(wheelBvh, new THREE.Matrix4(), {
    // `bvhcast` offers CANDIDATE pairs whose bounds overlap; the real triangle/triangle test has to
    // happen here, and only a non-degenerate intersection segment counts. Counting the candidates
    // instead reported 26,205 "intersections" on a body that touches nothing.
    intersectsTriangles(a: ExtendedTriangle, b: ExtendedTriangle) {
      if (a.intersectsTriangle(b, segment) && segment.distance() > 1e-9) pairs++
      return false
    },
  })
  return pairs
}

async function totalIntersections(radialScale: number): Promise<Record<string, number>> {
  const { body, wheels } = await loadParts(radialScale)
  const out: Record<string, number> = {}
  for (const wheel of wheels) out[wheel.name] = intersectingPairs(body.geometry, wheel.geometry)
  return out
}

describe('issue #50 — a wheel style may not push the tyre through the bodywork', () => {
  it('clears completely at the authored size', async () => {
    const hits = await totalIntersections(1)
    expect(Object.values(hits).reduce((a, b) => a + b, 0), `per wheel: ${JSON.stringify(hits)}`).toBe(0)
  })

  it('clears completely at the declared maximum', async () => {
    const hits = await totalIntersections(MASK.maxWheelRadiusScale)
    expect(
      Object.values(hits).reduce((a, b) => a + b, 0),
      `maxWheelRadiusScale ${MASK.maxWheelRadiusScale}, per wheel: ${JSON.stringify(hits)}`,
    ).toBe(0)
  })

  it('is TIGHT — one step larger already collides', async () => {
    // Without this the declaration could be lowered until it passed trivially, which would hide the
    // limitation rather than bound it.
    const hits = await totalIntersections(MASK.maxWheelRadiusScale + 0.01)
    expect(Object.values(hits).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it('records WHY the advertised off-road radius is not rendered at full size', async () => {
    const offroad = WHEEL_STYLES.find((w) => w.id === 'wheels_offroad')!
    expect(offroad.radiusScale, 'the style still asks for 1.18 — gameplay values are unchanged').toBe(1.18)
    expect(offroad.radiusScale).toBeGreaterThan(MASK.maxWheelRadiusScale)
    const hits = await totalIntersections(offroad.radiusScale)
    // This is the measurement behind the clamp: rendering the advertised size puts hundreds of
    // wheel triangles inside the body.
    expect(Object.values(hits).reduce((a, b) => a + b, 0)).toBeGreaterThan(500)
  })

  it('clamps every shipped wheel style to what this body can hold, and keeps them on the road', () => {
    for (const style of WHEEL_STYLES) {
      const declared = MASK.wheelNodes[0]
      const { scale, liftY, clamped } = wheelNodeTransform(declared.radius, style.radiusScale, MASK.maxWheelRadiusScale)
      expect(scale[0], `${style.id} radial scale`).toBeLessThanOrEqual(MASK.maxWheelRadiusScale)
      expect(scale[2], `${style.id} axle width unchanged`).toBe(1)
      // Ground contact, independently of clearance: centre + lift - scaled radius is back at 0.
      expect(declared.radius + liftY - declared.radius * scale[0], `${style.id} contact patch`).toBeCloseTo(0, 12)
      expect(clamped, `${style.id} clamped?`).toBe(style.radiusScale > MASK.maxWheelRadiusScale)
    }
  })
})
