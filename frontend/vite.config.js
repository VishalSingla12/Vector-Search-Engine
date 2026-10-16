import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'

function getBackendPort() {
  try {
    const dir = typeof import.meta.dirname !== 'undefined' ? import.meta.dirname : process.cwd()
    const p = path.resolve(dir, '..', '.backend_port')
    if (fs.existsSync(p)) {
      const val = fs.readFileSync(p, 'utf-8').trim()
      if (val && !isNaN(Number(val))) return parseInt(val, 10)
    }
  } catch (e) {}
  return 8000
}

const backendPort = getBackendPort()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true
      }
    }
  }
})

