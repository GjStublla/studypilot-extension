import { describe, expect, it, vi } from 'vitest';
import { coalesceSessionSave, PerChatSessionSaveQueue } from './sessionSaveQueue';

interface TestSave {
  chatId: string;
  finalize: boolean;
  transcript: string[];
}

describe('coalesceSessionSave', () => {
  it('keeps the newest transcript snapshot', () => {
    const result = coalesceSessionSave(
      { chatId: 'chat-1', finalize: false, transcript: ['older response'] },
      { chatId: 'chat-1', finalize: false, transcript: ['newer response'] },
    );

    expect(result.transcript).toEqual(['newer response']);
  });

  it('preserves an earlier finalize request', () => {
    const result = coalesceSessionSave(
      { chatId: 'chat-1', finalize: true, transcript: ['older response'] },
      { chatId: 'chat-1', finalize: false, transcript: ['newer response'] },
    );

    expect(result.finalize).toBe(true);
  });

  it('keeps the latest explicit finalize request', () => {
    const result = coalesceSessionSave(
      { chatId: 'chat-1', finalize: false, transcript: ['older response'] },
      { chatId: 'chat-1', finalize: true, transcript: ['newer response'] },
    );

    expect(result.finalize).toBe(true);
  });
});

describe('PerChatSessionSaveQueue', () => {
  it('runs one follow-up save with the newest transcript and accumulated finalize intent', async () => {
    const queue = new PerChatSessionSaveQueue<TestSave>();
    const calls: TestSave[] = [];
    const releases: Array<() => void> = [];
    const execute = (save: TestSave) => new Promise<void>(resolve => {
      calls.push(save);
      releases.push(resolve);
    });

    const first = queue.enqueue(
      { chatId: 'chat-1', finalize: false, transcript: ['first'] },
      execute,
    );
    const second = queue.enqueue(
      { chatId: 'chat-1', finalize: true, transcript: ['second'] },
      execute,
    );
    const third = queue.enqueue(
      { chatId: 'chat-1', finalize: false, transcript: ['third'] },
      execute,
    );

    expect(calls).toEqual([
      { chatId: 'chat-1', finalize: false, transcript: ['first'] },
    ]);

    releases.shift()?.();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      chatId: 'chat-1',
      finalize: true,
      transcript: ['third'],
      successNotice: undefined,
    });

    releases.shift()?.();
    await Promise.all([first, second, third]);
  });

  it('persists the newest snapshot without repeating an active finalize', async () => {
    const queue = new PerChatSessionSaveQueue<TestSave>();
    const calls: TestSave[] = [];
    const releases: Array<() => void> = [];
    const execute = (save: TestSave) => new Promise<void>(resolve => {
      calls.push(save);
      releases.push(resolve);
    });

    const finalize = queue.enqueue(
      { chatId: 'chat-1', finalize: true, transcript: ['finalized'] },
      execute,
    );
    const newerSave = queue.enqueue(
      { chatId: 'chat-1', finalize: true, transcript: ['newer response'] },
      execute,
    );

    expect(calls).toEqual([
      { chatId: 'chat-1', finalize: true, transcript: ['finalized'] },
    ]);

    releases.shift()?.();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      chatId: 'chat-1',
      finalize: false,
      transcript: ['newer response'],
    });

    releases.shift()?.();
    await Promise.all([finalize, newerSave]);
  });
});
