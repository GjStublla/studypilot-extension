import { AnimatePresence, motion, type Variants } from 'framer-motion';
import type { ChangeEvent, ClipboardEvent, Dispatch, RefObject, SetStateAction } from 'react';
import type {
  DashboardChatMessage,
  DashboardChatSummary,
  DashboardSessionSummary,
  LiveUiState,
  SharedChatContext,
  StudyAction,
  ContextShareSettings,
  PageContext,
} from '@/shared/types';
import { AnswerCardPanel, type AnswerCardData, type AnswerFeedback } from './AnswerCardPanel';
import { ChatSwitcher } from './ChatSwitcher';
import { ComposerPanel } from './ComposerPanel';
import { SettingsSheet } from './ContextSettings';
import { Orb, SparkleLogo, type OrbState, type StructuredCard } from './PanelComponents';
import { PomodoroPicker } from './PomodoroPicker';
import { QuickActions } from './QuickActions';
import { StudyModePanel, type StudyMode } from './StudyModePanel';
import { VoiceDock } from './VoiceDock';

export interface PanelBodyProps {
  authConnected: boolean;
  activeChatId: string | null;
  activeChat: DashboardChatSummary | null;
  chatMessages: DashboardChatMessage[];
  sharedContext: SharedChatContext | null;
  isCreatingChat: boolean;
  isRefreshingChats: boolean;
  liveFrozen: boolean;
  liveBusy: boolean;
  lastQuestion: string;
  studyMode: StudyMode | null;
  studyLoading: boolean;
  studyError: string | null;
  structuredCard: StructuredCard;
  page: PageContext;
  context: ContextShareSettings;
  card: AnswerCardData;
  cardOpen: boolean;
  cardScreenshotDataUrl: string | null;
  copied: boolean;
  feedback: AnswerFeedback;
  thinking: boolean;
  orbState: OrbState;
  statusText: string;
  micOn: boolean;
  isSpeaking: boolean;
  liveState: LiveUiState;
  settingsOpen: boolean;
  pendingScreenshots: string[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  question: string;
  pomodoroRemaining: number | null;
  pomodoroStats: Record<string, number>;
  pomodoroPickerOpen: boolean;
  onSelectChat: (chatId: string | null) => void;
  onCreateChat: () => void;
  onRefreshChats: () => void;
  onOpenDashboard: () => void;
  onCloseStudyMode: () => void;
  onRegenerateStudyMode: (mode: StudyMode) => void;
  onPerfectScore: () => void;
  onToggleMic: () => void;
  onSpeak: () => void;
  onTogglePause: () => void;
  onToggleSettings: () => void;
  onChangeContext: Dispatch<SetStateAction<ContextShareSettings>>;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onRemoveScreenshot: (index: number) => void;
  onOpenFilePicker: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
  formatTime: (seconds: number) => string;
  onRunStudyAction: (action: StudyAction) => void;
  onOpenStudyMode: (mode: StudyMode) => void;
  onContinueSession: (session: DashboardSessionSummary) => void;
  onStopPomodoro: () => void;
  onTogglePomodoroPicker: () => void;
  onStartPomodoro: (minutes: number) => void;
  onToggleCard: () => void;
  onCopy: () => void | Promise<void>;
  onFeedback: (value: Exclude<AnswerFeedback, null>) => void;
}

const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] },
  },
};

export function PanelBody({
  authConnected,
  activeChatId,
  activeChat: _activeChat,
  chatMessages: _chatMessages,
  sharedContext,
  isCreatingChat,
  isRefreshingChats,
  liveFrozen,
  liveBusy,
  lastQuestion,
  studyMode,
  studyLoading,
  studyError,
  structuredCard,
  page,
  context,
  card,
  cardOpen,
  cardScreenshotDataUrl,
  copied,
  feedback,
  thinking,
  orbState,
  statusText,
  micOn,
  isSpeaking,
  liveState,
  settingsOpen,
  pendingScreenshots,
  fileInputRef,
  question,
  pomodoroRemaining,
  pomodoroStats,
  pomodoroPickerOpen,
  onSelectChat,
  onCreateChat,
  onRefreshChats,
  onOpenDashboard,
  onCloseStudyMode,
  onRegenerateStudyMode,
  onPerfectScore,
  onToggleMic,
  onSpeak,
  onTogglePause,
  onToggleSettings,
  onChangeContext,
  onPaste,
  onRemoveScreenshot,
  onOpenFilePicker,
  onFileInputChange,
  onQuestionChange,
  onSubmit,
  formatTime,
  onRunStudyAction,
  onOpenStudyMode,
  onContinueSession,
  onStopPomodoro,
  onTogglePomodoroPicker,
  onStartPomodoro,
  onToggleCard,
  onCopy,
  onFeedback,
}: PanelBodyProps) {
  return (
    <motion.div
      className="sp-body"
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
      }}
    >
      {authConnected ? (
        <ChatSwitcher
          activeChatId={activeChatId}
          activeChat={_activeChat}
          sharedContext={sharedContext}
          disabled={liveFrozen || liveBusy}
          isCreatingChat={isCreatingChat}
          isRefreshingChats={isRefreshingChats}
          variants={sectionReveal}
          onSelectChat={onSelectChat}
          onCreateChat={onCreateChat}
          onRefreshChats={onRefreshChats}
        />
      ) : null}

      {!authConnected ? (
        <WebAppConnectView onOpenDashboard={onOpenDashboard} />
      ) : studyMode !== null ? (
        <StudyModePanel
          mode={studyMode}
          loading={studyLoading}
          error={studyError}
          card={structuredCard}
          onClose={onCloseStudyMode}
          onRegenerate={onRegenerateStudyMode}
          onPerfectScore={onPerfectScore}
        />
      ) : (
        <>
          <motion.section className="sp-stage" variants={sectionReveal} aria-live="polite">
            <span className="sp-presence-dot" aria-hidden="true" />
            <Orb state={orbState} />
            <p className="sp-status" data-state={orbState}>
              {statusText}
            </p>
            <h2 className="sp-headline">Ask anything about this page</h2>
          </motion.section>

          <VoiceDock
            micOn={micOn}
            isSpeaking={isSpeaking}
            liveState={liveState}
            liveBusy={liveBusy}
            settingsOpen={settingsOpen}
            variants={sectionReveal}
            onToggleMic={onToggleMic}
            onSpeak={onSpeak}
            onTogglePause={onTogglePause}
            onToggleSettings={onToggleSettings}
          />

          <AnimatePresence initial={false}>
            {settingsOpen ? (
              <motion.div
                key="settings"
                className="sp-settings-wrap"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <SettingsSheet
                  page={page}
                  context={context}
                  onChange={onChangeContext}
                  onOpenDashboard={onOpenDashboard}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <ComposerPanel
            pendingScreenshots={pendingScreenshots}
            fileInputRef={fileInputRef}
            question={question}
            variants={sectionReveal}
            onPaste={onPaste}
            onRemoveScreenshot={onRemoveScreenshot}
            onOpenFilePicker={onOpenFilePicker}
            onFileInputChange={onFileInputChange}
            onQuestionChange={onQuestionChange}
            onSubmit={onSubmit}
          />

          <motion.div className="sp-chips" variants={sectionReveal}>
            <QuickActions
              sharedContext={sharedContext}
              pomodoroRemaining={pomodoroRemaining}
              formatTime={formatTime}
              onRunStudyAction={onRunStudyAction}
              onOpenStudyMode={onOpenStudyMode}
              onContinueSession={onContinueSession}
              onStopPomodoro={onStopPomodoro}
              onTogglePomodoroPicker={onTogglePomodoroPicker}
            />
          </motion.div>

          {lastQuestion.trim() ? (
            <motion.div className="sp-last-question" variants={sectionReveal}>
              <span className="sp-last-question-label">You asked</span>
              <p className="sp-last-question-text">{lastQuestion.trim()}</p>
            </motion.div>
          ) : null}

          <PomodoroPicker
            open={pomodoroPickerOpen}
            remainingSeconds={pomodoroRemaining}
            stats={pomodoroStats}
            onStart={onStartPomodoro}
          />

          <AnswerCardPanel
            card={card}
            cardOpen={cardOpen}
            structuredCard={structuredCard}
            screenshotDataUrl={cardScreenshotDataUrl}
            isSpeaking={isSpeaking}
            copied={copied}
            feedback={feedback}
            thinking={thinking}
            onToggleOpen={onToggleCard}
            onSpeak={onSpeak}
            onCopy={onCopy}
            onFeedback={onFeedback}
          />
        </>
      )}
    </motion.div>
  );
}

function WebAppConnectView({ onOpenDashboard }: { onOpenDashboard: () => void }) {
  return (
    <div className="sp-login">
      <div className="sp-login-brand">
        <SparkleLogo size={28} />
        <span>Connect StudyPilot</span>
      </div>
      <div className="sp-login-form">
        <p className="sp-login-error" style={{ margin: 0 }}>
          Sign in once to connect the extension and dashboard. Open the StudyPilot web app and this panel will connect
          automatically.
        </p>
        <button type="button" className="sp-login-btn" onClick={onOpenDashboard}>
          Open web app
        </button>
      </div>
    </div>
  );
}
