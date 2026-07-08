import type {
  CaptureVisibleTabResult,
  CoachingRequest,
  CoachingResponse,
  DashboardSaveResult,
  ExtensionAuthSession,
  ExtensionAuthState,
  LiveTokenResult,
  PageContext,
  StudySession,
} from './types';

export type StudyPilotRuntimeMessage =
  | { type: 'STUDYPILOT_GET_PAGE_CONTEXT' }
  | { type: 'STUDYPILOT_GET_AUTH_STATUS' }
  | { type: 'STUDYPILOT_CONNECT_SESSION'; payload: ExtensionAuthSession }
  | { type: 'STUDYPILOT_DISCONNECT_SESSION' }
  | { type: 'STUDYPILOT_CAPTURE_VISIBLE_TAB' }
  | { type: 'STUDYPILOT_REQUEST_COACHING'; payload: CoachingRequest }
  | { type: 'STUDYPILOT_GET_LIVE_TOKEN'; payload?: { sessionId?: string } }
  | { type: 'STUDYPILOT_SAVE_SESSION'; payload: { session: StudySession } }
  | { type: 'STUDYPILOT_OPEN_DASHBOARD'; payload?: { url?: string } }
  | { type: 'STUDYPILOT_OPEN_MODAL' }
  | { type: 'STUDYPILOT_TOGGLE_MODAL' };

export type StudyPilotResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type PageContextResponse = StudyPilotResponse<PageContext>;
export type AuthStatusResponse = StudyPilotResponse<ExtensionAuthState>;
export type CoachingRuntimeResponse = StudyPilotResponse<CoachingResponse>;
export type LiveTokenResponse = StudyPilotResponse<LiveTokenResult>;
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
