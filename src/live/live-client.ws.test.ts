import { describe, expect, it } from 'vitest';
import { buildLiveWebSocketUrl, vertexWsUrl } from './live-client';

describe('buildLiveWebSocketUrl', () => {
  const vertexBase =
    'wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent';

  it('appends access_token query param for Vertex', () => {
    const url = buildLiveWebSocketUrl({
      accessToken: 'ya29.test',
      authMode: 'vertex',
      websocketUrl: vertexBase,
    });
    expect(url).toBe(`${vertexBase}?access_token=ya29.test`);
    expect(url).toContain('BidiGenerateContent');
    expect(url).not.toContain('BidiGenerateContentConstrained');
  });

  it('uses vertexWsUrl helper for existing query strings', () => {
    expect(vertexWsUrl(`${vertexBase}?foo=1`, 'tok')).toBe(
      `${vertexBase}?foo=1&access_token=tok`,
    );
  });

  it('falls back to AI Studio Constrained URL without websocketUrl', () => {
    const url = buildLiveWebSocketUrl({
      accessToken: 'ephem',
      authMode: 'gemini-ephemeral',
      apiVersion: 'v1beta',
    });
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('BidiGenerateContentConstrained');
    expect(url).toContain('access_token=ephem');
  });

  it('throws when vertex mode lacks websocketUrl', () => {
    expect(() =>
      buildLiveWebSocketUrl({
        accessToken: 'ya29.test',
        authMode: 'vertex',
      }),
    ).toThrow(/websocketUrl/);
  });

  it('uses live-token websocketUrl for global and regional Vertex hosts', () => {
    const globalWs =
      'wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent';
    const url = buildLiveWebSocketUrl({
      accessToken: 'ya29.test',
      authMode: 'vertex',
      websocketUrl: globalWs,
    });
    expect(url).toBe(`${globalWs}?access_token=ya29.test`);
    expect(new URL(url).hostname).toBe('aiplatform.googleapis.com');
  });
});
