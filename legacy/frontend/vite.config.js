import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Point the dev server at a different API with VITE_API_TARGET, e.g. a second
// backend on another port. Defaults to the usual local one.
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy keeps the browser on one origin in development, so the frontend
    // calls /api/... with no host and no CORS preflight.
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
