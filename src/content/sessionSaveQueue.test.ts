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
    const execute = (save: TestSave) =>
      new Promise<void>((resolve) => {
        calls.push(save);
        releases.push(resolve);
      });

    const first = queue.enqueue({ chatId: 'chat-1', finalize: false, transcript: ['first'] }, execute);
    const second = queue.enqueue({ chatId: 'chat-1', finalize: true, transcript: ['second'] }, execute);
    const third = queue.enqueue({ chatId: 'chat-1', finalize: false, transcript: ['third'] }, execute);

    expect(calls).toEqual([{ chatId: 'chat-1', finalize: false, transcript: ['first'] }]);

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
    const execute = (save: TestSave) =>
      new Promise<void>((resolve) => {
        calls.push(save);
        releases.push(resolve);
      });

    const finalize = queue.enqueue({ chatId: 'chat-1', finalize: true, transcript: ['finalized'] }, execute);
    const newerSave = queue.enqueue({ chatId: 'chat-1', finalize: true, transcript: ['newer response'] }, execute);

    expect(calls).toEqual([{ chatId: 'chat-1', finalize: true, transcript: ['finalized'] }]);

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

  it('runs different chats independently while reporting aggregate busy state', async () => {
    const busyStates: boolean[] = [];
    const queue = new PerChatSessionSaveQueue<TestSave>((busy) => busyStates.push(busy));
    const releases: Array<() => void> = [];
    const calls: string[] = [];
    const execute = (save: TestSave) =>
      new Promise<void>((resolve) => {
        calls.push(save.chatId);
        releases.push(resolve);
      });

    const first = queue.enqueue({ chatId: 'chat-a', finalize: false, transcript: ['a'] }, execute);
    const second = queue.enqueue({ chatId: 'chat-b', finalize: false, transcript: ['b'] }, execute);

    expect(calls).toEqual(['chat-a', 'chat-b']);
    expect(busyStates).toEqual([true, true]);

    releases.shift()?.();
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(busyStates.at(-1)).toBe(false);
  });

  it('drains pending saves after an executor error and rejects the shared drain', async () => {
    const queue = new PerChatSessionSaveQueue<TestSave>();
    const calls: TestSave[] = [];
    let attempt = 0;
    const execute = async (save: TestSave) => {
      calls.push(save);
      attempt += 1;
      if (attempt === 1) throw new Error('save failed');
    };

    const first = queue.enqueue({ chatId: 'chat-1', finalize: false, transcript: ['first'] }, execute);
    const second = queue.enqueue({ chatId: 'chat-1', finalize: false, transcript: ['second'] }, execute);

    await expect(first).rejects.toThrow('save failed');
    await expect(second).rejects.toThrow('save failed');
    expect(calls.map((save) => save.transcript)).toEqual([['first'], ['second']]);

    await expect(
      queue.enqueue({ chatId: 'chat-1', finalize: false, transcript: ['recovery'] }, execute),
    ).resolves.toBeUndefined();
  });
});
