import type { DashboardChatMessage } from '@/shared/types';

export function findCommittedAssistantForRequest(
  messages: readonly DashboardChatMessage[],
  requestId: string,
): DashboardChatMessage | null {
  return (
    messages.find(
      (message) => message.role === 'ai' && message.requestId === requestId && message.text.trim().length > 0,
    ) ?? null
  );
}
