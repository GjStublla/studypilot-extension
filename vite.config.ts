/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.json' with { type: 'json' };

function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const { hostname } = new URL(value);
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const localBuild = mode === 'studypilot-local';
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  if (
    localBuild &&
    (!isLoopbackUrl(env.VITE_SUPABASE_URL) || !isLoopbackUrl(env.VITE_DASHBOARD_URL))
  ) {
    throw new Error(
      'Local extension builds require loopback VITE_SUPABASE_URL and VITE_DASHBOARD_URL values.',
    );
  }

  if (
    mode === 'production' &&
    isLoopbackUrl(env.VITE_SUPABASE_URL)
  ) {
    throw new Error(
      'Production extension builds cannot target a local Supabase instance. Use npm run build:local instead.',
    );
  }

  const buildManifest = localBuild
    ? {
        ...manifest,
        name: 'Study Pilot (Local)',
        short_name: 'Study Pilot Local',
        action: {
          ...manifest.action,
          default_title: 'Toggle Study Pilot (Local)',
        },
        host_permissions: [
          ...manifest.host_permissions,
          'http://127.0.0.1/*',
          'http://localhost/*',
        ],
      }
    : manifest;

  return {
    plugins: [react(), crx({ manifest: buildManifest })],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    build: {
      outDir: localBuild ? 'dist-local' : 'dist',
      rollupOptions: {
        input: {
          offscreen: path.resolve(__dirname, 'src/offscreen.html'),
        },
      },
    },
    publicDir: 'public',
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/dist-local/**',
        '**/e2e/**',
      ],
    },
    server: {
      port: 5179,
      strictPort: true,
      host: '127.0.0.1',
      hmr: { port: 5179, host: '127.0.0.1' },
    },
  };
});
