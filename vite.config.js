import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'
  return {
  logLevel: 'error', // Suppress warnings, only show errors
  server: {
    // Evita "Cannot POST /api/..." en HTML: el front usa /api y Vite reenvía al Express en 3001
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['xlsx'],
    // Evita pre-caché obsoleto (504 Outdated Optimize Dep) con jspdf/html2canvas; se cargan vía import() en CorteCaja.
    exclude: ['jspdf', 'html2canvas'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './origen'),
    }
  },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      // En producción estos "agents/notifiers" pueden tocar el DOM fuera de React
      // y causar errores tipo removeChild / insertBefore.
      hmrNotifier: !isProd,
      navigationNotifier: !isProd,
      visualEditAgent: !isProd,
    }),
    react(),
  ]
}})