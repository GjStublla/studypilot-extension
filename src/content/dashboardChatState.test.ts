import { describe, expect, it } from 'vitest';
import type { DashboardChatMessage, SharedChatContext } from '@/shared/types';
import { presentCanonicalChat, resolveSharedChatId } from './dashboardChatState';

function message(
  role: DashboardChatMessage['role'],
  text: string,
  sequence: number,
): DashboardChatMessage {
  return {
    id: `message-${sequence}`,
    chatId: 'chat-1',
    sessionId: null,
    role,
    text,
    sequence,
    requestId: null,
    originSurface: 'extension',
    createdAt: '2026-08-04T12:00:00.000Z',
  };
}

const context: SharedChatContext = {
  userId: 'user-1',
  chats: [
    {
      id: 'chat-1',
      sessionId: null,
      title: 'First chat',
      createdAt: '2026-08-04T12:00:00.000Z',
      updatedAt: '2026-08-04T12:00:00.000Z',
    },
    {
      id: 'chat-2',
      sessionId: null,
      title: 'Second chat',
      createdAt: '2026-08-04T12:00:00.000Z',
      updatedAt: '2026-08-04T12:00:00.000Z',
    },
  ],
  sessions: [],
  activeChatId: 'chat-1',
};

describe('resolveSharedChatId', () => {
  it('keeps a valid preferred chat across a refresh', () => {
    expect(resolveSharedChatId(context, 'chat-2')).toBe('chat-2');
  });

  it('falls back to the server active chat when the preference is absent', () => {
    expect(resolveSharedChatId(context)).toBe('chat-1');
  });

  it('clears selection when neither requested chat exists', () => {
    expect(resolveSharedChatId(context, 'missing-chat')).toBeNull();
  });
});

describe('presentCanonicalChat', () => {
  it('hides system rows while preserving visible transcript order', () => {
    const presentation = presentCanonicalChat([
      message('system', 'internal metadata', 0),
      message('user', 'Explain this', 1),
      message('ai', 'Here is the explanation', 2),
    ]);

    expect(presentation.messages.map(item => item.role)).toEqual(['user', 'ai']);
    expect(presentation.transcript.map(item => item.text)).toEqual([
      'Explain this',
      'Here is the explanation',
    ]);
    expect(presentation.lastQuestion).toBe('Explain this');
    expect(presentation.card).toEqual({
      title: 'Coach response',
      body: 'Here is the explanation',
    });
    expect(presentation.phase).toBe('answer');
  });

  it('represents a durable question without a coach response', () => {
    const presentation = presentCanonicalChat([message('user', 'Pending question', 1)]);

    expect(presentation.card).toEqual({
      title: 'Question saved',
      body: 'This shared chat does not have a coach response yet.',
    });
    expect(presentation.lastQuestion).toBe('Pending question');
    expect(presentation.phase).toBe('answer');
  });

  it('returns the empty-chat presentation for system-only or empty history', () => {
    const presentation = presentCanonicalChat([message('system', 'metadata', 1)]);

    expect(presentation.messages).toEqual([]);
    expect(presentation.transcript).toEqual([]);
    expect(presentation.card.title).toBe('New conversation');
    expect(presentation.phase).toBe('idle');
  });
});
