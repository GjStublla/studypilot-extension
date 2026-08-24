/**
 * Live session lifecycle owned by the service worker.
 *
 * SECURITY: Vertex Live accessToken from live-token is passed ONLY to the
 * offscreen document. Content panel receives status / transcripts — never
 * bootstrap or tokens.
 */

import {
  canCommitLiveTurn,
  commitLiveTurn,
  fetchLiveRubricSearch,
  fetchLiveToken,
  finishLiveSession,
  resolveLiveAuth,
  type LiveTokenResponse,
  type LiveTurnRequest,
} from '@/shared/liveEdge';
import type {
  GeminiContentTurn,
  LiveBootstrap,
  LiveSelection,
  LiveUiState,
  OffscreenToSwMessage,
  SwToOffscreenMessage,
  SwToPanelLiveMessage,
} from '@/live/messages';
import { sanitizeForPanel } from '@/live/messages';
import type { SessionPrivacyOptions } from '@/shared/types';
import { DEFAULT_SESSION_PRIVACY } from '@/shared/types';

const OFFSCREEN_URL = 'src/offscreen.html';
const OFFSCREEN_REASONS: chrome.offscreen.Reason[] = [
  'USER_MEDIA' as chrome.offscreen.Reason,
  'AUDIO_PLAYBACK' as chrome.offscreen.Reason,
];

const STORAGE = {
  selection: 'studypilot.live.selection',
  resumption: 'studypilot.live.resumption',
  pendingTurns: 'studypilot.live.pendingTurns',
} as const;

const MAX_RESUMPTION_RECONNECTS = 3;

type PendingTurn = LiveTurnRequest & { queuedAt: number };

type RuntimeLive = {
  state: LiveUiState;
  operationId: number;
  selection: LiveSelection;
  selectionFrozen: boolean;
  error: string | null;
  warning: string | null;
  fallback: 'text-coaching' | null;
  hasSeededSession: boolean;
  resumptionHandle: string | null;
  liveSessionId: string | null;
  startedAtMs: number | null;
  pendingTurns: PendingTurn[];
  rubric: LiveTokenResponse['rubric'];
  ragReady: boolean;
  privacy: SessionPrivacyOptions;
  /** True while GoAway / unexpected-close reconnect is in flight — ignore transient closed. */
  reconnecting: boolean;
  reconnectAttempts: number;
};

const live: RuntimeLive = {
  state: 'idle',
  operationId: 0,
  selection: { chatId: null, rubricId: null, sessionId: null },
  selectionFrozen: false,
  error: null,
  warning: null,
  fallback: null,
  hasSeededSession: false,
  resumptionHandle: null,
  liveSessionId: null,
  startedAtMs: null,
  pendingTurns: [],
  rubric: null,
  ragReady: false,
  privacy: { ...DEFAULT_SESSION_PRIVACY },
  reconnecting: false,
  reconnectAttempts: 0,
};

export function isCurrentLiveRuntimeOperation(
  operationId: number,
  latestOperationId: number,
): boolean {
  return operationId === latestOperationId;
}

function isCurrentOperation(operationId: number): boolean {
  return isCurrentLiveRuntimeOperation(operationId, live.operationId);
}

function normalizeInitialTurns(raw: unknown): GeminiContentTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: GeminiContentTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = typeof (item as { role?: unknown }).role === 'string'
      ? (item as { role: string }).role
      : null;
    const parts = (item as { parts?: unknown }).parts;
    if (!role || !Array.isArray(parts)) continue;
    turns.push({
      role,
      parts: parts.filter((p) => p && typeof p === 'object') as GeminiContentTurn['parts'],
    });
  }
  return turns;
}

async function persistPendingTurns(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE.pendingTurns]: live.pendingTurns });
}

export async function restoreLivePersisted(): Promise<void> {
  const data = await chrome.storage.local.get([
    STORAGE.selection,
    STORAGE.resumption,
    STORAGE.pendingTurns,
  ]);
  const sel = data[STORAGE.selection] as LiveSelection | undefined;
  if (sel) live.selection = sel;
  const handle = data[STORAGE.resumption] as string | undefined;
  if (handle) live.resumptionHandle = handle;
  const pending = data[STORAGE.pendingTurns] as PendingTurn[] | undefined;
  if (pending?.length) live.pendingTurns = pending;
}

function statusMessage(): SwToPanelLiveMessage {
  return {
    type: 'STUDYPILOT_LIVE_STATUS',
    state: live.state,
    operationId: live.operationId,
    selection: { ...live.selection },
    selectionFrozen: live.selectionFrozen,
    error: live.error,
    warning: live.warning,
    fallback: live.fallback,
    rubric: live.rubric,
    ragReady: live.ragReady,
  };
}

async function broadcastToPanels(msg: SwToPanelLiveMessage): Promise<void> {
  const safe = sanitizeForPanel(msg as unknown as Record<string, unknown>);
  try {
    await chrome.runtime.sendMessage(safe);
  } catch {
    // no extension-page receivers
  }
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      try {
        await chrome.tabs.sendMessage(tab.id, safe);
      } catch {
        // tab without content script
      }
    }),
  );
}

async function setState(partial: Partial<RuntimeLive>): Promise<void> {
  Object.assign(live, partial);
  await broadcastToPanels(statusMessage());
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: OFFSCREEN_REASONS,
    justification:
      'Gemini Live mic capture, PCM playback, and WebSocket session must outlive tab navigation.',
  });

  await new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = () => {
      void chrome.runtime
        .sendMessage({ type: 'OFFSCREEN_PING' } satisfies SwToOffscreenMessage)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - started > 5000) resolve();
          else setTimeout(tick, 50);
        });
    };
    tick();
  });
}

async function sendToOffscreen(msg: SwToOffscreenMessage): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage(msg);
}

async function captureActiveTabJpeg(windowId?: number): Promise<string | null> {
  try {
    const dataUrl =
      typeof windowId === 'number'
        ? await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 55 })
        : await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 55 });
    return dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
  } catch {
    return null;
  }
}

async function flushPendingTurns(): Promise<void> {
  if (!live.pendingTurns.length) return;
  const remaining: PendingTurn[] = [];
  let droppedPartial = 0;
  for (const turn of live.pendingTurns) {
    if (!canCommitLiveTurn(turn.userText, turn.assistantText)) {
      droppedPartial += 1;
      continue;
    }
    try {
      await commitLiveTurn(turn);
    } catch {
      remaining.push(turn);
    }
  }
  live.pendingTurns = remaining;
  await persistPendingTurns();
  if (droppedPartial) {
    live.warning =
      `Dropped ${droppedPartial} unsaved turn(s) with partial transcripts (both sides required).`;
    await broadcastToPanels(statusMessage());
  }
  if (remaining.length) {
    live.warning = `Failed to flush ${remaining.length} turn(s). Will retry on next stop.`;
    await broadcastToPanels(statusMessage());
  }
}

/**
 * Reconnect the Gemini Live WebSocket using the stored session resumption handle.
 * Does NOT reseed history or screenshot. Same liveSessionId; fresh Vertex access token.
 */
async function reconnectWithResumption(trigger: 'go_away' | 'closed'): Promise<void> {
  if (live.reconnecting) return;
  if (
    live.state === 'idle' ||
    live.state === 'stopping' ||
    live.state === 'starting' ||
    live.state === 'error'
  ) {
    return;
  }

  const handle = live.resumptionHandle;
  const liveSessionId = live.liveSessionId;
  const chatId = live.selection.chatId;
  if (!handle || !liveSessionId || !chatId) {
    live.warning =
      trigger === 'go_away'
        ? 'GoAway received without a resumption handle — cannot reconnect this Live session.'
        : 'Live connection closed without a resumption handle.';
    await broadcastToPanels({ type: 'STUDYPILOT_LIVE_WARNING', message: live.warning });
    return;
  }

  if (live.reconnectAttempts >= MAX_RESUMPTION_RECONNECTS) {
    await setState({
      state: 'error',
      error: 'Live reconnect failed too many times',
      fallback: 'text-coaching',
      selectionFrozen: false,
      warning: 'Live could not resume after GoAway. Use text coaching as a fallback.',
      reconnecting: false,
    });
    return;
  }

  live.reconnecting = true;
  live.reconnectAttempts += 1;
  await setState({
    state: 'connecting',
    warning: `Reconnecting Live session (${live.reconnectAttempts}/${MAX_RESUMPTION_RECONNECTS})…`,
    error: null,
  });

  try {
    try {
      await sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT', reason: 'resumption_reconnect' });
    } catch {
      // offscreen may already be closed
    }

    // Same liveSessionId → start_live_chat_session replays; new Vertex access token.
    const tokenRes = await fetchLiveToken({
      liveSessionId,
      chatId,
      saveToDashboard: live.privacy.saveToDashboard,
      mode: 'Study Coach',
      quotaRequestId: liveSessionId,
    });

    const auth = resolveLiveAuth(tokenRes);

    if (tokenRes.sessionId) {
      live.selection.sessionId = tokenRes.sessionId;
    }
    if (tokenRes.rubric?.id) {
      live.selection.rubricId = tokenRes.rubric.id;
    }
    live.rubric = tokenRes.rubric ?? live.rubric;
    live.ragReady = Boolean(tokenRes.ragReady);
    await chrome.storage.local.set({ [STORAGE.selection]: live.selection });

    const expiresAt =
      tokenRes.expireTime ||
      tokenRes.expiresAt ||
      new Date(Date.now() + 30 * 60_000).toISOString();

    const bootstrap: LiveBootstrap = {
      ephemeralToken: auth.ephemeralToken,
      accessToken: auth.accessToken,
      authMode: auth.authMode,
      websocketUrl: auth.websocketUrl,
      expiresAt,
      apiVersion: tokenRes.apiVersion,
      model: tokenRes.model,
      systemInstruction: tokenRes.systemInstruction,
      sessionId: tokenRes.sessionId ?? live.selection.sessionId,
      chatId: tokenRes.chatId || chatId,
      liveSessionId,
      rubricId: live.selection.rubricId,
      resumptionHandle: handle,
      // Never reseed history/screenshot on session resumption.
      initialTurns: [],
    };

    await sendToOffscreen({
      type: 'OFFSCREEN_CONNECT',
      bootstrap,
      screenshotJpegBase64: null,
      seedHistoryAndScreenshot: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    live.reconnecting = false;
    if (live.reconnectAttempts < MAX_RESUMPTION_RECONNECTS) {
      live.warning = `Live resume failed (${message}). Retrying…`;
      await broadcastToPanels({ type: 'STUDYPILOT_LIVE_WARNING', message: live.warning });
      // Brief backoff then retry while handle is still valid.
      await new Promise((r) => setTimeout(r, 750));
      await reconnectWithResumption(trigger);
      return;
    }
    await setState({
      state: 'error',
      error: message,
      fallback: 'text-coaching',
      selectionFrozen: false,
      warning: 'Live could not resume after reconnect. Use text coaching as a fallback.',
      reconnecting: false,
    });
  }
}

export function getLiveStatusMessage(): SwToPanelLiveMessage {
  return statusMessage();
}

export async function startLive(opts: {
  chatId: string;
  privacy: SessionPrivacyOptions;
  windowId?: number;
  page?: { title?: string; url?: string };
}): Promise<SwToPanelLiveMessage> {
  if (
    live.state === 'live' ||
    live.state === 'connecting' ||
    live.state === 'starting' ||
    live.state === 'paused' ||
    live.state === 'stopping'
  ) {
    throw new Error('Live already active. Stop the current session before starting another.');
  }

  if (!opts.chatId) {
    throw new Error('Select a shared chat before starting Live.');
  }

  const operationId = ++live.operationId;

  await setState({
    state: 'starting',
    error: null,
    warning: null,
    fallback: null,
    selectionFrozen: true,
    rubric: null,
    ragReady: false,
  });
  if (!isCurrentOperation(operationId)) return statusMessage();

  try {
    // Startup order: resolve chat → screenshot → bootstrap → connect → history → video → mic
    live.selection = {
      chatId: opts.chatId,
      sessionId: live.selection.sessionId,
      rubricId: live.selection.rubricId,
    };
    await chrome.storage.local.set({ [STORAGE.selection]: live.selection });

    const liveSessionId = crypto.randomUUID();
    live.liveSessionId = liveSessionId;
    live.startedAtMs = Date.now();
    live.privacy = {
      captureScreenshot: opts.privacy.captureScreenshot,
      saveToDashboard: opts.privacy.saveToDashboard,
    };

    // Each LIVE_START creates a new live_chat_sessions row — always seed history.
    // Session resumption reconnects (same Live) skip reseeding; we do not reseed here.
    const seed = true;
    live.resumptionHandle = null;
    const screenshot = opts.privacy.captureScreenshot
      ? await captureActiveTabJpeg(opts.windowId)
      : null;
    if (!isCurrentOperation(operationId)) return statusMessage();

    await setState({ state: 'connecting' });
    if (!isCurrentOperation(operationId)) return statusMessage();

    const tokenRes = await fetchLiveToken({
      liveSessionId,
      chatId: opts.chatId,
      saveToDashboard: opts.privacy.saveToDashboard,
      page: opts.page,
      mode: 'Study Coach',
      quotaRequestId: liveSessionId,
    });
    if (!isCurrentOperation(operationId)) return statusMessage();

    const auth = resolveLiveAuth(tokenRes);

    if (tokenRes.sessionId) {
      live.selection.sessionId = tokenRes.sessionId;
    }
    if (tokenRes.rubric?.id) {
      live.selection.rubricId = tokenRes.rubric.id;
    }
    live.rubric = tokenRes.rubric ?? null;
    live.ragReady = Boolean(tokenRes.ragReady);
    await chrome.storage.local.set({ [STORAGE.selection]: live.selection });
    if (!isCurrentOperation(operationId)) return statusMessage();

    const expiresAt =
      tokenRes.expireTime ||
      tokenRes.expiresAt ||
      new Date(Date.now() + 30 * 60_000).toISOString();

    const initialTurns = normalizeInitialTurns(tokenRes.initialTurns);

    live.reconnectAttempts = 0;
    live.reconnecting = false;

    const bootstrap: LiveBootstrap = {
      ephemeralToken: auth.ephemeralToken,
      accessToken: auth.accessToken,
      authMode: auth.authMode,
      websocketUrl: auth.websocketUrl,
      expiresAt,
      apiVersion: tokenRes.apiVersion,
      model: tokenRes.model,
      systemInstruction: tokenRes.systemInstruction,
      sessionId: tokenRes.sessionId ?? live.selection.sessionId,
      chatId: tokenRes.chatId || opts.chatId,
      liveSessionId,
      rubricId: live.selection.rubricId,
      // Fresh LIVE_START — do not attach a prior resumption handle.
      resumptionHandle: null,
      initialTurns,
    };

    // Token stays on SW → offscreen only. Never include in broadcastToPanels.
    await sendToOffscreen({
      type: 'OFFSCREEN_CONNECT',
      bootstrap,
      screenshotJpegBase64: screenshot,
      seedHistoryAndScreenshot: seed,
    });
    if (!isCurrentOperation(operationId)) return statusMessage();

    live.hasSeededSession = true;
    return statusMessage();
  } catch (err) {
    if (!isCurrentOperation(operationId)) return statusMessage();
    const message = err instanceof Error ? err.message : String(err);
    live.liveSessionId = null;
    live.startedAtMs = null;
    await setState({
      state: 'error',
      error: message,
      fallback: 'text-coaching',
      selectionFrozen: false,
      warning:
        'Live coaching could not be provisioned. Use text coaching as a fallback.',
    });
    throw err;
  }
}

export async function stopLive(
  reason: 'user_stop' | 'error' | 'go_away' = 'user_stop',
): Promise<SwToPanelLiveMessage> {
  const operationId = ++live.operationId;
  await setState({ state: 'stopping' });
  if (!isCurrentOperation(operationId)) return statusMessage();
  try {
    await sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT', reason });
  } catch {
    // offscreen may already be gone
  }
  if (!isCurrentOperation(operationId)) return statusMessage();

  await flushPendingTurns();
  if (!isCurrentOperation(operationId)) return statusMessage();

  try {
    if (live.liveSessionId) {
      const durationSeconds =
        live.startedAtMs != null
          ? Math.max(0, Math.floor((Date.now() - live.startedAtMs) / 1000))
          : undefined;
      await finishLiveSession({
        liveSessionId: live.liveSessionId,
        reason,
        status: reason === 'error' ? 'failed' : 'finished',
        durationSeconds,
        resumeHandle: live.resumptionHandle,
      });
    }
  } catch (err) {
    live.warning =
      err instanceof Error ? `live-finish failed: ${err.message}` : 'live-finish failed';
  }

  if (!isCurrentOperation(operationId)) return statusMessage();

  live.hasSeededSession = false;
  live.liveSessionId = null;
  live.startedAtMs = null;
  live.resumptionHandle = null;
  live.reconnecting = false;
  live.reconnectAttempts = 0;
  await chrome.storage.local.remove(STORAGE.resumption);
  if (!isCurrentOperation(operationId)) return statusMessage();
  await setState({
    state: 'idle',
    selectionFrozen: false,
    error: null,
    fallback: null,
  });
  return statusMessage();
}

export async function pauseLive(): Promise<SwToPanelLiveMessage> {
  if (live.state !== 'live') return statusMessage();

  const operationId = ++live.operationId;
  await sendToOffscreen({ type: 'OFFSCREEN_PAUSE' });
  if (!isCurrentOperation(operationId)) return statusMessage();
  await setState({ state: 'paused' });
  if (!isCurrentOperation(operationId)) return statusMessage();
  return statusMessage();
}

export async function resumeLive(): Promise<SwToPanelLiveMessage> {
  if (live.state !== 'paused') return statusMessage();

  const operationId = ++live.operationId;
  await sendToOffscreen({ type: 'OFFSCREEN_RESUME' });
  if (!isCurrentOperation(operationId)) return statusMessage();
  await setState({ state: 'live' });
  if (!isCurrentOperation(operationId)) return statusMessage();
  return statusMessage();
}

async function handleToolCall(msg: Extract<OffscreenToSwMessage, { type: 'LIVE_TOOL_CALL' }>) {
  if (msg.name !== 'search_rubric') {
    await sendToOffscreen({
      type: 'OFFSCREEN_TOOL_RESPONSE',
      functionResponses: [
        {
          id: msg.callId,
          name: msg.name,
          response: { error: `Unknown tool: ${msg.name}` },
        },
      ],
    });
    return;
  }

  try {
    if (!live.liveSessionId) {
      throw new Error('No active live session for rubric search');
    }
    const result = await fetchLiveRubricSearch({
      liveSessionId: live.liveSessionId,
      requestId: crypto.randomUUID(),
      query: String(msg.args.query ?? ''),
    });
    await sendToOffscreen({
      type: 'OFFSCREEN_TOOL_RESPONSE',
      functionResponses: [
        {
          id: msg.callId,
          name: msg.name,
          response: {
            evidence: result.evidence ?? '',
            citations: result.citations ?? [],
            usedFileSearch: result.usedFileSearch ?? false,
            message: result.message,
          },
        },
      ],
    });
  } catch (err) {
    await sendToOffscreen({
      type: 'OFFSCREEN_TOOL_RESPONSE',
      functionResponses: [
        {
          id: msg.callId,
          name: msg.name,
          response: { error: err instanceof Error ? err.message : String(err) },
        },
      ],
    });
  }
}

export async function handleOffscreenLiveMessage(msg: OffscreenToSwMessage): Promise<void> {
  switch (msg.type) {
    case 'OFFSCREEN_READY':
    case 'OFFSCREEN_PONG':
    case 'LIVE_INTERRUPTED':
      break;
    case 'LIVE_MACHINE_STATE':
      if (msg.state === 'live') {
        live.reconnecting = false;
        live.reconnectAttempts = 0;
        await setState({ state: 'live', error: null, warning: live.warning });
      } else if (msg.state === 'paused') await setState({ state: 'paused' });
      else if (msg.state === 'error') {
        live.reconnecting = false;
        await setState({
          state: 'error',
          error: msg.error ?? 'Live error',
          fallback: 'text-coaching',
          selectionFrozen: false,
        });
      } else if (
        msg.state === 'closed' &&
        !live.reconnecting &&
        live.state !== 'idle' &&
        live.state !== 'stopping'
      ) {
        // Unexpected close mid-session: try resumption before giving up.
        if (live.resumptionHandle && live.liveSessionId && live.selection.chatId) {
          void reconnectWithResumption('closed');
        } else {
          await setState({ state: 'idle', selectionFrozen: false });
        }
      }
      break;
    case 'LIVE_TRANSCRIPT_PARTIAL':
      await broadcastToPanels({
        type: 'STUDYPILOT_LIVE_TRANSCRIPT',
        role: msg.role,
        text: msg.text,
        finalized: false,
      });
      break;
    case 'LIVE_TURN_FINAL': {
      const savable = canCommitLiveTurn(msg.userText, msg.assistantText);
      const warning =
        msg.warning ||
        (!savable
          ? 'Unsaved turn: both user and assistant transcripts are required.'
          : undefined);
      if (warning) {
        live.warning = warning;
        await broadcastToPanels({ type: 'STUDYPILOT_LIVE_WARNING', message: warning });
      }
      await broadcastToPanels({
        type: 'STUDYPILOT_LIVE_TRANSCRIPT',
        role: 'user',
        text: msg.userText ?? '',
        finalized: true,
      });
      await broadcastToPanels({
        type: 'STUDYPILOT_LIVE_TRANSCRIPT',
        role: 'assistant',
        text: msg.assistantText ?? '',
        finalized: true,
      });

      // Never commit or queue partial turns — commit_live_turn requires both texts.
      if (!savable || !live.liveSessionId) {
        break;
      }

      const elapsedSeconds =
        live.startedAtMs != null
          ? Math.max(0, Math.floor((Date.now() - live.startedAtMs) / 1000))
          : 0;
      const turn: PendingTurn = {
        liveSessionId: live.liveSessionId,
        requestId: crypto.randomUUID(),
        userMessageId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
        userText: msg.userText?.trim() ?? null,
        assistantText: msg.assistantText?.trim() ?? null,
        timeOffsetSeconds: elapsedSeconds,
        originSurface: 'extension',
        queuedAt: Date.now(),
      };
      try {
        await commitLiveTurn(turn);
      } catch {
        live.pendingTurns.push(turn);
        await persistPendingTurns();
      }
      break;
    }
    case 'LIVE_TOOL_CALL':
      await handleToolCall(msg);
      break;
    case 'LIVE_RESUMPTION_UPDATE':
      live.resumptionHandle = msg.handle;
      await chrome.storage.local.set({ [STORAGE.resumption]: msg.handle });
      break;
    case 'LIVE_GO_AWAY': {
      const tip =
        msg.timeLeftMs != null
          ? `Gemini GoAway in ${msg.timeLeftMs}ms — reconnecting with resumption handle.`
          : 'Gemini GoAway — reconnecting with resumption handle.';
      live.warning = tip;
      await broadcastToPanels({ type: 'STUDYPILOT_LIVE_WARNING', message: tip });
      void reconnectWithResumption('go_away');
      break;
    }
    case 'LIVE_CONNECT_FAILED':
      live.reconnecting = false;
      if (
        live.resumptionHandle &&
        live.liveSessionId &&
        live.reconnectAttempts < MAX_RESUMPTION_RECONNECTS &&
        live.state !== 'idle' &&
        live.state !== 'stopping'
      ) {
        live.warning = `Live connect failed (${msg.message}). Retrying resume…`;
        await broadcastToPanels({ type: 'STUDYPILOT_LIVE_WARNING', message: live.warning });
        void reconnectWithResumption('go_away');
        break;
      }
      await setState({
        state: 'error',
        error: msg.message,
        fallback: 'text-coaching',
        selectionFrozen: false,
        warning:
          'Live coaching could not start. Use text coaching in the panel or dashboard instead.',
      });
      break;
  }
}

export function isLiveActive(): boolean {
  return (
    live.state === 'live' ||
    live.state === 'connecting' ||
    live.state === 'starting' ||
    live.state === 'paused'
  );
}
