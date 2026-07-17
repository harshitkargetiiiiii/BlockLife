import { describe, expect, it } from 'vitest'
import {
  clipSegmentToRect,
  getCandidateOccluders,
  isFootprintBetweenCameraAndSubject,
} from '../occlusionBroadPhase'
import {
  CLEAR_DELAY_SECONDS,
  countBlockedSamples,
  createOcclusionState,
  isMeaningfullyOccluded,
  OCCLUDE_DELAY_SECONDS,
  resetOcclusionState,
  stepOcclusionState,
} from '../occlusionDetection'
import type { OccluderDescriptor, VisibilitySubject } from '../visibilityTypes'
import { getBuildingOccluderDescriptor } from '../occluderData'

/** Camera matches the diorama: subject + (12, 18, 12). */
function cameraFor(subject: VisibilitySubject) {
  return { x: subject.x + 12, y: 18, z: subject.z + 12 }
}

function subjectAt(x: number, z: number): VisibilitySubject {
  return {
    id: 'player',
    kind: 'player',
    x,
    z,
    groundY: 0,
    radius: 0.5,
    sampleHeights: [0.2, 1.0, 1.8],
    minBlockedSamples: 2,
  }
}

function building(
  id: string,
  cx: number,
  cz: number,
  w: number,
  h: number,
  d: number,
): OccluderDescriptor {
  return getBuildingOccluderDescriptor({
    id,
    position: [cx, cz],
    size: [w, h, d],
    color: '#888888',
    roofColor: '#555555',
  })
}

describe('broad phase (camera↔subject corridor)', () => {
  const subject = subjectAt(0, 0)
  const camera = cameraFor(subject)

  it('selects a building between camera and subject', () => {
    // Diagonal sight line passes through (6, 6).
    const b = building('between', 6, 6, 6, 10, 6)
    expect(isFootprintBetweenCameraAndSubject(camera, subject, b.bounds2D, 1)).toBe(true)
  })

  it('ignores a building behind the subject', () => {
    const b = building('behind_subject', -8, -8, 6, 10, 6)
    expect(isFootprintBetweenCameraAndSubject(camera, subject, b.bounds2D, 1)).toBe(false)
  })

  it('ignores a building behind the camera', () => {
    const b = building('behind_camera', 20, 20, 6, 10, 6)
    expect(isFootprintBetweenCameraAndSubject(camera, subject, b.bounds2D, 1)).toBe(false)
  })

  it('ignores a building outside the view corridor', () => {
    const b = building('off_corridor', 12, -12, 6, 10, 6)
    expect(isFootprintBetweenCameraAndSubject(camera, subject, b.bounds2D, 1)).toBe(false)
  })

  it('returns multiple candidates without allocation surprises', () => {
    const out: OccluderDescriptor[] = []
    const n = getCandidateOccluders(
      camera,
      subject,
      [
        building('a', 4, 4, 4, 10, 4),
        building('b', 8, 8, 4, 10, 4),
        building('c', -9, 0, 4, 10, 4),
      ],
      1,
      out,
    )
    expect(n).toBe(2)
    expect(out.map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('clipSegmentToRect returns a t-range inside [0, 1]', () => {
    const span = clipSegmentToRect(0, 0, 12, 12, { minX: 3, maxX: 9, minZ: 3, maxZ: 9 }, 0)
    expect(span).not.toBeNull()
    const [t0, t1] = span!
    expect(t0).toBeCloseTo(0.25, 5)
    expect(t1).toBeCloseTo(0.75, 5)
  })
})

describe('precise phase (height-validated sight lines)', () => {
  const subject = subjectAt(0, 0)
  const camera = cameraFor(subject)

  it('a tall building right behind the subject blocks all samples', () => {
    const b = building('tall', 5, 5, 6, 12, 6)
    expect(countBlockedSamples(camera, subject, b)).toBe(3)
    expect(isMeaningfullyOccluded(camera, subject, b)).toBe(true)
  })

  it('vertical bounds prevent false positives: a low wall blocks nothing meaningful', () => {
    // 1.5-tall planter-wall on the sight line far from the subject: by the
    // time the sight line crosses it, the line is well above 1.5.
    const low: OccluderDescriptor = {
      ...building('low', 8, 8, 4, 1, 4),
      maxY: 1.5,
      enabled: true,
    }
    expect(countBlockedSamples(camera, subject, low)).toBe(0)
  })

  it('a mid-height building may hide feet but not the head — not meaningful', () => {
    // Entry ~t=0.55 → head sight line is ~10 up there; feet line ~7.5.
    const mid = building('mid', 8, 8, 5, 8, 5)
    const blocked = countBlockedSamples(camera, subject, mid)
    expect(blocked).toBeGreaterThanOrEqual(1)
    expect(blocked).toBeLessThan(3)
  })

  it('short buildings are not registered as occluders at all', () => {
    const shed = building('shed', 5, 5, 4, 2.5, 4)
    expect(shed.enabled).toBe(false)
  })
})

describe('hysteresis + fade interpolation', () => {
  const occ = { minimumOpacity: 0.25, fadeSpeed: 3.2, restoreSpeed: 1.4 }

  it('a blip shorter than the delay never starts a fade', () => {
    const s = createOcclusionState()
    stepOcclusionState(s, true, 3, occ, 100, 0.016)
    stepOcclusionState(s, true, 3, occ, 100.05, 0.05)
    // Cleared again before OCCLUDE_DELAY elapsed.
    stepOcclusionState(s, false, 0, occ, 100.1, 0.05)
    expect(s.targetOpacity).toBe(1)
    expect(s.currentOpacity).toBe(1)
  })

  it('sustained occlusion fades to the minimum opacity', () => {
    const s = createOcclusionState()
    let t = 100
    for (let i = 0; i < 120; i++) {
      stepOcclusionState(s, true, 3, occ, t, 1 / 60)
      t += 1 / 60
    }
    expect(s.targetOpacity).toBe(0.25)
    expect(s.currentOpacity).toBe(0.25)
    expect(s.reason).toContain('occluded')
  })

  it('clearance holds before restoring, then returns to full opacity', () => {
    const s = createOcclusionState()
    let t = 100
    for (let i = 0; i < 60; i++) {
      stepOcclusionState(s, true, 3, occ, t, 1 / 60)
      t += 1 / 60
    }
    expect(s.currentOpacity).toBeLessThan(0.3)
    // Clear — within CLEAR_DELAY nothing restores yet.
    stepOcclusionState(s, false, 0, occ, t, 1 / 60)
    expect(s.targetOpacity).toBe(0.25)
    // After the hold, restore begins and completes.
    t += CLEAR_DELAY_SECONDS + 0.01
    for (let i = 0; i < 120; i++) {
      stepOcclusionState(s, false, 0, occ, t, 1 / 60)
      t += 1 / 60
    }
    expect(s.currentOpacity).toBe(1)
    expect(s.reason).toBe('clear')
  })

  it('restore is slower than fade-out', () => {
    expect(occ.restoreSpeed).toBeLessThan(occ.fadeSpeed)
    expect(OCCLUDE_DELAY_SECONDS).toBeLessThan(CLEAR_DELAY_SECONDS)
  })

  it('reset returns the state to pristine', () => {
    const s = createOcclusionState()
    let t = 100
    for (let i = 0; i < 60; i++) {
      stepOcclusionState(s, true, 3, occ, t, 1 / 60)
      t += 1 / 60
    }
    resetOcclusionState(s)
    expect(s).toEqual(createOcclusionState())
  })
})

describe('occluder descriptors derive from layout data', () => {
  it('uses the building footprint and height (+roof)', () => {
    const b = building('building_x', 10, -5, 8, 9, 6)
    expect(b.bounds2D).toEqual({ minX: 6, maxX: 14, minZ: -8, maxZ: -2 })
    expect(b.maxY).toBeCloseTo(9.5)
    expect(b.enabled).toBe(true)
    expect(b.fadeMode).toBe('wholeObject')
  })
})
