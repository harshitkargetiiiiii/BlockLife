import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Globals let @testing-library/react register its automatic DOM cleanup.
    globals: true,
    setupFiles: ['./src/setup/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
