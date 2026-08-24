import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveToken } from '@/shared/liveEdge';
import { parseLiveStartPayload } from '@/shared/extensionMessages';
import { DEFAULT_SESSION_PRIVACY } from '@/shared/types';
import { isCurrentLiveRuntimeOperation, pauseLive, resumeLive, startLive, stopLive } from './liveRuntime';

vi.mock('@/shared/liveEdge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/liveEdge')>();
  return {
    ...actual,
    fetchLiveToken: vi.fn(),
    finishLiveSession: vi.fn(async () => ({})),
  };
});

const fetchLiveTokenMock = vi.mocked(fetchLiveToken);

function vertexTokenResponse() {
  return {
    authMode: 'vertex' as const,
    accessToken: 'test-access-token',
    ephemeralToken: 'test-access-token',
    websocketUrl: 'wss://example.test/live',
    expireTime: '2099-01-01T00:00:00.000Z',
    sessionId: 'session-1',
    chatId: 'chat-1',
  };
}

function installChrome() {
  const captureVisibleTab = vi.fn(async () => 'data:image/jpeg;base64,ZmFrZXNjcmVlbnNob3Q=');
  const sendMessage = vi.fn(async () => undefined);
  const storage = new Map<string, unknown>();

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of keys) {
            if (storage.has(key)) out[key] = storage.get(key);
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.entries(items).forEach(([key, value]) => storage.set(key, value));
        }),
        remove: vi.fn(async (key: string) => {
          storage.delete(key);
        }),
      },
    },
    runtime: {
      getContexts: vi.fn(async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }]),
      sendMessage,
      lastError: undefined,
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => {
        throw new Error('no receiver');
      }),
      captureVisibleTab,
    },
    offscreen: {
      createDocument: vi.fn(),
    },
  });

  return { captureVisibleTab, sendMessage };
}

describe('parseLiveStartPayload', () => {
  it('accepts only the latest service-worker operation', () => {
    expect(isCurrentLiveRuntimeOperation(4, 4)).toBe(true);
    expect(isCurrentLiveRuntimeOperation(3, 4)).toBe(false);
  });

  it('requires both privacy booleans and rejects the old screenshot flag', () => {
    expect(() => parseLiveStartPayload({ chatId: 'chat-1' })).toThrow(
      /privacy\.captureScreenshot and privacy\.saveToDashboard/,
    );
    expect(() => parseLiveStartPayload({ chatId: 'chat-1', captureScreenshot: true })).toThrow(
      /privacy\.captureScreenshot and privacy\.saveToDashboard/,
    );
    expect(() =>
      parseLiveStartPayload({
        chatId: 'chat-1',
        privacy: { captureScreenshot: 'yes', saveToDashboard: false },
      }),
    ).toThrow(/privacy\.captureScreenshot and privacy\.saveToDashboard/);
    expect(() =>
      parseLiveStartPayload({
        chatId: 'chat-1',
        privacy: { captureScreenshot: false },
      }),
    ).toThrow(/privacy\.captureScreenshot and privacy\.saveToDashboard/);
  });

  it('returns the exact privacy booleans', () => {
    expect(
      parseLiveStartPayload({
        chatId: 'chat-1',
        privacy: { captureScreenshot: true, saveToDashboard: false },
      }),
    ).toEqual({
      chatId: 'chat-1',
      privacy: { captureScreenshot: true, saveToDashboard: false },
    });
  });
});

describe('startLive privacy propagation', () => {
  beforeEach(() => {
    fetchLiveTokenMock.mockReset();
    fetchLiveTokenMock.mockResolvedValue(vertexTokenResponse());
    installChrome();
  });

  afterEach(async () => {
    await stopLive('user_stop');
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('defaults both controls off and does not capture or persist', async () => {
    expect(DEFAULT_SESSION_PRIVACY).toEqual({
      captureScreenshot: false,
      saveToDashboard: false,
    });

    const { captureVisibleTab, sendMessage } = installChrome();
    await startLive({
      chatId: 'chat-1',
      privacy: { ...DEFAULT_SESSION_PRIVACY },
      windowId: 7,
      page: { title: 'Lecture', url: 'https://example.test/lecture' },
    });

    expect(captureVisibleTab).not.toHaveBeenCalled();
    expect(fetchLiveTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        saveToDashboard: false,
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_CONNECT',
        screenshotJpegBase64: null,
      }),
    );
  });

  it('captures a screenshot without saving when only capture is on', async () => {
    const { captureVisibleTab, sendMessage } = installChrome();
    await startLive({
      chatId: 'chat-1',
      privacy: { captureScreenshot: true, saveToDashboard: false },
      windowId: 7,
    });

    expect(captureVisibleTab).toHaveBeenCalledOnce();
    expect(fetchLiveTokenMock).toHaveBeenCalledWith(expect.objectContaining({ saveToDashboard: false }));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OFFSCREEN_CONNECT',
        screenshotJpegBase64: 'ZmFrZXNjcmVlbnNob3Q=',
      }),
    );
  });

  it('saves to the dashboard without capturing when only save is on', async () => {
    const { captureVisibleTab } = installChrome();
    await startLive({
      chatId: 'chat-1',
      privacy: { captureScreenshot: false, saveToDashboard: true },
      windowId: 7,
    });

    expect(captureVisibleTab).not.toHaveBeenCalled();
    expect(fetchLiveTokenMock).toHaveBeenCalledWith(expect.objectContaining({ saveToDashboard: true }));
  });

  it('does not broadcast a stale start failure after a newer stop', async () => {
    const { sendMessage } = installChrome();
    let resolveFetchStarted!: () => void;
    let rejectFetch!: (error: Error) => void;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const pendingToken = new Promise<never>((_resolve, reject) => {
      rejectFetch = reject;
    });
    fetchLiveTokenMock.mockImplementationOnce(async () => {
      resolveFetchStarted();
      return pendingToken;
    });

    const startPromise = startLive({
      chatId: 'chat-1',
      privacy: { captureScreenshot: false, saveToDashboard: false },
    });
    await fetchStarted;

    const stopResult = await stopLive('user_stop');
    rejectFetch(new Error('late start failure'));
    const startResult = await startPromise;

    expect(startResult.state).toBe('idle');
    expect(startResult.operationId).toBe(stopResult.operationId);
    const statusMessages = sendMessage.mock.calls
      .map(([message]) => message as { type?: string; state?: string })
      .filter((message) => message.type === 'STUDYPILOT_LIVE_STATUS');
    expect(statusMessages.some((message) => message.state === 'error')).toBe(false);
  });

  it('rejects pause and resume commands while the runtime is idle', async () => {
    const { sendMessage } = installChrome();

    const paused = await pauseLive();
    const resumed = await resumeLive();

    expect(paused.state).toBe('idle');
    expect(resumed.state).toBe('idle');
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'OFFSCREEN_PAUSE' }));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'OFFSCREEN_RESUME' }));
  });
});
