/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// Writes Netlify's SPA fallback rule into dist/_redirects, during production
// builds only. In production, Netlify serves index.html for any path without
// a matching file, and React Router takes over in the browser.
//
// Why not public/_redirects or netlify.toml: `netlify dev` reads those rules
// too, and rewrote Vite's dev-only module requests (/src/main.tsx,
// /@vite/client) to index.html, which broke the app locally. In development,
// Vite's own server already does the SPA fallback.
function netlifySpaFallback(): Plugin {
  return {
    name: 'netlify-spa-fallback',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_redirects',
        source: '/*  /index.html  200\n',
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), netlifySpaFallback()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
