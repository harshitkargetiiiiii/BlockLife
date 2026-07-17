import { describe, expect, it } from 'vitest'
import {
  getPoliceSpawnAnchors,
  pickSpawnAnchor,
  validatePoliceSpawns,
  type CameraBox,
} from './policeSpawns'

describe('police spawn anchors', () => {
  it('resolves anchors and they all sit on roads', () => {
    expect(getPoliceSpawnAnchors().length).toBeGreaterThan(0)
    expect(validatePoliceSpawns()).toEqual([])
  })

  it('never picks an on-camera anchor when an off-camera one exists', () => {
    const near: [number, number] = [22, 6]
    // A camera box covering the whole map would force the fallback; use a
    // small box near the suspect so plenty of anchors remain off-camera.
    const cam: CameraBox = { minX: 12, maxX: 32, minZ: -4, maxZ: 16 }
    const anchor = pickSpawnAnchor(near, cam)
    expect(anchor).not.toBeNull()
    const inside =
      anchor!.position[0] > cam.minX &&
      anchor!.position[0] < cam.maxX &&
      anchor!.position[1] > cam.minZ &&
      anchor!.position[1] < cam.maxZ
    expect(inside).toBe(false)
  })

  it('never picks an anchor already taken by another unit', () => {
    const near: [number, number] = [22, 6]
    const first = pickSpawnAnchor(near, null)
    expect(first).not.toBeNull()
    const second = pickSpawnAnchor(near, null, new Set([first!.id]))
    expect(second).not.toBeNull()
    expect(second!.id).not.toBe(first!.id)
  })

  it('does not spawn on top of the suspect', () => {
    const near: [number, number] = [22, 6]
    const anchor = pickSpawnAnchor(near, null)
    // pickSpawnAnchor rejects anchors < 20u away unless nothing else exists.
    if (anchor) {
      const d = Math.hypot(anchor.position[0] - near[0], anchor.position[1] - near[1])
      expect(d).toBeGreaterThan(0)
    }
  })
})
