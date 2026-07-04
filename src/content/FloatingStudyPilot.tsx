import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkCheck,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Crown,
  ExternalLink,
  Mic,
  MicOff,
  Minus,
  MoreVertical,
  Pause,
  Pin,
  Play,
  Send,
  Settings,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, ReactNode, SetStateAction } from 'react';
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
  type ContextShareSettings,
  type DashboardSaveResult,
  type PageContext,
  type StudyAction,
  type StudyFolder,
  type StudyPhase,
} from '@/shared/types';

const MOCK_ANSWER =
  'Photosynthesis converts light energy into chemical energy. Plants use light, water, and carbon dioxide to produce glucose and oxygen. It occurs in two main stages: the light-dependent reactions (producing ATP and NADPH) and the Calvin cycle (fixing CO₂ into glucose).';

interface AnswerCard {
  title: string;
  body: string;
}

type OrbState = 'listening' | 'muted' | 'paused' | 'thinking';

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

export function FloatingStudyPilot({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isPinned, setIsPinned] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [micOn, setMicOn] = useState(true);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<StudyPhase>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const [page, setPage] = useState<PageContext>(() => getPageContext());
  const [question, setQuestion] = useState('');
  const [card, setCard] = useState<AnswerCard>({
    title: 'Photosynthesis explained',
    body: MOCK_ANSWER,
  });
  const [cardOpen, setCardOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [context, setContext] = useState<ContextShareSettings>({
    screenshot: true,
    pageUrl: true,
    selectedText: false,
    saveToDashboard: true,
    folder: 'Biology 101',
  });

  const thinkingTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const refreshSelection = () => setPage(getPageContext());

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
      if (!isStudyPilotRuntimeMessage(message)) return false;
      if (message.type === 'STUDYPILOT_OPEN_MODAL') setIsOpen(true);
      if (message.type === 'STUDYPILOT_TOGGLE_MODAL') setIsOpen(value => !value);
      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      if (!isPinned) setIsOpen(false);
    };

    if (isOpen) document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isPinned]);

  useEffect(() => {
    return () => {
      if (thinkingTimer.current) window.clearTimeout(thinkingTimer.current);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const orbState: OrbState = phase === 'thinking'
    ? 'thinking'
    : paused
      ? 'paused'
      : micOn
        ? 'listening'
        : 'muted';

  const statusText = notice
    ? notice
    : phase === 'thinking'
      ? 'Thinking...'
      : paused
        ? 'Paused'
        : micOn
          ? 'Listening...'
          : 'Mic muted';

  const sourceLabel = useMemo(() => {
    if (!page.host) return 'this page';
    return page.host;
  }, [page.host]);

  function flashNotice(text: string, duration = 2200) {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), duration);
  }

  function runStudyAction(action: StudyAction, customQuestion?: string) {
    if (thinkingTimer.current) window.clearTimeout(thinkingTimer.current);

    setPhase('thinking');
    setFeedback(null);
    setCopied(false);

    thinkingTimer.current = window.setTimeout(() => {
      setCard(cardForAction(action, customQuestion));
      setCardOpen(true);
      setPhase('answer');
      flashNotice('Answer ready');
    }, 950);
  }

  function handleSubmit() {
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    runStudyAction('explain', text);
  }

  async function saveToDashboard() {
    if (isSaving) return;

    setIsSaving(true);
    const session = createMockStudySession({
      page,
      folder: context.folder,
      question: card.title,
      answer: card.body,
      screenshotUrl: context.screenshot ? 'mock://studypilot/screenshot' : undefined,
      tags: ['study-session', context.folder.toLowerCase().replace(/\s+/g, '-')],
    });

    try {
      const response = await sendRuntimeMessage<DashboardSaveResult>({
        type: 'STUDYPILOT_SAVE_SESSION',
        payload: { session },
      });

      if (!response) await saveStudySession(session);
      setPhase('saved');
      flashNotice(`Saved to ${session.folder}`, 2600);
    } catch {
      flashNotice('Could not save right now');
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

  function captureSnapshot() {
    // TODO: Replace the simulated snapshot with chrome.tabs.captureVisibleTab
    // through the background worker once the real capture flow is designed.
    setContext(prev => ({ ...prev, screenshot: true }));
    flashNotice('Snapshot added to context');
  }

  function speakAnswer() {
    if (!('speechSynthesis' in window)) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(card.body);
    utterance.rate = 1.02;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(card.body);
    } catch {
      const scratch = document.createElement('textarea');
      scratch.value = card.body;
      scratch.style.position = 'fixed';
      scratch.style.opacity = '0';
      document.body.appendChild(scratch);
      scratch.select();
      document.execCommand('copy');
      scratch.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function toggleMic() {
    setMicOn(value => {
      const next = !value;
      if (next) setPaused(false);
      return next;
    });
  }

  return (
    <div className="sp-extension">
      <AnimatePresence>
        {!isOpen ? (
          <motion.button
            key="launcher"
            type="button"
            className="sp-launcher"
            aria-label="Open Study Pilot"
            title={`Study Pilot — ask about ${sourceLabel}`}
            onClick={() => setIsOpen(true)}
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="sp-launcher-ring" aria-hidden="true" />
            <span className="sp-launcher-wave" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen ? (
          <motion.section
            key="panel"
            className="sp-panel"
            role="dialog"
            aria-label="Study Pilot"
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="sp-header">
              <div className="sp-brand">
                <SparkleLogo size={30} />
                <strong>Study Pilot</strong>
              </div>
              <div className="sp-header-actions">
                <button
                  type="button"
                  className="sp-icon-button"
                  data-active={isPinned}
                  aria-label={isPinned ? 'Unpin Study Pilot' : 'Pin Study Pilot'}
                  aria-pressed={isPinned}
                  onClick={() => setIsPinned(value => !value)}
                >
                  <Pin size={19} strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  className="sp-icon-button"
                  aria-label="More options"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(value => !value)}
                >
                  <MoreVertical size={20} strokeWidth={2} />
                </button>
              </div>

              <AnimatePresence>
                {menuOpen ? (
                  <>
                    <button
                      type="button"
                      className="sp-menu-backdrop"
                      aria-label="Close menu"
                      onClick={() => setMenuOpen(false)}
                    />
                    <motion.div
                      className="sp-menu"
                      role="menu"
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.14 }}
                    >
                      <MenuItem
                        icon={<Camera size={16} />}
                        label="Capture snapshot"
                        onClick={() => {
                          setMenuOpen(false);
                          captureSnapshot();
                        }}
                      />
                      <MenuItem
                        icon={<BookmarkCheck size={16} />}
                        label={isSaving ? 'Saving…' : 'Save to dashboard'}
                        onClick={() => {
                          setMenuOpen(false);
                          void saveToDashboard();
                        }}
                      />
                      <MenuItem
                        icon={<ExternalLink size={16} />}
                        label="Open dashboard"
                        onClick={() => {
                          setMenuOpen(false);
                          void openDashboard();
                        }}
                      />
                      <MenuItem
                        icon={<Minus size={16} />}
                        label="Minimize"
                        onClick={() => {
                          setMenuOpen(false);
                          setIsOpen(false);
                        }}
                      />
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>
            </header>

            <motion.div
              className="sp-body"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
              }}
            >
              <motion.section className="sp-stage" variants={sectionReveal} aria-live="polite">
                <span className="sp-presence-dot" aria-hidden="true" />
                <Orb state={orbState} />
                <p className="sp-status" data-state={orbState}>
                  {statusText}
                </p>
                <h2 className="sp-headline">Ask anything about this page</h2>
              </motion.section>

              <motion.div className="sp-voice-dock" variants={sectionReveal}>
                <RoundButton
                  active={micOn && !paused}
                  label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  onClick={toggleMic}
                >
                  {micOn ? <Mic size={22} /> : <MicOff size={22} />}
                </RoundButton>
                <RoundButton
                  active={isSpeaking}
                  label={isSpeaking ? 'Stop reading aloud' : 'Read answer aloud'}
                  onClick={speakAnswer}
                >
                  <Volume2 size={22} />
                </RoundButton>
                <RoundButton
                  active={false}
                  label={paused ? 'Resume session' : 'Pause session'}
                  onClick={() => setPaused(value => !value)}
                >
                  {paused ? <Play size={22} /> : <Pause size={22} />}
                </RoundButton>
                <RoundButton
                  active={settingsOpen}
                  tinted
                  label="Session settings"
                  onClick={() => setSettingsOpen(value => !value)}
                >
                  <Settings size={22} />
                </RoundButton>
              </motion.div>

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
                      onChange={setContext}
                      onOpenDashboard={() => void openDashboard()}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <motion.div className="sp-composer" variants={sectionReveal}>
                <input
                  type="text"
                  value={question}
                  placeholder="Ask a question or say something..."
                  aria-label="Ask a question"
                  onChange={event => setQuestion(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
                <button
                  type="button"
                  className="sp-send"
                  aria-label="Send question"
                  onClick={handleSubmit}
                  disabled={!question.trim()}
                >
                  <Send size={17} strokeWidth={2} fill="currentColor" />
                </button>
              </motion.div>

              <motion.div className="sp-chips" variants={sectionReveal}>
                <QuickChip label="Summarize" onClick={() => runStudyAction('summarize')}>
                  <SummarizeGlyph />
                </QuickChip>
                <QuickChip label="Explain" onClick={() => runStudyAction('explain')}>
                  <ExplainGlyph />
                </QuickChip>
                <QuickChip label="Quiz Me" onClick={() => runStudyAction('quiz')}>
                  <QuizGlyph />
                </QuickChip>
                <QuickChip label="Flashcards" onClick={() => runStudyAction('flashcards')}>
                  <FlashcardsGlyph />
                </QuickChip>
              </motion.div>

              <motion.section
                className="sp-card"
                variants={sectionReveal}
                data-thinking={phase === 'thinking'}
              >
                <button
                  type="button"
                  className="sp-card-head"
                  aria-expanded={cardOpen}
                  onClick={() => setCardOpen(value => !value)}
                >
                  <strong>{card.title}</strong>
                  <span className="sp-card-time">Just now</span>
                  <ChevronDown
                    size={20}
                    className="sp-card-chevron"
                    data-open={cardOpen}
                    aria-hidden="true"
                  />
                </button>

                <AnimatePresence initial={false}>
                  {cardOpen ? (
                    <motion.div
                      key="card-body"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <p className="sp-card-body">{card.body}</p>
                      <div className="sp-card-actions">
                        <button
                          type="button"
                          aria-label={isSpeaking ? 'Stop reading aloud' : 'Read aloud'}
                          data-active={isSpeaking}
                          onClick={speakAnswer}
                        >
                          <Volume2 size={19} />
                        </button>
                        <button
                          type="button"
                          aria-label="Copy answer"
                          onClick={() => void copyAnswer()}
                        >
                          {copied ? <Check size={19} /> : <Copy size={19} />}
                        </button>
                        <span className="sp-card-spacer" />
                        <button
                          type="button"
                          aria-label="Helpful"
                          data-feedback="up"
                          data-active={feedback === 'up'}
                          onClick={() => setFeedback(value => (value === 'up' ? null : 'up'))}
                        >
                          <ThumbsUp size={19} />
                        </button>
                        <button
                          type="button"
                          aria-label="Not helpful"
                          data-feedback="down"
                          data-active={feedback === 'down'}
                          onClick={() => setFeedback(value => (value === 'down' ? null : 'down'))}
                        >
                          <ThumbsDown size={19} />
                        </button>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.section>
            </motion.div>

            <footer className="sp-footer">
              <button
                type="button"
                className="sp-pro"
                onClick={() => void openDashboard()}
              >
                <Crown size={16} />
                <span>Pro</span>
              </button>
            </footer>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const sectionReveal = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function Orb({ state }: { state: OrbState }) {
  return (
    <div className="sp-orb" data-state={state} aria-hidden="true">
      <span className="sp-orb-ripples" />
      <span className="sp-orb-bloom sp-orb-bloom--violet" />
      <span className="sp-orb-bloom sp-orb-bloom--blue" />
      <span className="sp-orb-halo" />
      <span className="sp-orb-ring" />
      <span className="sp-orb-nebula" />
      <span className="sp-orb-core" />
      <span className="sp-orb-wave">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function RoundButton({
  active,
  tinted = false,
  label,
  onClick,
  children,
}: {
  active: boolean;
  tinted?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sp-round"
      data-active={active}
      data-tinted={tinted}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="sp-menu-item" role="menuitem" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function QuickChip({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="sp-chip" onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
  );
}

function SettingsSheet({
  page,
  context,
  onChange,
  onOpenDashboard,
}: {
  page: PageContext;
  context: ContextShareSettings;
  onChange: Dispatch<SetStateAction<ContextShareSettings>>;
  onOpenDashboard: () => void;
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
    <section className="sp-settings">
      <div className="sp-settings-title">
        <ShieldCheck size={14} />
        <span>Shared when you ask or save</span>
      </div>

      <div className="sp-settings-toggles">
        <TogglePill
          label="Screenshot"
          checked={context.screenshot}
          onChange={setFlag('screenshot')}
        />
        <TogglePill
          label="Page URL"
          checked={context.pageUrl}
          onChange={setFlag('pageUrl')}
        />
        <TogglePill
          label={page.selectedText ? 'Selected text' : 'No selection'}
          checked={context.selectedText}
          onChange={setFlag('selectedText')}
        />
        <TogglePill
          label="Auto-save"
          checked={context.saveToDashboard}
          onChange={setFlag('saveToDashboard')}
        />
      </div>

      <div className="sp-settings-row">
        <label className="sp-folder">
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
        <button type="button" className="sp-dashboard-link" onClick={onOpenDashboard}>
          <ExternalLink size={14} />
          <span>Dashboard</span>
        </button>
      </div>
    </section>
  );
}

function TogglePill({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="sp-toggle" data-checked={checked}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function SparkleLogo({ size = 28 }: { size?: number }) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      aria-hidden="true"
      className="sp-logo"
    >
      <defs>
        <linearGradient
          id={`sp-spark-${gradientId}`}
          x1="8"
          y1="4"
          x2="38"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#8fdcff" />
          <stop offset="0.52" stopColor="#38a1ff" />
          <stop offset="1" stopColor="#2e5bff" />
        </linearGradient>
      </defs>
      <path
        d="M26.5 2.5c.78 10.5 5.22 14.94 15.72 15.72-10.5.78-14.94 5.22-15.72 15.72-.78-10.5-5.22-14.94-15.72-15.72C21.28 17.44 25.72 13 26.5 2.5Z"
        fill={`url(#sp-spark-${gradientId})`}
      />
      <path
        d="M11.5 28c.42 5.55 2.78 7.91 8.33 8.33-5.55.42-7.91 2.78-8.33 8.33-.42-5.55-2.78-7.91-8.33-8.33 5.55-.42 7.91-2.78 8.33-8.33Z"
        fill={`url(#sp-spark-${gradientId})`}
      />
    </svg>
  );
}

function SummarizeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect width="18" height="18" rx="4.5" fill="#3d7dfd" />
      <path
        d="M5.4 5.6h7.2M5.4 8.6h7.2M5.4 11.6h4.6"
        stroke="#eaf2ff"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExplainGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 1.8a5.1 5.1 0 0 0-2.9 9.3c.6.44.9 1.02.9 1.65v.35h4v-.35c0-.63.3-1.21.9-1.65A5.1 5.1 0 0 0 9 1.8Z"
        stroke="#fbbf24"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M7.2 15.4h3.6" stroke="#fbbf24" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function QuizGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="9" fill="#1fbc84" />
      <path
        d="M6.9 6.9c.2-1.25 1.16-2 2.3-2 1.26 0 2.2.86 2.2 2 0 1.55-1.85 1.7-2.15 3"
        stroke="#f2fff9"
        strokeWidth="1.55"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="9.2" cy="12.9" r="0.95" fill="#f2fff9" />
    </svg>
  );
}

function FlashcardsGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect width="18" height="18" rx="4.5" fill="#8b5cf6" />
      <rect x="6.8" y="4.4" width="6.8" height="8.8" rx="1.4" fill="#efe9ff" opacity="0.55" />
      <rect x="4.4" y="6" width="6.8" height="8.8" rx="1.4" fill="#f6f2ff" />
    </svg>
  );
}

function cardForAction(action: StudyAction, customQuestion?: string): AnswerCard {
  const question = customQuestion?.trim();

  switch (action) {
    case 'summarize':
      return {
        title: 'Page summary',
        body: 'Quick summary: this page introduces the main idea, then uses the visible example to make it concrete. Keep the definition, the example, and one question you still have.',
      };
    case 'quiz':
      return {
        title: 'Quick quiz',
        body: 'Quiz time: what is the main concept on screen, which detail supports it, and what would change if one condition in the example changed?',
      };
    case 'flashcards':
      return {
        title: 'Flashcards drafted',
        body: 'Front: What is the main idea here? Back: Explain the concept in your own words. Front: Why does the example matter? Back: It shows how the idea works in a real case.',
      };
    case 'explain':
    default:
      if (question) {
        return { title: titleFromQuestion(question), body: MOCK_ANSWER };
      }
      return { title: 'Photosynthesis explained', body: MOCK_ANSWER };
  }
}

function titleFromQuestion(question: string): string {
  const clean = question.replace(/[?!.]+$/, '').trim();
  const short = clean.length > 44 ? `${clean.slice(0, 44).trimEnd()}…` : clean;
  return short.charAt(0).toUpperCase() + short.slice(1);
}
