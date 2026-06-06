import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json' with { type: 'json' };
import path from 'node:path';

const stub = path.resolve(__dirname, 'src/stubs/empty.ts');

export default defineConfig({
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
