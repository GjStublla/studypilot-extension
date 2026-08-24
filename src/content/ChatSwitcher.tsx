import { motion, type Variants } from 'framer-motion';
import { Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import type { DashboardChatSummary, SharedChatContext } from '@/shared/types';

export interface ChatSwitcherProps {
  activeChatId: string | null;
  activeChat: DashboardChatSummary | null;
  sharedContext: SharedChatContext | null;
  disabled: boolean;
  isCreatingChat: boolean;
  isRefreshingChats: boolean;
  variants?: Variants;
  onSelectChat: (chatId: string | null) => void;
  onCreateChat: () => void;
  onRefreshChats: () => void;
}

export function ChatSwitcher({
  activeChatId,
  activeChat,
  sharedContext,
  disabled,
  isCreatingChat,
  isRefreshingChats,
  variants,
  onSelectChat,
  onCreateChat,
  onRefreshChats,
}: ChatSwitcherProps) {
  return (
    <motion.section className="sp-chat-switcher" variants={variants}>
      <label className="sp-chat-select">
        <span>Shared chat</span>
        <select
          aria-label="Shared StudyPilot chat"
          value={activeChatId ?? ''}
          disabled={disabled}
          onChange={event => onSelectChat(event.target.value || null)}
        >
          <option value="">New chat draft</option>
          {(sharedContext?.chats ?? []).map(chat => (
            <option key={chat.id} value={chat.id}>
              {chat.title}
              {chat.rubricTitle
                ? ` · ${chat.rubricTitle}${chat.ragReady ? ' ✓' : chat.rubricFileSearchStatus ? ` (${chat.rubricFileSearchStatus})` : ''}`
                : ''}
            </option>
          ))}
        </select>
      </label>
      {activeChat?.rubricTitle ? (
        <span
          className="sp-chat-tool"
          title={
            activeChat.ragReady
              ? `Rubric ready: ${activeChat.rubricTitle}`
              : `Rubric: ${activeChat.rubricTitle} (${activeChat.rubricFileSearchStatus ?? 'pending'})`
          }
          aria-label="Rubric status"
        >
          <ShieldCheck size={15} data-ready={activeChat.ragReady ? 'true' : 'false'} />
        </span>
      ) : null}
      <button
        type="button"
        className="sp-chat-tool"
        aria-label="Create new chat"
        title="New chat"
        disabled={isCreatingChat || disabled}
        onClick={onCreateChat}
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        className="sp-chat-tool"
        aria-label="Refresh shared chats"
        title="Refresh chats"
        disabled={isRefreshingChats || disabled}
        onClick={onRefreshChats}
      >
        <RefreshCw size={15} data-spinning={isRefreshingChats} />
      </button>
    </motion.section>
  );
}
