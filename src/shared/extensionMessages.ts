import type {
  CaptureVisibleTabResult,
  DashboardChatMessage,
  DashboardChatSummary,
  DashboardSessionSummary,
  CoachingRequest,
  CoachingResponse,
  DashboardSaveResult,
  ExtensionAuthSession,
  ExtensionAuthState,
  LiveSessionStatus,
  PageContext,
  SharedChatContext,
  StudySession,
} from './types';
import type { SwToPanelLiveMessage } from '@/live/messages';

export type StudyPilotRuntimeMessage =
  | { type: 'STUDYPILOT_GET_PAGE_CONTEXT' }
  | { type: 'STUDYPILOT_GET_AUTH_STATUS' }
  | { type: 'STUDYPILOT_CONNECT_SESSION'; payload: ExtensionAuthSession }
  | { type: 'STUDYPILOT_DISCONNECT_SESSION' }
  | { type: 'STUDYPILOT_CAPTURE_VISIBLE_TAB' }
  | { type: 'STUDYPILOT_GET_SHARED_CONTEXT' }
  | { type: 'STUDYPILOT_GET_CHAT_MESSAGES'; payload: { chatId: string } }
  | { type: 'STUDYPILOT_CREATE_CHAT'; payload: { title: string; sessionId?: string | null } }
  | { type: 'STUDYPILOT_CONTINUE_SESSION'; payload: { sessionId: string; title: string } }
  | { type: 'STUDYPILOT_SELECT_CHAT'; payload: { chatId: string | null } }
  | { type: 'STUDYPILOT_REQUEST_COACHING'; payload: CoachingRequest }
  | { type: 'STUDYPILOT_LIVE_START'; payload: { chatId: string; captureScreenshot?: boolean } }
  | { type: 'STUDYPILOT_LIVE_STOP' }
  | { type: 'STUDYPILOT_LIVE_PAUSE' }
  | { type: 'STUDYPILOT_LIVE_RESUME' }
  | { type: 'STUDYPILOT_GET_LIVE_STATUS' }
  | {
      type: 'STUDYPILOT_SAVE_SESSION';
      payload: { chatId: string; session: StudySession; finalize?: boolean };
    }
  | { type: 'STUDYPILOT_OPEN_DASHBOARD'; payload?: { url?: string } }
  | { type: 'STUDYPILOT_OPEN_MODAL' }
  | { type: 'STUDYPILOT_TOGGLE_MODAL' };

export type StudyPilotResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type PageContextResponse = StudyPilotResponse<PageContext>;
export type AuthStatusResponse = StudyPilotResponse<ExtensionAuthState>;
export type CoachingRuntimeResponse = StudyPilotResponse<CoachingResponse>;
export type SharedChatContextResponse = StudyPilotResponse<SharedChatContext>;
export type ChatMessagesResponse = StudyPilotResponse<DashboardChatMessage[]>;
export type ChatResponse = StudyPilotResponse<DashboardChatSummary>;
export type SessionResponse = StudyPilotResponse<DashboardSessionSummary>;
export type LiveStatusResponse = StudyPilotResponse<LiveSessionStatus>;
export type CaptureVisibleTabResponse =
  StudyPilotResponse<CaptureVisibleTabResult>;
export type SaveSessionResponse = StudyPilotResponse<DashboardSaveResult>;
export type OpenDashboardResponse = StudyPilotResponse<{ opened: true }>;

export function isStudyPilotRuntimeMessage(
  message: unknown,
): message is StudyPilotRuntimeMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof (message as { type?: unknown }).type === 'string' &&
    (message as { type: string }).type.startsWith('STUDYPILOT_')
  );
}

export function isLiveFanoutMessage(
  message: unknown,
): message is SwToPanelLiveMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof (message as { type?: unknown }).type === 'string' &&
    (
      (message as { type: string }).type === 'STUDYPILOT_LIVE_STATUS' ||
      (message as { type: string }).type === 'STUDYPILOT_LIVE_TRANSCRIPT' ||
      (message as { type: string }).type === 'STUDYPILOT_LIVE_WARNING'
    )
  );
}

/** Panel must refuse any inbound payload that accidentally includes secrets. */
export function panelRejectsSecrets(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const record = message as Record<string, unknown>;
  return (
    'ephemeralToken' in record ||
    'websocketUrl' in record ||
    'bootstrap' in record ||
    'apiKey' in record ||
    (typeof record.token === 'string' && record.token.length > 20)
  );
}
