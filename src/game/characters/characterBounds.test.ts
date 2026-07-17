import { describe, expect, it } from 'vitest'
import { getVisibilitySampleHeights, validateCharacterBounds } from './characterBounds'
import { CHARACTER_ASSETS, DEFAULT_CHARACTER_ASSET_ID } from './characterManifest'

const DEF = CHARACTER_ASSETS[DEFAULT_CHARACTER_ASSET_ID]

describe('validateCharacterBounds', () => {
  it('accepts the shipped asset bounds', () => {
    expect(validateCharacterBounds(DEF.bounds)).toEqual([])
  })

  it('rejects non-positive dimensions', () => {
    expect(validateCharacterBounds({ visualHeight: 0, radius: 0.4, centerY: 1, headY: 1.7 })).not.toEqual([])
    expect(validateCharacterBounds({ visualHeight: 1.9, radius: 0, centerY: 1, headY: 1.7 })).not.toEqual([])
  })

  it('rejects a center outside the body or a head below the center', () => {
    expect(
      validateCharacterBounds({ visualHeight: 1.9, radius: 0.4, centerY: 2.5, headY: 2.6 }),
    ).toContain('centerY outside body')
    expect(
      validateCharacterBounds({ visualHeight: 1.9, radius: 0.4, centerY: 1, headY: 0.5 }),
    ).toContain('headY implausible')
  })
})

describe('getVisibilitySampleHeights', () => {
  it('derives feet/torso/head samples from the manifest bounds', () => {
    expect(getVisibilitySampleHeights(DEF)).toEqual([0.2, DEF.bounds.centerY, DEF.bounds.headY])
  })

  it('orders samples bottom-up within the body height', () => {
    const [feet, torso, head] = getVisibilitySampleHeights(DEF)
    expect(feet).toBeLessThan(torso)
    expect(torso).toBeLessThan(head)
    expect(head).toBeLessThanOrEqual(DEF.bounds.visualHeight)
  })
})
