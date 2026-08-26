import type { Scene } from 'three'
import { registry } from './runtimeRegistry'

/**
 * DEV/TEST-ONLY render suppression (branch e2e-ci-telemetry-probe).
 *
 * Proves a narrow hypothesis: can the SINGLE existing R3F/useFrame authority run near real time when
 * expensive scene DRAWING is suppressed, while every component + frame callback stays mounted? It
 * makes the R3F root scene NON-VISIBLE (`scene.visible = false`) after assets settle. Three's
 * renderer then early-outs on the invisible root → ~zero draw calls / rasterization — but R3F still
 * ticks its `useFrame` loop and calls `gl.render` each frame, so physics, directors, streaming,
 * occupancy and the clamped delta are untouched. It is NOT a virtual clock and NOT an N-substep loop:
 * the one authority runs unchanged, only the pixels are skipped.
 *
 * Production safety: referenced only from DEV-gated code (the DEV-mounted RenderSuppressorProbe and
 * the DEV GAME_TEST_API), so it tree-shakes out of dist — verified by the diagnostic-string dist grep.
 * Default = normal rendering; a page reload / fresh page starts a fresh module (unsuppressed); the
 * test API's resetGame clears it; every test restores in finally.
 */
class RenderSuppressor {
  private scene: Scene | null = null
  private suppressed = false
  private auto = false
  private engagedAuto = false
  private armedAtMs = 0
  private static readonly WARMUP_MS = 1500 // let the (re)loaded scene settle before engaging

  /** The DEV probe hands over the live R3F root scene once. */
  attach(scene: Scene): void {
    this.scene = scene
    this.apply()
  }

  setSuppressed(v: boolean): void {
    this.suppressed = v
    this.apply()
  }

  isSuppressed(): boolean {
    return this.suppressed
  }

  /** Opt-in (VITE_SUPPRESS_AFTER_SETTLE): auto-engage suppression ONCE the scene has settled (plus a
   *  short warmup), so an unmodified existing test can run render-suppressed without touching its
   *  body. Robust to resetGame-in-helpers and to sectors with few/no GLB landmarks. */
  enableAutoAfterSettle(): void {
    this.auto = true
    this.armedAtMs = performance.now()
  }

  /** Per-frame, from the DEV probe. Auto-engage once the GLB landmarks have settled AND a warmup has
   *  elapsed since the last (re)arm — settle covers "assets loaded"; the warmup avoids the trivial
   *  0>=0 boot instant and lets a just-teleported sector finish coming up. Re-asserts visibility. */
  tick(): void {
    if (this.auto && !this.engagedAuto) {
      const settled = registry.glbLandmarksActive + registry.glbLandmarksFailed >= registry.glbLandmarksExpected
      if (settled && performance.now() - this.armedAtMs >= RenderSuppressor.WARMUP_MS) {
        this.engagedAuto = true
        this.suppressed = true
      }
    }
    this.apply()
  }

  /** Cleared by resetGame and by a fresh page: never leak suppression into a later test. Re-arms the
   *  auto trigger so it engages again after the next scene settles (e.g. a teleport in a helper). */
  reset(): void {
    this.suppressed = false
    this.engagedAuto = false
    this.armedAtMs = performance.now()
    this.apply()
  }

  private apply(): void {
    if (this.scene && this.scene.visible === this.suppressed) this.scene.visible = !this.suppressed
  }
}

export const renderSuppressor = new RenderSuppressor()
