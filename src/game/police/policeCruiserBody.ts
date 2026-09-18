/**
 * Integration Wave 5: the approved police car body, drawn on every cruiser in the live police pool
 * (`PoliceUnits`). Pure data so node-environment contract tests can read it without the renderer.
 *
 * Purely visual — `LandmarkAsset` keeps the complete procedural cruiser (CarMesh + its light bar)
 * as the fallback for a disabled, loading or failed GLB, and nothing the police director reads
 * depends on which branch renders.
 */
export const POLICE_CRUISER_ASSET_ID = 'vehicle_police_cruiser_01'

/** Both light-bar variants carry this name; the flash loop finds whichever one is mounted. */
export const SIREN_BAR_NAME = 'police-siren-bar'

export interface SirenBarFit {
  position: readonly [number, number, number]
  lampSize: readonly [number, number, number]
  lampX: number
}

/**
 * Where the flashing lamps sit on each body. The procedural bar keeps its long-standing spot on
 * CarMesh's cabin roof. On the approved body the lamps cover the MODELLED roof light bar, measured
 * from the shipped vertices at the manifest scale (x ±0.43, y 1.10–1.27, z −0.31…−0.15), so the
 * red/blue alternation lights the bar the model already has instead of floating a second one
 * above it. `wave5Contract.test.ts` re-measures the bar from the bytes and checks the cover.
 */
export const SIREN_BAR_FITS: Readonly<Record<'procedural' | 'body', SirenBarFit>> = {
  procedural: { position: [0, 1.45, -0.2], lampSize: [0.5, 0.18, 0.34], lampX: 0.35 },
  body: { position: [0, 1.19, -0.23], lampSize: [0.44, 0.19, 0.19], lampX: 0.215 },
}

/**
 * DEV/test reader: the light bar on every VISIBLE cruiser, which variant is mounted (the body's
 * or the procedural one, told apart by its authored height), and how many of its lamps are lit.
 * Never read by the simulation.
 */
export function readPoliceSirens(scene: import('three').Object3D | null): {
  bars: number
  variants: ('body' | 'procedural')[]
  litPerBar: number[]
} {
  const variants: ('body' | 'procedural')[] = []
  const litPerBar: number[] = []
  scene?.getObjectByName('police-units')?.traverse((o) => {
    if (o.name !== SIREN_BAR_NAME) return
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return
    variants.push(Math.abs(o.position.y - SIREN_BAR_FITS.body.position[1]) < 1e-6 ? 'body' : 'procedural')
    litPerBar.push(o.children.filter((c) => c.visible).length)
  })
  return { bars: litPerBar.length, variants, litPerBar }
}
