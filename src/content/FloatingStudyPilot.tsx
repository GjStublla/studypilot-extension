import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronDown,
  Copy,
  Crown,
  ExternalLink,
  FileText,
  HelpCircle,
  Lightbulb,
  Mic,
  MoreVertical,
  Pause,
  Pin,
  Play,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Square,
  ThumbsDown,
  ThumbsUp,
  Type,
  Volume2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  Dispatch,
  KeyboardEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import symbolLogoUrl from '../../02_symbol_mark_transparent.png';
import {
  DASHBOARD_URL,
  createMockStudySession,
  saveStudySession,
} from '@/shared/mockDashboard';
import {
  isStudyPilotRuntimeMessage,
  type StudyPilotRuntimeMessage,
} from '@/shared/extensionMessages';
import {
  STUDY_FOLDERS,
  type CaptureVisibleTabResult,
  type ContextShareSettings,
  type DashboardSaveResult,
  type GeminiQueryResult,
  type PageContext,
  type StudyAction,
  type StudyFolder,
  type StudyPilotStatus,
  type StudyPilotView,
} from '@/shared/types';

const STATUS_COPY: Record<StudyPilotStatus, string> = {
  ready: 'Ready',
  'screenshot-ready': 'Screenshot ready',
  'live-sharing': 'Live sharing',
  explaining: 'Explaining',
  saved: 'Saved',
};

const ACTION_COPY: Record<StudyAction, string> = {
  explain: 'Explain',
  summarize: 'Summarize',
  quiz: 'Quiz Me',
  flashcards: 'Flashcards',
  'step-by-step': 'Steps',
};

function getPageContext(): PageContext {
  const selectedText = window.getSelection()?.toString().trim();

  return {
    sourceUrl: window.location.href,
    sourceTitle: document.title || window.location.hostname || 'Current page',
    host: window.location.hostname.replace(/^www\./, ''),
    selectedText: selectedText ? selectedText.slice(0, 280) : undefined,
  };
}

function isExtensionRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.runtime?.id) &&
    typeof chrome.runtime.sendMessage === 'function'
  );
}

async function sendRuntimeMessage<T>(
  message: StudyPilotRuntimeMessage,
): Promise<T | null> {
  if (!isExtensionRuntime()) return null;
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error ?? 'StudyPilot action failed.');
  }
  return response.data as T;
}

export function FloatingStudyPilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<StudyPilotView>('idle');
  const [status, setStatus] = useState<StudyPilotStatus>('ready');
  const [page, setPage] = useState<PageContext>(() => getPageContext());
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [lastQuestion, setLastQuestion] = useState('Ask anything about this page');
  const [capturedScreenshot, setCapturedScreenshot] =
    useState<CaptureVisibleTabResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [savedFolder, setSavedFolder] = useState<StudyFolder>('Biology 101');
  const [context, setContext] = useState<ContextShareSettings>({
    screenshot: true,
    pageUrl: true,
    selectedText: false,
    saveToDashboard: true,
    folder: 'Biology 101',
  });
  const requestId = useRef(0);

  useEffect(() => {
    const refreshSelection = () => {
      setPage(getPageContext());
    };

    document.addEventListener('selectionchange', refreshSelection);
    window.addEventListener('focus', refreshSelection);

    return () => {
      document.removeEventListener('selectionchange', refreshSelection);
      window.removeEventListener('focus', refreshSelection);
    };
  }, []);

  useEffect(() => {
    if (!isExtensionRuntime()) return;

    const listener = (message: unknown) => {
      if (
        isStudyPilotRuntimeMessage(message) &&
        message.type === 'STUDYPILOT_OPEN_MODAL'
      ) {
        setIsOpen(true);
      }
      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    return () => {
      requestId.current += 1;
    };
  }, []);

  const sourceLabel = useMemo(() => {
    if (!page.host) return 'Current page';
    return `${page.host} - ${page.sourceTitle}`;
  }, [page.host, page.sourceTitle]);

  function resetToIdle() {
    setView('idle');
    setStatus('ready');
    setIsLivePaused(false);
  }

  async function captureScreenshot() {
    setIsOpen(true);
    setView('thinking');
    setStatus('explaining');

    try {
      const capture = await sendRuntimeMessage<CaptureVisibleTabResult>({
        type: 'STUDYPILOT_CAPTURE_VISIBLE_TAB',
      });

      if (!capture) {
        throw new Error('Screenshot capture is only available inside the installed extension.');
      }

      setCapturedScreenshot(capture);
      setPage(prev => ({
        ...prev,
        sourceTitle: capture.pageTitle || prev.sourceTitle,
        sourceUrl: capture.pageUrl || prev.sourceUrl,
      }));
      setContext(prev => ({ ...prev, screenshot: true }));
      setView('screenshot');
      setStatus('screenshot-ready');
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : String(error));
      setView('answer');
      setStatus('ready');
    }
  }

  function startLiveSharing() {
    // TODO: Connect navigator.mediaDevices.getDisplayMedia through an explicit
    // browser permission prompt when live help moves beyond the MVP mock.
    setView('live');
    setStatus('live-sharing');
    setIsLivePaused(false);
    setIsMicOn(true);
    setIsOpen(true);
  }

  async function runStudyAction(action: StudyAction, customQuestion?: string) {
    const nextQuestion =
      customQuestion?.trim() || `${ACTION_COPY[action]} this page`;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;

    setLastQuestion(nextQuestion);
    setAnswer('');
    setView('thinking');
    setStatus('explaining');
    setIsOpen(true);

    try {
      const imageDataUrl =
        context.screenshot && capturedScreenshot
          ? capturedScreenshot.dataUrl
          : undefined;
      const response = await sendRuntimeMessage<GeminiQueryResult>({
        type: 'STUDYPILOT_GEMINI_QUERY',
        payload: {
          requestType: imageDataUrl ? 'screenshot' : 'question',
          imageDataUrl,
          question: promptForAction(action, nextQuestion),
          context: buildQuestionContext(page, context),
        },
      });

      if (requestId.current !== currentRequest) return;
      if (!response?.answer.trim()) {
        throw new Error('The API returned an empty answer.');
      }

      setAnswer(response.answer.trim());
      setView('answer');
      setStatus('ready');
    } catch (error) {
      if (requestId.current !== currentRequest) return;
      setAnswer(error instanceof Error ? error.message : String(error));
      setView('answer');
      setStatus('ready');
    }
  }

  async function sendToDashboard() {
    if (!context.saveToDashboard || isSaving) return;

    setIsSaving(true);
    const session = createMockStudySession({
      page,
      folder: context.folder,
      question: lastQuestion,
      answer,
      screenshotUrl: context.screenshot ? 'mock://studypilot/screenshot' : undefined,
      tags: ['study-session', context.folder.toLowerCase().replace(/\s+/g, '-')],
    });

    try {
      const response = await sendRuntimeMessage<DashboardSaveResult>({
        type: 'STUDYPILOT_SAVE_SESSION',
        payload: { session },
      });

      if (!response) await saveStudySession(session);
      setSavedFolder(session.folder);
      setView('saved');
      setStatus('saved');
    } finally {
      setIsSaving(false);
    }
  }

  async function openDashboard() {
    try {
      await sendRuntimeMessage({
        type: 'STUDYPILOT_OPEN_DASHBOARD',
        payload: { url: DASHBOARD_URL },
      });
    } catch {
      window.open(DASHBOARD_URL, '_blank', 'noopener,noreferrer');
    }
  }

  function handleSubmit() {
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    runStudyAction('explain', text);
  }

  return (
    <div
      className="sp-extension"
      data-view={view}
      onKeyDownCapture={stopPageKeyboardShortcuts}
      onKeyUpCapture={stopPageKeyboardShortcuts}
    >
      <AnimatePresence>
        {!isOpen ? (
          <motion.button
            key="orb"
            type="button"
            className="sp-orb-button"
            aria-label="Open StudyPilot"
            onClick={() => setIsOpen(true)}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="sp-orb-mark" data-status={status}>
              <img src={symbolLogoUrl} alt="" />
            </span>
            <span className="sp-orb-copy">
              <span className="sp-orb-name">Study Pilot</span>
              <span className="sp-orb-status">{STATUS_COPY[status]}</span>
            </span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen ? (
          <motion.section
            key="modal"
            className="sp-modal"
            role="dialog"
            aria-label="StudyPilot study companion"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="sp-header">
              <div className="sp-brand">
                <img className="sp-brand-logo" src={symbolLogoUrl} alt="" />
                <div className="sp-brand-text">
                  <strong>Study Pilot</strong>
                  <span title={sourceLabel}>{sourceLabel}</span>
                </div>
              </div>
              <div className="sp-header-actions">
                <button
                  type="button"
                  className="sp-top-icon"
                  aria-label="Pin StudyPilot"
                >
                  <Pin size={22} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="sp-top-icon"
                  aria-label="Close StudyPilot"
                  onClick={() => setIsOpen(false)}
                >
                  <MoreVertical size={25} strokeWidth={2.3} />
                </button>
              </div>
            </header>

            <div className="sp-modal-body">
              <StudyStage
                view={view}
                savedFolder={savedFolder}
                isLivePaused={isLivePaused}
              />

              <VoiceControls
                view={view}
                isMicOn={isMicOn}
                isLivePaused={isLivePaused}
                onMicToggle={() => setIsMicOn(value => !value)}
                onListen={startLiveSharing}
                onPause={() => setIsLivePaused(value => !value)}
                onSettings={captureScreenshot}
              />

              <Composer
                question={question}
                onQuestionChange={setQuestion}
                onSubmit={handleSubmit}
              />

              <QuickActions
                isSaving={isSaving}
                saveEnabled={context.saveToDashboard && !isSaving}
                view={view}
                onSummarize={() => runStudyAction('summarize')}
                onExplain={() => runStudyAction('explain')}
                onQuiz={() => runStudyAction('quiz')}
                onFlashcards={() => runStudyAction('flashcards')}
                onSave={sendToDashboard}
                onRetake={captureScreenshot}
                onStop={resetToIdle}
              />

              <AnswerPanel
                view={view}
                answer={answer}
                title={lastQuestion}
                savedFolder={savedFolder}
                isSaving={isSaving}
                onSave={sendToDashboard}
                onOpenDashboard={openDashboard}
              />

              <ContextRail
                page={page}
                context={context}
                onChange={setContext}
              />
            </div>

            <footer className="sp-footer">
              <button type="button" className="sp-pro-button">
                <Crown size={17} />
                <span>Pro</span>
              </button>
            </footer>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function stopPageKeyboardShortcuts(event: KeyboardEvent): void {
  event.stopPropagation();
}

function StudyStage({
  view,
  savedFolder,
  isLivePaused,
}: {
  view: StudyPilotView;
  savedFolder: StudyFolder;
  isLivePaused: boolean;
}) {
  const title = stageTitle(view, savedFolder, isLivePaused);
  const subtitle = stageSubtitle(view);

  return (
    <section className="sp-stage" aria-live="polite">
      <span className="sp-live-dot" aria-hidden="true" />

      <div className="sp-energy-field">
        <div className="sp-energy-ring" data-active={view}>
          <span className="sp-ring-a" />
          <span className="sp-ring-b" />
          <span className="sp-ring-c" />
          <span className="sp-wave-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${view}-${isLivePaused}`}
          className="sp-stage-copy"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
        >
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function VoiceControls({
  view,
  isMicOn,
  isLivePaused,
  onMicToggle,
  onListen,
  onPause,
  onSettings,
}: {
  view: StudyPilotView;
  isMicOn: boolean;
  isLivePaused: boolean;
  onMicToggle: () => void;
  onListen: () => void;
  onPause: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="sp-voice-controls" aria-label="Live study controls">
      <RoundButton
        active={isMicOn}
        label={isMicOn ? 'Mute microphone' : 'Use microphone'}
        icon={<Mic size={27} />}
        onClick={onMicToggle}
      />
      <RoundButton
        label="Share screen for live help"
        icon={<Volume2 size={27} />}
        onClick={onListen}
        active={view === 'live'}
      />
      <RoundButton
        label={isLivePaused ? 'Resume sharing' : 'Pause sharing'}
        icon={isLivePaused ? <Play size={27} /> : <Pause size={27} />}
        onClick={onPause}
        active={view === 'live' && !isLivePaused}
      />
      <RoundButton
        label="Capture screenshot"
        icon={<Settings size={27} />}
        onClick={onSettings}
      />
    </div>
  );
}

function RoundButton({
  active = false,
  label,
  icon,
  onClick,
}: {
  active?: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sp-round-button"
      data-active={active}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function Composer({
  question,
  onQuestionChange,
  onSubmit,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="sp-composer">
      <textarea
        value={question}
        rows={1}
        placeholder="Ask a question or say something..."
        onChange={event => onQuestionChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button
        type="button"
        className="sp-send-button"
        aria-label="Send question"
        onClick={onSubmit}
        disabled={!question.trim()}
      >
        <Send size={26} fill="currentColor" />
      </button>
    </div>
  );
}

function QuickActions({
  isSaving,
  saveEnabled,
  view,
  onSummarize,
  onExplain,
  onQuiz,
  onFlashcards,
  onSave,
  onRetake,
  onStop,
}: {
  isSaving: boolean;
  saveEnabled: boolean;
  view: StudyPilotView;
  onSummarize: () => void;
  onExplain: () => void;
  onQuiz: () => void;
  onFlashcards: () => void;
  onSave: () => void;
  onRetake: () => void;
  onStop: () => void;
}) {
  if (view === 'live') {
    return (
      <div className="sp-chip-row">
        <ActionChip icon={<Square size={18} />} label="Stop sharing" onClick={onStop} danger />
        <ActionChip icon={<Camera size={18} />} label="Send snapshot" onClick={onRetake} />
        <ActionChip icon={<ExternalLink size={18} />} label="Save" onClick={onSave} disabled={!saveEnabled} />
      </div>
    );
  }

  if (view === 'screenshot') {
    return (
      <div className="sp-chip-row">
        <ActionChip icon={<Lightbulb size={18} />} label="Explain" onClick={onExplain} />
        <ActionChip icon={<BookOpen size={18} />} label="Summarize" onClick={onSummarize} />
        <ActionChip icon={<RotateCcw size={18} />} label="Retake" onClick={onRetake} />
        <ActionChip
          icon={<ExternalLink size={18} />}
          label={isSaving ? 'Saving' : 'Send'}
          onClick={onSave}
          disabled={!saveEnabled}
        />
      </div>
    );
  }

  return (
    <div className="sp-chip-row">
      <ActionChip icon={<FileText size={18} />} label="Summarize" onClick={onSummarize} />
      <ActionChip icon={<Lightbulb size={18} />} label="Explain" onClick={onExplain} />
      <ActionChip icon={<HelpCircle size={18} />} label="Quiz Me" onClick={onQuiz} />
      <ActionChip icon={<BookOpen size={18} />} label="Flashcards" onClick={onFlashcards} />
    </div>
  );
}

function ActionChip({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className="sp-action-chip"
      data-danger={danger}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function AnswerPanel({
  view,
  answer,
  title,
  savedFolder,
  isSaving,
  onSave,
  onOpenDashboard,
}: {
  view: StudyPilotView;
  answer: string;
  title: string;
  savedFolder: StudyFolder;
  isSaving: boolean;
  onSave: () => void;
  onOpenDashboard: () => void;
}) {
  const isSaved = view === 'saved';

  return (
    <section className="sp-answer-card">
      <div className="sp-answer-head">
        <div>
          <strong>
            {isSaved ? `Saved to ${savedFolder}` : title}
          </strong>
          <span>{isSaved ? 'Ready in dashboard' : 'Just now'}</span>
        </div>
        <ChevronDown size={22} />
      </div>

      <p>{answer || 'Ask a question or choose an action to get an API answer.'}</p>

      <div className="sp-answer-actions">
        <button type="button" aria-label="Read answer aloud">
          <Volume2 size={20} />
        </button>
        <button type="button" aria-label="Copy answer">
          <Copy size={20} />
        </button>
        <span />
        <button
          type="button"
          className="sp-save-inline"
          onClick={isSaved ? onOpenDashboard : onSave}
        >
          {isSaved ? <ExternalLink size={20} /> : <CheckCircle2 size={20} />}
          <span>{isSaved ? 'Open' : isSaving ? 'Saving' : 'Save'}</span>
        </button>
        <button type="button" aria-label="Helpful">
          <ThumbsUp size={20} />
        </button>
        <button type="button" aria-label="Not helpful">
          <ThumbsDown size={20} />
        </button>
      </div>
    </section>
  );
}

function ContextRail({
  page,
  context,
  onChange,
}: {
  page: PageContext;
  context: ContextShareSettings;
  onChange: Dispatch<SetStateAction<ContextShareSettings>>;
}) {
  const setFlag =
    (
      key: keyof Pick<
        ContextShareSettings,
        'screenshot' | 'pageUrl' | 'selectedText' | 'saveToDashboard'
      >,
    ) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(prev => ({ ...prev, [key]: event.target.checked }));
    };

  return (
    <section className="sp-context-rail">
      <div className="sp-context-title">
        <ShieldCheck size={15} />
        <span>Shared when you ask or save</span>
      </div>
      <div className="sp-context-options">
        <TogglePill
          icon={<Camera size={14} />}
          label="Screenshot"
          checked={context.screenshot}
          onChange={setFlag('screenshot')}
        />
        <TogglePill
          icon={<ExternalLink size={14} />}
          label="Page URL"
          checked={context.pageUrl}
          onChange={setFlag('pageUrl')}
        />
        <TogglePill
          icon={<Type size={14} />}
          label={page.selectedText ? 'Selected text' : 'No selection'}
          checked={context.selectedText}
          onChange={setFlag('selectedText')}
        />
        <TogglePill
          icon={<CheckCircle2 size={14} />}
          label="Save"
          checked={context.saveToDashboard}
          onChange={setFlag('saveToDashboard')}
        />
      </div>

      <label className="sp-folder-select">
        <span>Folder</span>
        <select
          value={context.folder}
          onChange={event =>
            onChange(prev => ({
              ...prev,
              folder: event.target.value as StudyFolder,
            }))
          }
        >
          {STUDY_FOLDERS.map(folder => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function TogglePill({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="sp-toggle-pill" data-checked={checked}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {icon}
      <span>{label}</span>
    </label>
  );
}

function stageTitle(
  view: StudyPilotView,
  savedFolder: StudyFolder,
  isLivePaused: boolean,
): string {
  switch (view) {
    case 'screenshot':
      return 'Screenshot ready';
    case 'live':
      return isLivePaused ? 'Paused' : 'Listening...';
    case 'thinking':
      return 'Reading your screen...';
    case 'answer':
      return 'Answer ready';
    case 'saved':
      return `Saved to ${savedFolder}`;
    case 'idle':
    default:
      return 'Listening...';
  }
}

function stageSubtitle(view: StudyPilotView): string {
  switch (view) {
    case 'screenshot':
      return 'Ask StudyPilot to explain, summarize, or save this snapshot.';
    case 'live':
      return 'StudyPilot can see your shared screen. Stop sharing anytime.';
    case 'thinking':
      return 'Checking the visible page before answering.';
    case 'answer':
      return 'Review the explanation, then save it to your dashboard.';
    case 'saved':
      return 'Your study session is ready for review.';
    case 'idle':
    default:
      return 'Ask anything about this page';
  }
}

function promptForAction(action: StudyAction, question: string): string {
  switch (action) {
    case 'summarize':
      return 'Summarize the page or screenshot in a concise study-friendly way. Focus on the main idea, key details, and anything worth reviewing.';
    case 'quiz':
      return 'Create a short quiz from the page or screenshot. Include 3 questions and the answers.';
    case 'flashcards':
      return 'Create 4 concise flashcards from the page or screenshot. Format each as Front and Back.';
    case 'step-by-step':
      return 'Explain the page or screenshot step by step for a student who is learning it for the first time.';
    case 'explain':
    default:
      return question;
  }
}

function buildQuestionContext(
  page: PageContext,
  context: ContextShareSettings,
): string {
  const lines: string[] = [];

  if (context.pageUrl) {
    lines.push(`Page title: ${page.sourceTitle}`);
    lines.push(`Page URL: ${page.sourceUrl}`);
  }

  if (context.selectedText && page.selectedText) {
    lines.push(`Selected text: ${page.selectedText}`);
  }

  return lines.join('\n');
}
