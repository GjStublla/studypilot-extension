import { beforeAll, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, unknown>();
const localUserId = 'be69a51f-880a-44b7-b24b-f599790b281f';
const localEmail = 'dev@studypilot.local';
const localUrl = 'http://127.0.0.1:54321';

vi.mock('./config', () => ({
  DASHBOARD_URL: 'http://127.0.0.1:5173/#dashboard',
  LOCAL_DEV_EMAIL: 'dev@studypilot.local',
  LOCAL_DEV_MODE: true,
  LOCAL_DEV_PASSWORD: 'StudyPilot-local-dev-only-2026!',
  STUDYPILOT_CONNECT_MESSAGE: 'Connect StudyPilot.',
  SUPABASE_ANON_KEY: 'local-publishable-key',
  SUPABASE_URL: 'http://127.0.0.1:54321',
}));

function accessToken(): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    sub: localUserId,
    email: localEmail,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: `${localUrl}/auth/v1`,
  }));
  return `${header}.${payload}.signature`
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

beforeAll(() => {
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
    },
    storage: {
      local: {
        get(key: string, callback: (result: Record<string, unknown>) => void) {
          callback({ [key]: storage.get(key) });
        },
        set(values: Record<string, unknown>, callback: () => void) {
          Object.entries(values).forEach(([key, value]) => storage.set(key, value));
          callback();
        },
        remove(key: string, callback: () => void) {
          storage.delete(key);
          callback();
        },
      },
    },
  });

  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    access_token: accessToken(),
    expires_in: 3600,
    user: {
      id: localUserId,
      email: localEmail,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
});

describe('local extension authentication', () => {
  it('signs in once and reuses the stored access session', async () => {
    const { getAuthStatus } = await import('./studypilotSupabase');

    await expect(getAuthStatus()).resolves.toMatchObject({
      connected: true,
      userId: localUserId,
      email: localEmail,
    });
    await expect(getAuthStatus()).resolves.toMatchObject({
      connected: true,
      userId: localUserId,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(storage.has('studypilot_supabase_access_session')).toBe(true);
  });
});
