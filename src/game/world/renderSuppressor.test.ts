// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderSuppressor } from './renderSuppressor'
import { registry } from './runtimeRegistry'

/**
 * Guard tests for DEV render suppression (branch e2e-ci-telemetry-probe). Proves the control is
 * default-off, toggles the scene, is cleared by resetGame, and auto-engages ONLY when opted in
 * (after settle + warmup) — so a normal-render run can never inherit suppression.
 */
describe('renderSuppressor', () => {
  let scene: { visible: boolean }
  beforeEach(() => {
    scene = { visible: true }
    renderSuppressor.reset() // clears suppression + engagedAuto, re-arms
    renderSuppressor.attach(scene as never)
  })

  it('defaults to NOT suppressed (rendering on)', () => {
    expect(renderSuppressor.isSuppressed()).toBe(false)
    expect(scene.visible).toBe(true)
  })

  it('enable/disable toggles scene visibility', () => {
    renderSuppressor.setSuppressed(true)
    expect(renderSuppressor.isSuppressed()).toBe(true)
    expect(scene.visible).toBe(false)
    renderSuppressor.setSuppressed(false)
    expect(renderSuppressor.isSuppressed()).toBe(false)
    expect(scene.visible).toBe(true)
  })

  it('resetGame path clears an active suppression', () => {
    renderSuppressor.setSuppressed(true)
    renderSuppressor.reset()
    expect(renderSuppressor.isSuppressed()).toBe(false)
    expect(scene.visible).toBe(true)
  })

  it('does NOT auto-engage when NOT opted in — even when settled (normal-render safety)', () => {
    registry.glbLandmarksExpected = 1
    registry.glbLandmarksActive = 1
    registry.glbLandmarksFailed = 0
    const now = vi.spyOn(performance, 'now').mockReturnValue(100_000)
    for (let i = 0; i < 5; i++) renderSuppressor.tick()
    expect(renderSuppressor.isSuppressed()).toBe(false)
    now.mockRestore()
  })

  it('auto-engages ONLY after opt-in + settle + warmup, and re-arms on reset', () => {
    registry.glbLandmarksExpected = 1
    registry.glbLandmarksActive = 1
    registry.glbLandmarksFailed = 0
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)
    renderSuppressor.enableAutoAfterSettle() // arms at t=0
    now.mockReturnValue(1000) // warmup (1500ms) not elapsed
    renderSuppressor.tick()
    expect(renderSuppressor.isSuppressed()).toBe(false)
    now.mockReturnValue(2000) // settled + warmup elapsed → engage once
    renderSuppressor.tick()
    expect(renderSuppressor.isSuppressed()).toBe(true)
    // reset re-arms: suppression cleared, and it engages again only after a fresh warmup
    now.mockReturnValue(2000)
    renderSuppressor.reset()
    expect(renderSuppressor.isSuppressed()).toBe(false)
    now.mockReturnValue(2500) // < 2000 + 1500 warmup
    renderSuppressor.tick()
    expect(renderSuppressor.isSuppressed()).toBe(false)
    now.mockReturnValue(4000) // >= re-arm + warmup
    renderSuppressor.tick()
    expect(renderSuppressor.isSuppressed()).toBe(true)
    now.mockRestore()
  })
})
