import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Must match "paths" in tsconfig.json. TypeScript resolves imports for the
  // editor and `tsc --noEmit`; Vite resolves them for the bundle. If only one
  // knows about the alias, the type-check and the build disagree.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Electron loads the production build from disk over file://, so assets
  // must be referenced relatively.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /* Three vendor chunks, split by how often each one changes.
           React and the router are the runtime and move once a year; Radix
           and the icon set are the UI layer and move with a design change.
           Keeping them apart is not about download size - nothing here is
           downloaded, Electron reads it off local disk - it is about the
           parse: the entry chunk is what blocks the first paint of the
           sign-in screen, and it has no business carrying the barcode
           scanner's dependencies. The screens themselves are split by route
           in App.tsx. */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          radix: [
            '@radix-ui/react-dialog',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
          ],
          icons: ['@phosphor-icons/react'],
        },
      },
    },
  },
  /* /api goes to the server in development.

     A proxy rather than pointing the client at http://localhost:4000
     directly, so the browser sees ONE origin and the session cookie is
     same-origin - no CORS preflight, no SameSite argument, and no chance of
     developing against a permissive cookie configuration that then breaks in
     production. The deployed browser build sets VITE_API_URL instead. */
  // 5173 by default because dev:electron points at it. PORT overrides so a
  // second instance can run alongside the Electron one.
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.CHAS_API ?? 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
})
