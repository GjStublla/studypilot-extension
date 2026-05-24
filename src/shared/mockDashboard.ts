import type {
  DashboardSaveResult,
  PageContext,
  StudyFolder,
  StudySession,
} from './types';

export const DASHBOARD_URL = 'https://app.studypilot.ai/sessions';

interface MockSessionInput {
  page: PageContext;
  folder: StudyFolder;
  question: string;
  answer: string;
  screenshotUrl?: string;
  tags?: string[];
}

const delay = (ms: number) => new Promise(resolve => globalThis.setTimeout(resolve, ms));

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
): Promise<DashboardSaveResult> {
  // TODO: Replace this mock with a real dashboard API call from a trusted
  // backend. Do not put dashboard API keys in the extension client.
  await delay(500);

  return {
    ok: true,
    session,
    dashboardUrl: DASHBOARD_URL,
  };
}
