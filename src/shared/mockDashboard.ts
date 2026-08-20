import type {
  DashboardSaveResult,
  PageContext,
  StudyFolder,
  StudySession,
} from './types';


// ---------------------------------------------------------------------------
// Config — set VITE_DASHBOARD_API_URL in .env to point at your backend.
// The extension client never holds dashboard API keys directly; the backend
// owns auth and persists sessions.
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_DASHBOARD_API_URL as string | undefined;

export const DASHBOARD_URL = 'https://app.studypilot.ai/sessions';

interface MockSessionInput {
  page: PageContext;
  folder: StudyFolder;
  question: string;
  answer: string;
  screenshotUrl?: string;
  tags?: string[];
}

// ------------------------------------------
// Real save — POST /sessions to your backend
// -----------------------------------------

export function createMockStudySession(input: MockSessionInput): StudySession {
  return {
    id: `study_${Date.now().toString(36)}`,
    title: input.page.sourceTitle || 'Study session',
    sourceUrl: input.page.sourceUrl,
    sourceTitle: input.page.sourceTitle || input.page.host,
    screenshotUrl: input.screenshotUrl,
    question: input.question,
    answer: input.answer,
    folder: input.folder,
    createdAt: new Date().toISOString(),
    tags: input.tags ?? ['screen-help', 'saved-explanation'],
  };
}

export async function saveStudySession(
  session: StudySession,
  authToken?: string,
): Promise<DashboardSaveResult> {
  if (!API_BASE) {
    return {
      ok: true,
      session,
      dashboardUrl: DASHBOARD_URL,
    };
  }

  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(session),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`[StudyPilot] Dashboard API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { session: StudySession; dashboardUrl: string };

  return {
    ok: true,
    session: data.session,
    dashboardUrl: data.dashboardUrl,
  };
}
