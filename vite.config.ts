/// <reference types="vitest" />
import { defineConfig, type UserConfig } from 'vite'
import type { InlineConfig } from 'vitest/node'
import react from '@vitejs/plugin-react'

interface VitestConfig extends UserConfig {
  test?: InlineConfig
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Puerto fijo en desarrollo (5180: ningun otro Vite lo toma por descarte, como pasaba con 5175): el backoffice local abre aqui el panel en modo invitado (acceso asistido,
  // `getPanelBaseUrl`). Con strictPort, si esta ocupado Vite avisa en vez de moverse a otro puerto en silencio.
  server: { port: 5180, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
  }
} as VitestConfig)

