import { describe, expect, it } from 'vitest';
import {
  buildSessionMessages,
  coachingRequestBody,
  parseCoachingSseStream,
} from './studypilotSupabase';
import type { CoachingRequest, StudySession } from './types';

const chatId = 'd43fbabc-5564-45db-a72e-6e373049743e';
const requestId = '949bd9f4-bc2d-490b-9b6f-bc730cf941ef';

function sseStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

function commit(overrides: Record<string, unknown> = {}) {
  return {
    type: 'commit',
    chatId,
    requestId,
    userMessageId: '80465bca-54f1-4e05-99f8-da1048667b81',
    assistantMessageId: '9832d772-37f3-4e26-83f2-546aaf4edbb8',
    userSequence: 12,
    assistantSequence: 13,
    ...overrides,
  };
}

describe('parseCoachingSseStream', () => {
  it('returns text only after a matching commit and done event', async () => {
    const stream = sseStream(
      'data: {"type":"token","text":"Shared "}\n',
      'data: {"text":"answer"}\n',
      `data: ${JSON.stringify(commit())}\n`,
      'data: [DONE]\n\n',
    );

    await expect(parseCoachingSseStream(stream, { chatId, requestId })).resolves.toEqual({
      text: 'Shared answer',
      commit: commit(),
    });
  });

  it('rejects done when the server did not commit the messages', async () => {
    const stream = sseStream('data: {"text":"uncommitted"}\ndata: [DONE]\n\n');

    await expect(parseCoachingSseStream(stream, { chatId, requestId })).rejects.toThrow(
      'stream ended before the response was saved',
    );
  });

  it('rejects a commit for a different request', async () => {
    const stream = sseStream(
      `data: ${JSON.stringify(commit({ requestId: crypto.randomUUID() }))}\n`,
      'data: [DONE]\n\n',
    );

    await expect(parseCoachingSseStream(stream, { chatId, requestId })).rejects.toThrow(
      'commit for a different request',
    );
  });

  it('rejects a connection that closes before done', async () => {
    const stream = sseStream(`data: ${JSON.stringify(commit())}\n`);

    await expect(parseCoachingSseStream(stream, { chatId, requestId })).rejects.toThrow(
      'stream closed before the response was committed',
    );
  });
});

describe('coachingRequestBody', () => {
  it('sends a plain canonical user message without client-side chat history', () => {
    const request: CoachingRequest = {
      chatId,
      requestId,
      action: 'explain',
      question: 'Why does this happen?',
      userMessage: 'Why does this happen?',
      originSurface: 'extension',
      page: {
        sourceUrl: 'https://example.test/lesson',
        sourceTitle: 'Lesson',
        host: 'example.test',
      },
      context: {
        screenshot: false,
        pageUrl: true,
        selectedText: false,
        saveToDashboard: true,
        folder: 'Biology 101',
      },
      clientContext: {
        page: { title: 'Lesson', url: 'https://example.test/lesson' },
        action: 'explain',
        integrity: 'Coach, do not complete assessed work.',
      },
    };

    expect(coachingRequestBody(request)).toEqual({
      chatId,
      requestId,
      userMessage: 'Why does this happen?',
      originSurface: 'extension',
      clientContext: request.clientContext,
      images: [],
    });
    expect(coachingRequestBody(request)).not.toHaveProperty('history');
  });
});

describe('buildSessionMessages', () => {
  it('uses canonical message ids without writing generated sequence columns', () => {
    const session: StudySession = {
      id: chatId,
      title: 'Cell biology',
      sourceUrl: 'https://example.test/cells',
      sourceTitle: 'Cells',
      question: 'What is ATP?',
      answer: 'It transfers energy.',
      folder: 'Biology 101',
      createdAt: '2026-08-04T09:00:00.000Z',
      tags: [],
      transcript: [
        {
          id: '9832d772-37f3-4e26-83f2-546aaf4edbb8',
          role: 'ai',
          text: ' It transfers energy. ',
          atSeconds: 2,
          sequence: 13,
        },
        {
          id: '80465bca-54f1-4e05-99f8-da1048667b81',
          role: 'user',
          text: 'What is ATP?',
          atSeconds: 1,
          sequence: 12,
        },
      ],
    };

    expect(buildSessionMessages(chatId, session)).toEqual([
      {
        id: '80465bca-54f1-4e05-99f8-da1048667b81',
        session_id: chatId,
        role: 'user',
        message_text: 'What is ATP?',
        time_offset_seconds: 1,
      },
      {
        id: '9832d772-37f3-4e26-83f2-546aaf4edbb8',
        session_id: chatId,
        role: 'ai',
        message_text: 'It transfers energy.',
        time_offset_seconds: 2,
      },
    ]);
  });
});
