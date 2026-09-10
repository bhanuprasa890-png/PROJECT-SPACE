import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Preview-friendly dev config:
 *  - bind 0.0.0.0 so the sandbox proxy can reach it
 *  - allowedHosts: true so the *.e2b.app preview host is accepted
 *  - /api proxied to the Express server, so the browser only ever talks to one
 *    origin (cookies stay first-party, no CORS, no localhost calls in client code)
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.CLIENT_PORT || 5173),
    strictPort: false,
    allowedHosts: true,
    hmr: { host: '0.0.0.0' },
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: false,
      },
    },
  },
  preview: { host: '0.0.0.0', allowedHosts: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    // Default chunking is deliberate here: three.js (~900 kB) is only reachable
    // through Stage.jsx's dynamic import, so it lands in an async chunk and the
    // entry graph (index) never imports it. Naming three in manualChunks instead
    // pulled the whole WebGL chunk back into the first-load graph.
    chunkSizeWarningLimit: 1000,
  },
});
