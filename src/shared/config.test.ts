import { describe, expect, it } from 'vitest';
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
