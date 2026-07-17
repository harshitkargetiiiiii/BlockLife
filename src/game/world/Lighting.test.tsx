import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'
import { Lighting } from './Lighting'

async function lightStateAt(hour: number) {
  const renderer = await ReactThreeTestRenderer.create(<Lighting hourOverride={hour} />)
  await ReactThreeTestRenderer.act(async () => {
    await renderer.advanceFrames(2, 16)
  })
  const scene = renderer.scene.instance as THREE.Scene
  let sun: THREE.DirectionalLight | null = null
  let ambient: THREE.AmbientLight | null = null
  // Use three's `.is*` flags rather than instanceof: the test renderer may
  // resolve a separate copy of the three module.
  scene.traverse((obj) => {
    const o = obj as unknown as { isDirectionalLight?: boolean; isAmbientLight?: boolean }
    if (o.isDirectionalLight) sun = obj as THREE.DirectionalLight
    else if (o.isAmbientLight) ambient = obj as THREE.AmbientLight
  })
  expect(sun, 'directional light present').not.toBeNull()
  expect(ambient, 'ambient light present').not.toBeNull()
  const result = {
    sunIntensity: sun ? (sun as THREE.DirectionalLight).intensity : 0,
    sunColor: sun ? (sun as THREE.DirectionalLight).color.clone() : new THREE.Color(),
    ambientIntensity: ambient ? (ambient as THREE.AmbientLight).intensity : 0,
  }
  await renderer.unmount()
  return result
}

describe('Lighting (R3F)', () => {
  it('is bright at noon and dim at night', async () => {
    const noon = await lightStateAt(13)
    const night = await lightStateAt(23)
    expect(noon.sunIntensity).toBeGreaterThan(night.sunIntensity)
    expect(noon.ambientIntensity).toBeGreaterThan(night.ambientIntensity)
  })

  it('evening sun is warmer than noon sun', async () => {
    const evening = await lightStateAt(19)
    const noon = await lightStateAt(13)
    const eveningWarmth = evening.sunColor.r - evening.sunColor.b
    const noonWarmth = noon.sunColor.r - noon.sunColor.b
    expect(eveningWarmth).toBeGreaterThan(noonWarmth)
  })

  it('night sun color shifts toward blue moonlight', async () => {
    const night = await lightStateAt(0)
    expect(night.sunColor.b).toBeGreaterThan(night.sunColor.r)
  })
})
