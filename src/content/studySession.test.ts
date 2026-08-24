import { describe, expect, it } from 'vitest';
import type { PageContext, StudyTranscriptTurn } from '@/shared/types';
import { createStudySession, fallbackTranscript } from './studySession';

const page: PageContext = {
  sourceUrl: 'https://example.test/lesson',
  sourceTitle: 'Lesson notes',
  host: 'example.test',
};

const transcript: StudyTranscriptTurn[] = [
  { id: 'turn-1', sequence: 0, role: 'user', text: 'Explain this', atSeconds: 0 },
  { id: 'turn-2', sequence: 1, role: 'ai', text: 'Here is the explanation', atSeconds: 8 },
];

describe('study session utilities', () => {
  it('creates a dashboard-ready session with transcript duration and defaults', () => {
    const session = createStudySession({
      page,
      folder: 'Biology 101',
      question: 'Explain this',
      answer: 'Here is the explanation',
      transcript,
    });

    expect(session).toMatchObject({
      title: 'Lesson notes',
      sourceUrl: 'https://example.test/lesson',
      sourceTitle: 'Lesson notes',
      question: 'Explain this',
      answer: 'Here is the explanation',
      transcript,
      folder: 'Biology 101',
      mode: 'Study Coach',
      durationSeconds: 8,
      tags: ['screen-help', 'saved-explanation'],
    });
    expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(session.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps explicit tags and uses zero duration without a transcript', () => {
    const session = createStudySession({
      page,
      folder: 'History Midterm',
      question: 'What changed?',
      answer: 'The timeline shifted.',
      tags: ['custom'],
    });

    expect(session.durationSeconds).toBe(0);
    expect(session.tags).toEqual(['custom']);
  });

  it('filters blank fallback turns while preserving meaningful answer text', () => {
    const turns = fallbackTranscript('  ', 'A useful answer');

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      role: 'ai',
      text: 'A useful answer',
      sequence: 1,
      atSeconds: 1,
    });
  });
});
