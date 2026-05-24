import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5179,
    strictPort: true,
    host: '127.0.0.1',
    hmr: { port: 5179, host: '127.0.0.1' },
  },
});
