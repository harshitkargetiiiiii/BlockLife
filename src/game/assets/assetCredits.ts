/**
 * Legacy machine-readable mirror of public/assets/ASSET_CREDITS.md.
 *
 * The authoritative, current per-asset attribution + license now lives on each
 * `AssetManifestEntry` (`attribution` / `license`, asserted enabled-complete by
 * assetManifest.test.ts), with the human registry + intake records in
 * public/assets/ASSET_CREDITS.md. This module is kept for the `AssetCredit` shape;
 * it is NOT the source of truth and no longer claims the project is asset-free
 * (it ships Quaternius CC0 + Meshy AI generated GLBs — see the manifest).
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
