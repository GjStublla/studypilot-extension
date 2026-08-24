import { useRef, useState } from 'react';
import { STUDYPILOT_CONNECT_MESSAGE } from '@/shared/config';
import type { StudyPilotRuntimeMessage } from '@/shared/extensionMessages';
import type {
  DashboardChatMessage,
  DashboardChatSummary,
  DashboardSessionSummary,
  ExtensionAuthState,
  SharedChatContext,
} from '@/shared/types';
import {
  presentCanonicalChat,
  resolveSharedChatId,
  type CanonicalChatPresentation,
} from './dashboardChatState';
import { readDashboardAuthSession } from './workspaceAuth';
export { isDashboardBridgeOrigin } from './workspaceAuth';

type RuntimeMessageSender = <T>(message: StudyPilotRuntimeMessage) => Promise<T | null>;
type Notice = (message: string, duration?: number) => void;

export interface UseDashboardWorkspaceOptions {
  flashNotice: Notice;
  sendRuntimeMessage: RuntimeMessageSender;
  isExtensionRuntime: () => boolean;
  isLiveLocked: () => boolean;
  onCanonicalPresentation: (presentation: CanonicalChatPresentation) => void;
  onChatChanged: () => void;
  onChatReset: (chatId: string | null) => void;
}

export interface DashboardWorkspaceController {
  authState: ExtensionAuthState | null;
  sharedContext: SharedChatContext | null;
  activeChatId: string | null;
  chatMessages: DashboardChatMessage[];
  inFlightChatIds: Set<string>;
  isCreatingChat: boolean;
  isRefreshingChats: boolean;
  sessionChatIdRef: { current: string | null };
  activeChatIdRef: { current: string | null };
  getActiveChatId: () => string | null;
  adoptChatId: (chatId: string) => void;
  refreshAuthState: () => Promise<void>;
  refreshExtensionWorkspace: () => Promise<void>;
  refreshSharedChatContext: (preferredChatId?: string | null) => Promise<void>;
  selectDashboardChat: (chatId: string | null) => Promise<void>;
  createNewDashboardChat: (title?: string) => Promise<DashboardChatSummary | null>;
  continueDashboardSession: (session: DashboardSessionSummary) => Promise<void>;
  bridgeDashboardSession: () => Promise<void>;
  addInFlightChat: (chatId: string) => void;
  removeInFlightChat: (chatId: string) => void;
}

export function useDashboardWorkspace({
  flashNotice,
  sendRuntimeMessage,
  isExtensionRuntime,
  isLiveLocked,
  onCanonicalPresentation,
  onChatChanged,
  onChatReset,
}: UseDashboardWorkspaceOptions): DashboardWorkspaceController {
  const [authState, setAuthState] = useState<ExtensionAuthState | null>(null);
  const [sharedContext, setSharedContext] = useState<SharedChatContext | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<DashboardChatMessage[]>([]);
  const [inFlightChatIds, setInFlightChatIds] = useState<Set<string>>(() => new Set());
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isRefreshingChats, setIsRefreshingChats] = useState(false);

  const sessionChatIdRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const refreshSequenceRef = useRef(0);
  const creatingChatRef = useRef(false);

  async function refreshAuthState() {
    try {
      const response = await sendRuntimeMessage<ExtensionAuthState>({
        type: 'STUDYPILOT_GET_AUTH_STATUS',
      });
      if (response) setAuthState(response);
    } catch (error) {
      setAuthState({
        connected: false,
        error: error instanceof Error ? error.message : STUDYPILOT_CONNECT_MESSAGE,
      });
    }
  }

  async function refreshExtensionWorkspace() {
    await bridgeDashboardSession();
    await Promise.all([
      refreshAuthState(),
      refreshSharedChatContext(),
    ]);
  }

  async function refreshSharedChatContext(preferredChatId?: string | null) {
    const refreshSequence = ++refreshSequenceRef.current;
    setIsRefreshingChats(true);

    try {
      const response = await sendRuntimeMessage<SharedChatContext>({
        type: 'STUDYPILOT_GET_SHARED_CONTEXT',
      });
      if (!response || refreshSequence !== refreshSequenceRef.current) return;

      setSharedContext(response);
      const nextChatId = resolveSharedChatId(response, preferredChatId);
      if (activeChatIdRef.current !== nextChatId) onChatChanged();
      activeChatIdRef.current = nextChatId;
      setActiveChatId(nextChatId);

      if (nextChatId) {
        await loadCanonicalChat(nextChatId, refreshSequence);
      } else {
        setChatMessages([]);
        onChatReset(null);
      }
    } catch (error) {
      if (refreshSequence !== refreshSequenceRef.current) return;
      if (isExtensionRuntime()) {
        const message = error instanceof Error ? error.message : 'Could not load StudyPilot chats.';
        flashNotice(message.includes('connected') ? 'Connect dashboard first' : 'Could not refresh chats', 2800);
      }
    } finally {
      if (refreshSequence === refreshSequenceRef.current) setIsRefreshingChats(false);
    }
  }

  async function loadCanonicalChat(
    chatId: string,
    refreshSequence = ++refreshSequenceRef.current,
  ): Promise<DashboardChatMessage[]> {
    const messages = await sendRuntimeMessage<DashboardChatMessage[]>({
      type: 'STUDYPILOT_GET_CHAT_MESSAGES',
      payload: { chatId },
    });
    const canonicalMessages = messages ?? [];

    if (
      refreshSequence === refreshSequenceRef.current
      && activeChatIdRef.current === chatId
    ) {
      const presentation = presentCanonicalChat(canonicalMessages);
      setChatMessages(presentation.messages);
      onCanonicalPresentation(presentation);
    }
    return canonicalMessages;
  }

  async function selectDashboardChat(chatId: string | null) {
    if (isLiveLocked()) {
      flashNotice('Chat is locked while Live is active', 2600);
      return;
    }
    const refreshSequence = ++refreshSequenceRef.current;
    activeChatIdRef.current = chatId;
    setActiveChatId(chatId);
    onChatChanged();
    setChatMessages([]);
    onChatReset(chatId);

    try {
      await sendRuntimeMessage<{ selected: true }>({
        type: 'STUDYPILOT_SELECT_CHAT',
        payload: { chatId },
      });
      if (chatId) await loadCanonicalChat(chatId, refreshSequence);
    } catch {
      if (refreshSequence === refreshSequenceRef.current) {
        flashNotice('Could not open that chat', 2600);
      }
    }
  }

  async function createNewDashboardChat(title = 'New chat') {
    if (creatingChatRef.current) return null;
    creatingChatRef.current = true;
    setIsCreatingChat(true);

    try {
      const chat = await sendRuntimeMessage<DashboardChatSummary>({
        type: 'STUDYPILOT_CREATE_CHAT',
        payload: { title },
      });
      if (!chat) return null;

      setSharedContext(previous => previous
        ? { ...previous, chats: [chat, ...previous.chats.filter(item => item.id !== chat.id)] }
        : previous);
      await selectDashboardChat(chat.id);
      return chat;
    } finally {
      creatingChatRef.current = false;
      setIsCreatingChat(false);
    }
  }

  async function continueDashboardSession(session: DashboardSessionSummary) {
    try {
      const chat = await sendRuntimeMessage<DashboardChatSummary>({
        type: 'STUDYPILOT_CONTINUE_SESSION',
        payload: { sessionId: session.id, title: session.title },
      });
      if (!chat) return;

      setSharedContext(previous => previous
        ? { ...previous, chats: [chat, ...previous.chats.filter(item => item.id !== chat.id)] }
        : previous);
      await selectDashboardChat(chat.id);
      flashNotice(`Continuing ${session.title}`, 2200);
    } catch {
      flashNotice('Could not continue that session', 2800);
    }
  }

  async function bridgeDashboardSession() {
    const dashboardSession = readDashboardAuthSession();
    if (!dashboardSession) return;

    try {
      const response = await sendRuntimeMessage<ExtensionAuthState>({
        type: 'STUDYPILOT_CONNECT_SESSION',
        payload: dashboardSession,
      });
      if (response?.connected) {
        setAuthState(response);
        flashNotice('Extension connected', 2400);
      }
    } catch {
      // The normal auth-status request below will expose the usable state.
    }
  }

  function addInFlightChat(chatId: string) {
    setInFlightChatIds(previous => new Set(previous).add(chatId));
  }

  function adoptChatId(chatId: string) {
    activeChatIdRef.current = chatId;
    setActiveChatId(chatId);
  }

  function removeInFlightChat(chatId: string) {
    setInFlightChatIds(previous => {
      const next = new Set(previous);
      next.delete(chatId);
      return next;
    });
  }

  return {
    authState,
    sharedContext,
    activeChatId,
    chatMessages,
    inFlightChatIds,
    isCreatingChat,
    isRefreshingChats,
    sessionChatIdRef,
    activeChatIdRef,
    getActiveChatId: () => activeChatIdRef.current,
    adoptChatId,
    refreshAuthState,
    refreshExtensionWorkspace,
    refreshSharedChatContext,
    selectDashboardChat,
    createNewDashboardChat,
    continueDashboardSession,
    bridgeDashboardSession,
    addInFlightChat,
    removeInFlightChat,
  };
}
