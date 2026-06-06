import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Standalone build for running the side panel as a local web app during development
// (e.g. `npm run build:sidepanel && npx serve dist-sidepanel`). The packaged Chrome
// extension still bundles the side panel via vite.config.ts + CRXJS.
export default defineConfig({
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
