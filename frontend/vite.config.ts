import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      // Plugin only injects the precache manifest at build time.
      // main.tsx handles SW registration so there's no double-register.
      injectRegister: null,
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      // Don't let the plugin overwrite public/manifest.json — we manage it.
      manifest: false,
      injectManifest: {
        // Assets that change every build (hashed names) are precached.
        // Anything matched here is injected into self.__WB_MANIFEST in sw.js.
        globPatterns: ['**/*.{js,css,html,woff2}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2015',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    hmr: { overlay: false },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
