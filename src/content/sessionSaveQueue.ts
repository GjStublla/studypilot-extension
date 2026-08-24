export interface CoalescibleSessionSave {
  chatId: string;
  finalize: boolean;
  successNotice?: string;
}

export function coalesceSessionSave<T extends CoalescibleSessionSave>(previous: T | undefined, incoming: T): T {
  if (!previous) return { ...incoming };

  const finalize = previous.finalize || incoming.finalize;
  const successNotice = incoming.finalize
    ? incoming.successNotice
    : previous.finalize
      ? previous.successNotice
      : incoming.successNotice;

  return {
    ...incoming,
    finalize,
    successNotice,
  };
}

type SessionSaveExecutor<T> = (save: T) => Promise<void>;

interface ChatSaveQueueState<T> {
  active: T | null;
  pending: { save: T; execute: SessionSaveExecutor<T> } | null;
  drainPromise: Promise<void> | null;
}

export class PerChatSessionSaveQueue<T extends CoalescibleSessionSave> {
  private readonly chats = new Map<string, ChatSaveQueueState<T>>();

  constructor(private readonly onBusyChange: (busy: boolean) => void = () => undefined) {}

  enqueue(save: T, execute: SessionSaveExecutor<T>): Promise<void> {
    const existing = this.chats.get(save.chatId);
    if (existing) {
      const activeFinalize = existing.active?.finalize === true;
      const previous = existing.pending?.save ?? (activeFinalize ? undefined : (existing.active ?? undefined));
      const pendingSave = coalesceSessionSave(previous, save);
      existing.pending = {
        save: activeFinalize ? { ...pendingSave, finalize: false } : pendingSave,
        execute,
      };
      return existing.drainPromise ?? Promise.resolve();
    }

    const state: ChatSaveQueueState<T> = {
      active: null,
      pending: { save, execute },
      drainPromise: null,
    };
    this.chats.set(save.chatId, state);
    this.onBusyChange(true);
    state.drainPromise = this.drain(save.chatId, state);
    return state.drainPromise;
  }

  private async drain(chatId: string, state: ChatSaveQueueState<T>): Promise<void> {
    let firstError: unknown;
    let failed = false;

    try {
      while (state.pending) {
        const next = state.pending;
        state.pending = null;
        state.active = next.save;

        try {
          await next.execute(next.save);
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
    } finally {
      state.active = null;
      this.chats.delete(chatId);
      this.onBusyChange(this.chats.size > 0);
    }

    if (failed) throw firstError;
  }
}
