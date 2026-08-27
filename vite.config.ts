import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve, extname } from 'node:path'

/**
 * DEV-ONLY static server for review assets (issue #27 H0). Serves `dev-review-assets/` at
 * `/dev-review/*` while the dev server runs, so review harnesses can load the not-yet-approved
 * calibration human WITHOUT it living under `public/` (which Vite copies verbatim into `dist/`).
 * `apply: 'serve'` means this NEVER participates in `vite build` — the review asset is provably
 * absent from the production bundle. In production the `/dev-review/*` URL simply 404s.
 */
function devReviewAssets(): Plugin {
  const ROOT = resolve(__dirname, 'dev-review-assets')
  const TYPES: Record<string, string> = {
    '.glb': 'model/gltf-binary',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.json': 'application/json',
  }
  return {
    name: 'dev-review-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-review', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
        const file = resolve(ROOT, rel)
        // Path-traversal guard: never serve outside dev-review-assets/.
        if (!file.startsWith(ROOT + '/') || !existsSync(file) || !statSync(file).isFile()) {
          next()
          return
        }
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devReviewAssets()],
  test: {
    environment: 'jsdom',
    // Globals let @testing-library/react register its automatic DOM cleanup.
    globals: true,
    setupFiles: ['./src/setup/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
