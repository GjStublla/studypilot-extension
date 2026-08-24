import { describe, expect, it } from 'vitest';
import { isCurrentWorkspaceRequest } from './useDashboardWorkspace';

describe('dashboard workspace request boundary', () => {
  it('accepts only the mounted latest request for the active chat', () => {
    expect(
      isCurrentWorkspaceRequest({
        mounted: true,
        requestSequence: 3,
        latestSequence: 3,
        requestedChatId: 'chat-a',
        activeChatId: 'chat-a',
      }),
    ).toBe(true);
  });

  it('rejects unmounted, superseded, and inactive-chat responses', () => {
    const base = {
      requestSequence: 3,
      latestSequence: 3,
      requestedChatId: 'chat-a',
      activeChatId: 'chat-a',
    } as const;

    expect(isCurrentWorkspaceRequest({ ...base, mounted: false })).toBe(false);
    expect(isCurrentWorkspaceRequest({ ...base, mounted: true, requestSequence: 2 })).toBe(false);
    expect(isCurrentWorkspaceRequest({ ...base, mounted: true, activeChatId: 'chat-b' })).toBe(false);
  });

  it('supports context refreshes that do not target one chat', () => {
    expect(
      isCurrentWorkspaceRequest({
        mounted: true,
        requestSequence: 4,
        latestSequence: 4,
      }),
    ).toBe(true);
  });
});
