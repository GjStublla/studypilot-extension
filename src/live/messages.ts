/**
 * Live messaging protocol.
 *
 * SECURITY: Vertex Live OAuth access tokens (and legacy ephemeralToken alias)
 * exist ONLY on the SW ↔ offscreen channel. Content panel messages must NEVER
 * carry accessToken / ephemeralToken / bootstrap / websocketUrl.
 */

import type { SessionPrivacyOptions } from '@/shared/types';

export type LiveUiState = 'idle' | 'starting' | 'connecting' | 'live' | 'paused' | 'stopping' | 'error';

export type LiveSelection = {
  chatId: string | null;
  rubricId: string | null;
  sessionId: string | null;
};

/** Gemini Live content turn (matches live-token initialTurns). */
export type GeminiContentTurn = {
  role: string;
  parts: Array<{ text?: string; [key: string]: unknown }>;
};

/** Bootstrap from live-token — SW → offscreen only. */
export type LiveBootstrap = {
  /**
   * Compat alias: live-token sets ephemeralToken = accessToken for older clients.
   * Prefer accessToken for Vertex OAuth.
   */
  ephemeralToken: string;
  /** Short-lived Vertex OAuth access token (primary auth for BidiGenerateContent). */
  accessToken?: string;
  authMode?: 'vertex' | 'gemini-ephemeral';
  /** Vertex Live WS base URL from live-token (BidiGenerateContent). */
  websocketUrl?: string;
  expiresAt: string;
  /** Live WebSocket apiVersion from live-token (v1beta1 on Vertex). */
  apiVersion?: string;
  model?: string;
  systemInstruction?: string;
  sessionId: string | null;
  chatId: string;
  liveSessionId: string;
  rubricId?: string | null;
  resumptionHandle?: string | null;
  /** Server-built history from live-token.initialTurns — pass through to sendClientContent. */
  initialTurns: GeminiContentTurn[];
};

export type TranscriptRole = 'user' | 'assistant';

export type PanelLiveControlMessage =
  | {
      type: 'STUDYPILOT_LIVE_START';
      payload: {
        chatId: string;
        privacy: SessionPrivacyOptions;
      };
    }
  | { type: 'STUDYPILOT_LIVE_STOP' }
  | { type: 'STUDYPILOT_LIVE_PAUSE' }
  | { type: 'STUDYPILOT_LIVE_RESUME' }
  | { type: 'STUDYPILOT_GET_LIVE_STATUS' };

export type SwToPanelLiveMessage =
  | {
      type: 'STUDYPILOT_LIVE_STATUS';
      state: LiveUiState;
      /** Monotonic service-worker control operation; older fan-out is stale. */
      operationId?: number;
      selection: LiveSelection;
      selectionFrozen: boolean;
      error?: string | null;
      warning?: string | null;
      fallback?: 'text-coaching' | null;
      rubric?: {
        id: string;
        title: string;
        fileSearchStatus?: string | null;
        criteriaCount?: number;
      } | null;
      ragReady?: boolean;
    }
  | {
      type: 'STUDYPILOT_LIVE_TRANSCRIPT';
      role: TranscriptRole;
      text: string;
      finalized: boolean;
    }
  | {
      type: 'STUDYPILOT_LIVE_WARNING';
      message: string;
    };

export type SwToOffscreenMessage =
  | {
      type: 'OFFSCREEN_CONNECT';
      bootstrap: LiveBootstrap;
      /** base64 JPEG (no data: prefix) */
      screenshotJpegBase64?: string | null;
      /** true only for a brand-new Live; false on session resumption */
      seedHistoryAndScreenshot: boolean;
    }
  | { type: 'OFFSCREEN_DISCONNECT'; reason?: string }
  | { type: 'OFFSCREEN_PAUSE' }
  | { type: 'OFFSCREEN_RESUME' }
  | {
      type: 'OFFSCREEN_TOOL_RESPONSE';
      functionResponses: Array<{
        id: string;
        name: string;
        response: Record<string, unknown>;
      }>;
    }
  | { type: 'OFFSCREEN_PING' };

export type OffscreenToSwMessage =
  | { type: 'OFFSCREEN_READY' }
  | { type: 'OFFSCREEN_PONG' }
  | {
      type: 'LIVE_MACHINE_STATE';
      state: 'connecting' | 'live' | 'paused' | 'closing' | 'closed' | 'error';
      error?: string;
    }
  | {
      type: 'LIVE_TRANSCRIPT_PARTIAL';
      role: TranscriptRole;
      text: string;
    }
  | {
      type: 'LIVE_TURN_FINAL';
      userText: string | null;
      assistantText: string | null;
      warning?: string;
    }
  | {
      type: 'LIVE_TOOL_CALL';
      callId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: 'LIVE_RESUMPTION_UPDATE'; handle: string }
  | { type: 'LIVE_GO_AWAY'; timeLeftMs?: number }
  | { type: 'LIVE_INTERRUPTED' }
  | { type: 'LIVE_CONNECT_FAILED'; message: string };

/** Strip secrets before any panel fan-out. */
export function sanitizeForPanel(msg: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...msg };
  delete clone.ephemeralToken;
  delete clone.accessToken;
  delete clone.websocketUrl;
  delete clone.bootstrap;
  delete clone.token;
  delete clone.apiKey;
  return clone;
}

export function isOffscreenMessage(type: string): boolean {
  return (
    type.startsWith('OFFSCREEN_') ||
    type.startsWith('LIVE_MACHINE_') ||
    type === 'LIVE_TRANSCRIPT_PARTIAL' ||
    type === 'LIVE_TURN_FINAL' ||
    type === 'LIVE_TOOL_CALL' ||
    type === 'LIVE_RESUMPTION_UPDATE' ||
    type === 'LIVE_GO_AWAY' ||
    type === 'LIVE_INTERRUPTED' ||
    type === 'LIVE_CONNECT_FAILED'
  );
}
