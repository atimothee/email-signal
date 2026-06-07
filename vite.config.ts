import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json' with { type: 'json' };
import path from 'node:path';

const stub = path.resolve(__dirname, 'src/stubs/empty.ts');

export default defineConfig({
  // Stamp the build start time so the running side panel can show which build
  // it is (issue #73). In `--watch` this is the watcher's start time, which is
  // enough to expose a `dist/` left stale by a watcher that wasn't running.
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), crx({ manifest: manifest as any })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@schemas': path.resolve(__dirname, 'src/schemas'),
      '@agents': path.resolve(__dirname, 'src/agents'),
      '@tools': path.resolve(__dirname, 'src/tools'),
      // Node-only dependencies — never loaded at runtime in the extension.
      weave: stub,
      ioredis: stub,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: { port: 5174 },
});
