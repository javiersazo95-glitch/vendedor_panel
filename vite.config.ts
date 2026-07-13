/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `as any` here is a deliberate, narrow workaround (not left-over debt):
// importing defineConfig from 'vitest/config' to type the `test` block
// properly breaks tsc, because vitest bundles its own vite/rollup version
// whose plugin types are incompatible with this project's vite version.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  }
} as any)
