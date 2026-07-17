/**
 * Machine-readable mirror of public/assets/ASSET_CREDITS.md.
 * The MVP ships zero external assets: everything on screen is procedural.
 */
export interface AssetCredit {
  name: string
  creator: string
  source: string
  license: string
  downloadedDate: string | null
  modified: boolean
  usage: string
}

export const ASSET_CREDITS: AssetCredit[] = [
  {
    name: 'All MVP visuals & audio',
    creator: 'BlockLife (procedurally generated in code)',
    source: 'this repository',
    license: 'original work',
    downloadedDate: null,
    modified: false,
    usage: 'Every mesh, material and sound in the MVP is generated at runtime.',
  },
]
