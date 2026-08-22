import type { WebGLRenderer } from 'three'
import { registry } from './runtimeRegistry'
import { trafficRuntime } from '../traffic/trafficRuntime'
import { useGameStore } from '../store/useGameStore'

/**
 * DEV/TEST-ONLY E2E-environment telemetry probe (branch `e2e-ci-telemetry-probe`).
 *
 * Measures the RAW render/simulation throughput of the host so a CI run and a local run can be
 * compared numerically — distinguishing "runner too slow" (low FPS → render-gated sim starvation)
 * from a simulation/test-architecture defect. It records the RAW R3F frame delta itself; it does NOT
 * reuse `PerfProbe`/`getRenderStats().fps`, whose delta is pre-clamped to 0.05 (an artificial 20-FPS
 * floor) and is therefore useless for measuring true host FPS.
 *
 * Production safety: this module is referenced ONLY from DEV-gated code (the DEV-mounted
 * `DiagnosticProbe` component and the `import.meta.env.DEV`-guarded `GAME_TEST_API`), so it is
 * tree-shaken out of the production bundle — verified by the dist grep in the diagnostic workflow.
 */
const HIST_EDGES_MS = [8, 17, 33, 50, 100, 200, 500] as const // "< edge" buckets; final bucket = ≥500

interface Begin {
  realMs: number
  gameHours: number
  positions: Map<string, [number, number]>
}

class Probe {
  private active = false
  private begin: Begin | null = null
  private frames = 0
  private rawSumS = 0
  private clampedSumS = 0
  private maxRawS = 0
  private hist = new Array(HIST_EDGES_MS.length + 1).fill(0)
  private gl: WebGLRenderer | null = null
  private glInfo = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 }

  /** Called once by the DEV probe component with the live renderer. */
  attach(gl: WebGLRenderer): void {
    this.gl = gl
  }

  /** Begin a fresh measurement window; snapshot the domain start-state. */
  reset(): void {
    this.active = true
    this.frames = 0
    this.rawSumS = 0
    this.clampedSumS = 0
    this.maxRawS = 0
    this.hist.fill(0)
    const s = useGameStore.getState().stats
    const positions = new Map<string, [number, number]>()
    for (const [id, v] of registry.npcPositions) positions.set(id, [v.x, v.z])
    this.begin = { realMs: performance.now(), gameHours: s.day * 24 + s.hour, positions }
  }

  /** Per-frame recorder — the RAW delta (seconds). Cheap: a handful of scalar reads, no allocation. */
  record(rawDeltaS: number): void {
    if (!this.active) return
    this.frames++
    this.rawSumS += rawDeltaS
    this.clampedSumS += Math.min(rawDeltaS, 0.05) // what the sim ACTUALLY integrates (CONVENTIONS #1)
    if (rawDeltaS > this.maxRawS) this.maxRawS = rawDeltaS
    const ms = rawDeltaS * 1000
    let b: number = HIST_EDGES_MS.length
    for (let i = 0; i < HIST_EDGES_MS.length; i++) {
      if (ms < HIST_EDGES_MS[i]) { b = i; break }
    }
    this.hist[b]++
    const info = this.gl?.info
    if (info) {
      this.glInfo = {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
      }
    }
  }

  /** Structured measurement record for the diagnostic spec. */
  snapshot(): Record<string, unknown> {
    const nowMs = performance.now()
    const b = this.begin
    const realMs = b ? nowMs - b.realMs : 0
    const realS = realMs / 1000 || 1
    const s = useGameStore.getState().stats
    let personMeters = 0
    let tracked = 0
    if (b) {
      for (const [id, v] of registry.npcPositions) {
        const p = b.positions.get(id)
        if (p) { tracked++; personMeters += Math.hypot(v.x - p[0], v.z - p[1]) }
      }
    }
    return {
      realElapsedMs: realMs,
      frames: this.frames,
      rawFps: this.frames / realS,
      rawDeltaSumS: this.rawSumS,
      clampedDeltaSumS: this.clampedSumS,
      // ~1.0 means real time is tracked; <1.0 means the sim runs slower than wall-clock.
      rawDeltaRate: this.rawSumS / realS,
      clampedSimRate: this.clampedSumS / realS,
      maxRawFrameMs: this.maxRawS * 1000,
      frameDeltaHistogramMs: { ltEdges: [...HIST_EDGES_MS], counts: [...this.hist] },
      render: { ...this.glInfo, materials: null }, // materials not exposed by gl.info on this baseline
      domain: {
        gameHoursAdvanced: b ? s.day * 24 + s.hour - b.gameHours : 0,
        personMetersMoved: personMeters,
        peopleTracked: tracked,
        activePeople: registry.npcPositions.size,
        movingPeople: registry.movingPersonIds.size,
        activeCars: trafficRuntime.cars.size,
      },
      renderer: this.rendererTelemetry(),
      browser: this.browserTelemetry(),
    }
  }

  private rendererTelemetry(): Record<string, unknown> {
    const out = {
      webglVersion: null as string | null,
      vendor: null as string | null,
      renderer: null as string | null,
      unmaskedVendor: null as string | null,
      unmaskedRenderer: null as string | null,
      debugExtAvailable: false,
    }
    try {
      const ctx = this.gl?.getContext() as WebGLRenderingContext | undefined
      if (ctx) {
        out.webglVersion = String(ctx.getParameter(ctx.VERSION))
        out.vendor = String(ctx.getParameter(ctx.VENDOR))
        out.renderer = String(ctx.getParameter(ctx.RENDERER))
        const dbg = ctx.getExtension('WEBGL_debug_renderer_info')
        if (dbg) {
          out.debugExtAvailable = true
          out.unmaskedVendor = String(ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL))
          out.unmaskedRenderer = String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        }
      }
    } catch {
      /* leave nulls — the spec treats a null renderer as an integrity failure */
    }
    return out
  }

  private browserTelemetry(): Record<string, unknown> {
    const ua = navigator.userAgent
    const m = ua.match(/Chrome\/([0-9.]+)/)
    return {
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: ua,
      platform: navigator.platform,
      chromiumVersion: m ? m[1] : null,
    }
  }
}

export const diagnosticProbe = new Probe()
