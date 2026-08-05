import { describe, expect, it } from 'vitest';
import type { DashboardChatMessage } from '@/shared/types';
import { findCommittedAssistantForRequest } from './coachingReconciliation';

function message(
  role: DashboardChatMessage['role'],
  requestId: string | null,
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
    requestId,
    originSurface: 'extension',
    createdAt: '2026-08-04T12:00:00.000Z',
  };
}

describe('findCommittedAssistantForRequest', () => {
  it('proves a coaching request committed only from its exact canonical assistant row', () => {
    const messages = [
      message('user', 'request-current', 'Can you explain this?', 1),
      message('ai', 'request-other', 'An older answer', 2),
      message('ai', 'request-current', 'The durable answer', 3),
    ];

    expect(findCommittedAssistantForRequest(messages, 'request-current')).toEqual(messages[2]);
  });

  it('does not treat a user row or another request as a committed response', () => {
    const messages = [
      message('user', 'request-current', 'Can you explain this?', 1),
      message('ai', 'request-other', 'A different answer', 2),
    ];

    expect(findCommittedAssistantForRequest(messages, 'request-current')).toBeNull();
  });

  it('ignores an empty canonical assistant row', () => {
    const messages = [message('ai', 'request-current', '   ', 1)];

    expect(findCommittedAssistantForRequest(messages, 'request-current')).toBeNull();
  });
});
