import type { PageContext, StudyFolder, StudySession, StudyTranscriptTurn } from '@/shared/types';

export interface StudySessionInput {
  page: PageContext;
  folder: StudyFolder;
  question: string;
  answer: string;
  transcript?: StudyTranscriptTurn[];
  screenshotDataUrl?: string;
  screenshotUrl?: string;
  tags?: string[];
}

export function createStudySession(input: StudySessionInput): StudySession {
  const durationSeconds =
    input.transcript && input.transcript.length > 0 ? Math.max(...input.transcript.map((turn) => turn.atSeconds)) : 0;

  return {
    id: crypto.randomUUID?.() ?? `study_${Date.now().toString(36)}`,
    title: input.page.sourceTitle || 'StudyPilot session',
    sourceUrl: input.page.sourceUrl,
    sourceTitle: input.page.sourceTitle || input.page.host,
    screenshotUrl: input.screenshotUrl,
    screenshotDataUrl: input.screenshotDataUrl,
    question: input.question,
    answer: input.answer,
    transcript: input.transcript,
    folder: input.folder,
    mode: 'Study Coach',
    durationSeconds,
    createdAt: new Date().toISOString(),
    tags: input.tags ?? ['screen-help', 'saved-explanation'],
  };
}

export function fallbackTranscript(question: string, answer: string): StudyTranscriptTurn[] {
  const turns: StudyTranscriptTurn[] = [
    { id: crypto.randomUUID(), sequence: 0, role: 'user', text: question, atSeconds: 0 },
    { id: crypto.randomUUID(), sequence: 1, role: 'ai', text: answer, atSeconds: 1 },
  ];

  return turns.filter((turn) => turn.text.trim().length > 0);
}
