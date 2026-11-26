import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Os pedaços grandes são do Mermaid (layouts de diagrama), baixados só quando um diagrama
    // aparece na tela — não entram no carregamento inicial do Hub.
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Em desenvolvimento o Vite repassa /api para o backend; em produção quem faz isso é o nginx.
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
