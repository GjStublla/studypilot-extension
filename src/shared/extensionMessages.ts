import type {
  CaptureVisibleTabResult,
  DashboardSaveResult,
  PageContext,
  StudySession,
} from './types';

export type StudyPilotRuntimeMessage =
  | { type: 'STUDYPILOT_GET_PAGE_CONTEXT' }
  | { type: 'STUDYPILOT_CAPTURE_VISIBLE_TAB' }
  | { type: 'STUDYPILOT_SAVE_SESSION'; payload: { session: StudySession } }
  | { type: 'STUDYPILOT_OPEN_DASHBOARD'; payload?: { url?: string } }
  | { type: 'STUDYPILOT_OPEN_MODAL' };

export type StudyPilotResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type PageContextResponse = StudyPilotResponse<PageContext>;
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
