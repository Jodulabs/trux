/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy the WS stream to the backend so it stays same-origin (design: same-origin WS, no CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/conversations': {
        target: 'ws://127.0.0.1:4317',
        ws: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
