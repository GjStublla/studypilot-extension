import type {
  DashboardChatMessage,
  SharedChatContext,
  StudyPhase,
  StudyTranscriptTurn,
} from '@/shared/types';

export interface ChatCardState {
  title: string;
  body: string;
}

export interface CanonicalChatPresentation {
  messages: DashboardChatMessage[];
  transcript: StudyTranscriptTurn[];
  lastQuestion: string;
  card: ChatCardState;
  phase: StudyPhase;
}

/**
 * Resolve the chat that should remain selected after a shared-context refresh.
 * A preferred id wins only while it still exists in the server response;
 * otherwise the server's active id is used when valid.
 */
export function resolveSharedChatId(
  context: Pick<SharedChatContext, 'chats' | 'activeChatId'>,
  preferredChatId?: string | null,
): string | null {
  const requestedChatId = preferredChatId ?? context.activeChatId;
  return requestedChatId && context.chats.some(chat => chat.id === requestedChatId)
    ? requestedChatId
    : null;
}

/**
 * Convert canonical server messages into the panel's visible chat, transcript,
 * answer card, and phase state. System rows remain durable but are not shown.
 */
export function presentCanonicalChat(
  messages: readonly DashboardChatMessage[],
): CanonicalChatPresentation {
  const visibleMessages = messages.filter(message => message.role !== 'system');
  const transcript = visibleMessages.map((message, index) => transcriptTurnFromMessage(message, index));
  const latestAi = [...visibleMessages].reverse().find(message => message.role === 'ai');
  const latestUser = [...visibleMessages].reverse().find(message => message.role === 'user');

  if (latestAi) {
    return {
      messages: visibleMessages,
      transcript,
      lastQuestion: latestUser?.text ?? '',
      card: { title: 'Coach response', body: latestAi.text },
      phase: 'answer',
    };
  }

  if (latestUser) {
    return {
      messages: visibleMessages,
      transcript,
      lastQuestion: latestUser.text,
      card: {
        title: 'Question saved',
        body: 'This shared chat does not have a coach response yet.',
      },
      phase: 'answer',
    };
  }

  return {
    messages: visibleMessages,
    transcript,
    lastQuestion: '',
    card: {
      title: 'New conversation',
      body: 'Ask about this page to start a shared StudyPilot chat.',
    },
    phase: 'idle',
  };
}

function transcriptTurnFromMessage(
  message: DashboardChatMessage,
  index: number,
): StudyTranscriptTurn {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    atSeconds: Math.max(0, index),
    sequence: message.sequence,
    createdAt: message.createdAt,
  };
}
