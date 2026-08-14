import { describe, expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { isLoopbackUrl } from './config';

describe('isLoopbackUrl', () => {
  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:5173',
    'http://[::1]:54321',
  ])('accepts local URL %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each([
    'https://project.supabase.co',
    'https://localhost.example.com',
    'not-a-url',
    '',
  ])('rejects non-local URL %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

describe('local extension environment', () => {
  it('preserves the dashboard hash route', () => {
    // Vite may have already put a truncated value into process.env when `#`
    // was treated as a dotenv comment (unquoted URL). Clear so loadEnv
    // re-reads the quoted mode file.
    const previous = process.env.VITE_DASHBOARD_URL;
    delete process.env.VITE_DASHBOARD_URL;
    try {
      const env = loadEnv('studypilot-local', process.cwd(), 'VITE_');
      expect(env.VITE_DASHBOARD_URL).toBe('http://127.0.0.1:5173/#dashboard');
    } finally {
      if (previous === undefined) delete process.env.VITE_DASHBOARD_URL;
      else process.env.VITE_DASHBOARD_URL = previous;
    }
  });
});
