import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Standalone build for running the side panel as a local web app during development
// (e.g. `npm run build:sidepanel && npx serve dist-sidepanel`). The packaged Chrome
// extension still bundles the side panel via vite.config.ts + CRXJS.
export default defineConfig({
  // Keep `__BUILD_TIMESTAMP__` defined for the standalone preview build too, so
  // the shared App.tsx reference resolves in both bundles (issue #73).
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@schemas': path.resolve(__dirname, 'src/schemas'),
      '@agents': path.resolve(__dirname, 'src/agents'),
      '@tools': path.resolve(__dirname, 'src/tools'),
    },
  },
  root: 'src/sidepanel',
  build: {
    outDir: path.resolve(__dirname, 'dist-sidepanel'),
    emptyOutDir: true,
  },
  server: { port: 5175 },
});
