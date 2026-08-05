import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudySession } from './types';

const storage = new Map<string, unknown>();
const userId = 'be69a51f-880a-44b7-b24b-f599790b281f';
const chatId = 'd43fbabc-5564-45db-a72e-6e373049743e';

vi.mock('./config', () => ({
  DASHBOARD_URL: 'http://127.0.0.1:5173/#dashboard',
  LOCAL_DEV_EMAIL: 'dev@studypilot.local',
  LOCAL_DEV_MODE: false,
  LOCAL_DEV_PASSWORD: 'unused',
  STUDYPILOT_CONNECT_MESSAGE: 'Connect StudyPilot.',
  SUPABASE_ANON_KEY: 'local-publishable-key',
  SUPABASE_URL: 'http://127.0.0.1:54321',
}));

function accessToken(): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `${encode({ alg: 'none' })}.${encode({ sub: userId, exp: 4_102_444_800 })}.signature`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  storage.clear();
  storage.set('studypilot_supabase_access_session', {
    access_token: accessToken(),
    user_id: userId,
    email: 'dev@studypilot.local',
    expires_at: 4_102_444_800,
  });

  vi.stubGlobal('chrome', {
    runtime: { lastError: undefined },
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

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';

    if (url.pathname.endsWith('/dashboard_chats') && method === 'GET') {
      return json([{ id: chatId, session_id: null, title: 'Shared chat' }]);
    }
    if (url.pathname.endsWith('/rubrics') && method === 'GET') return json([]);
    if (url.pathname.endsWith('/sessions') && method === 'POST') return json([{ id: chatId }]);
    if (url.pathname.endsWith('/rpc/link_dashboard_chat_session') && method === 'POST') {
      return json({ id: chatId, session_id: chatId, title: 'Shared chat' });
    }
    if (url.pathname.endsWith('/session_messages') && method === 'POST') {
      return new Response(null, { status: 204 });
    }

    return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
  }));
});

describe('syncStudySessionToSupabase', () => {
  it('links a new same-id session through the owner-checked RPC', async () => {
    const { syncStudySessionToSupabase } = await import('./studypilotSupabase');
    const session: StudySession = {
      id: chatId,
      title: 'Cell biology',
      sourceUrl: 'https://example.test/cells',
      sourceTitle: 'Cells',
      question: 'What is ATP?',
      answer: 'It transfers energy.',
      folder: 'Biology 101',
      createdAt: '2026-08-04T09:00:00.000Z',
      tags: [],
      transcript: [{
        id: '80465bca-54f1-4e05-99f8-da1048667b81',
        role: 'user',
        text: 'What is ATP?',
        atSeconds: 1,
        sequence: 1,
      }],
    };

    await expect(syncStudySessionToSupabase(chatId, session)).resolves.toMatchObject({
      ok: true,
      remoteSessionId: chatId,
      dashboardUrl: `http://127.0.0.1:5173/#dashboard?chat=${chatId}`,
    });

    const calls = vi.mocked(fetch).mock.calls.map(([input, init]) => ({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      url: 'http://127.0.0.1:54321/rest/v1/rpc/link_dashboard_chat_session',
      method: 'POST',
      body: { p_chat_id: chatId },
    }));
    expect(calls.some(call => call.method === 'PATCH' && call.url.includes('/dashboard_chats'))).toBe(false);
  });

  it('preserves provenance and duration for an already-linked session', async () => {
    const linkedSessionId = 'b493e63b-adb4-4401-8c25-29fc5261283e';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const method = init?.method ?? 'GET';

      if (url.pathname.endsWith('/dashboard_chats') && method === 'GET') {
        return json([{ id: chatId, session_id: linkedSessionId, title: 'Shared chat' }]);
      }
      if (url.pathname.endsWith('/session_messages') && method === 'POST') {
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/sessions') && method === 'PATCH') {
        return json([{ id: linkedSessionId }]);
      }

      return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
    }));

    const { syncStudySessionToSupabase } = await import('./studypilotSupabase');
    const session: StudySession = {
      id: chatId,
      title: 'Current tab title',
      sourceUrl: 'https://different.example.test/current-tab',
      sourceTitle: 'Current tab',
      question: 'What changed?',
      answer: 'Only the transcript should change.',
      folder: 'Biology 101',
      createdAt: '2026-08-04T10:00:00.000Z',
      durationSeconds: 999,
      tags: [],
      transcript: [{
        id: 'f649e683-1323-44fe-b326-08d5d027df19',
        role: 'user',
        text: 'What changed?',
        atSeconds: 1,
        sequence: 1,
      }],
    };

    await expect(syncStudySessionToSupabase(chatId, session)).resolves.toMatchObject({
      ok: true,
      remoteSessionId: linkedSessionId,
    });

    const calls = vi.mocked(fetch).mock.calls.map(([input, init]) => ({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    }));
    expect(calls.some(call => call.method === 'PATCH' && call.url.includes('/sessions?'))).toBe(false);
  });
});
