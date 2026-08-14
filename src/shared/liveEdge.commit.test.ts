import { describe, expect, it, vi } from 'vitest';
import { canCommitLiveTurn, commitLiveTurn, resolveLiveAuth } from './liveEdge';

describe('canCommitLiveTurn', () => {
  it('requires both user and assistant text', () => {
    expect(canCommitLiveTurn('hello', 'hi')).toBe(true);
    expect(canCommitLiveTurn('  hello  ', '  hi  ')).toBe(true);
  });

  it('rejects partial or empty transcripts', () => {
    expect(canCommitLiveTurn(null, 'hi')).toBe(false);
    expect(canCommitLiveTurn('hello', null)).toBe(false);
    expect(canCommitLiveTurn('', 'hi')).toBe(false);
    expect(canCommitLiveTurn('hello', '   ')).toBe(false);
    expect(canCommitLiveTurn('   ', 'hi')).toBe(false);
    expect(canCommitLiveTurn(null, null)).toBe(false);
    expect(canCommitLiveTurn(undefined, undefined)).toBe(false);
  });

  it('never POSTs live-turn when either transcript is empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const base = {
        liveSessionId: '11111111-1111-4111-8111-111111111111',
        requestId: '22222222-2222-4222-8222-222222222222',
        userMessageId: '33333333-3333-4333-8333-333333333333',
        assistantMessageId: '44444444-4444-4444-8444-444444444444',
      };
      await expect(commitLiveTurn({ ...base, userText: 'hello', assistantText: '' })).rejects.toThrow(
        /both userText and assistantText/,
      );
      await expect(commitLiveTurn({ ...base, userText: '', assistantText: 'hi' })).rejects.toThrow(
        /both userText and assistantText/,
      );
      await expect(
        commitLiveTurn({ ...base, userText: 'hello', assistantText: '   ' }),
      ).rejects.toThrow(/both userText and assistantText/);
      await expect(commitLiveTurn({ ...base, userText: null, assistantText: 'hi' })).rejects.toThrow(
        /both userText and assistantText/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('resolveLiveAuth', () => {
  const vertexWs =
    'wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent';

  it('prefers accessToken and requires websocketUrl for vertex', () => {
    const auth = resolveLiveAuth({
      authMode: 'vertex',
      accessToken: 'ya29.vertex',
      ephemeralToken: 'ya29.vertex',
      websocketUrl: vertexWs,
    });
    expect(auth).toEqual({
      accessToken: 'ya29.vertex',
      ephemeralToken: 'ya29.vertex',
      authMode: 'vertex',
      websocketUrl: vertexWs,
    });
  });

  it('treats websocketUrl alone as vertex and falls back to ephemeralToken', () => {
    const auth = resolveLiveAuth({
      ephemeralToken: 'legacy-or-compat-token',
      websocketUrl: vertexWs,
    });
    expect(auth.authMode).toBe('vertex');
    expect(auth.accessToken).toBe('legacy-or-compat-token');
    expect(auth.websocketUrl).toBe(vertexWs);
  });

  it('rejects vertex without websocketUrl', () => {
    expect(() =>
      resolveLiveAuth({
        authMode: 'vertex',
        accessToken: 'ya29.vertex',
      }),
    ).toThrow(/websocketUrl/);
  });

  it('rejects missing token', () => {
    expect(() => resolveLiveAuth({ authMode: 'vertex', websocketUrl: vertexWs })).toThrow(
      /accessToken/,
    );
  });
});
