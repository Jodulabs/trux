/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy REST + the WS stream to the backend so it stays same-origin (design: same-origin WS, no CORS).
// The http target with ws:true serves both the REST calls under /conversations and the /stream upgrade.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/conversations': {
        target: 'http://127.0.0.1:4317',
        ws: true,
      },
      '/workspaces': { target: 'http://127.0.0.1:4317' },
      '/health': { target: 'http://127.0.0.1:4317' },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
