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
import { DASHBOARD_URL, STUDYPILOT_CONNECT_MESSAGE } from '@/shared/config';
import {
  isStudyPilotRuntimeMessage,
  type StudyPilotRuntimeMessage,
} from '@/shared/extensionMessages';
import { defaultPromptForAction, titleForAction } from '@/shared/studyActions';
import {
  STUDY_FOLDERS,
  type CoachingRequest,
  type CoachingResponse,
  type ContextShareSettings,
  type DashboardSaveResult,
  type ExtensionAuthSession,
  type ExtensionAuthState,
  type PageContext,
  type StudyAction,
  type StudyFolder,
  type StudyPhase,
  type StudySession,
  type StudyTranscriptTurn,
} from '@/shared/types';

const LOCAL_PREVIEW_TEXT =
  'Real StudyPilot AI responses are available from the built extension runtime after connecting your dashboard session.';

interface AnswerCard {
  title: string;
  body: string;
}

interface SaveSessionOptions {
  questionText?: string;
  answerText?: string;
  transcriptSnapshot?: StudyTranscriptTurn[];
  screenshotDataUrl?: string;
  successNotice?: string;
}

type OrbState = 'listening' | 'muted' | 'paused' | 'thinking';

const ACCESS_KEY = 'sp_access_token';
const REFRESH_KEY = 'sp_refresh_token';
const USER_ID_KEY = 'sp_user_id';
const EMAIL_KEY = 'sp_email';
const SUPABASE_OAUTH_STORAGE_KEY = 'sp-oauth-session';

function getPageContext(): PageContext {
  const selectedText = window.getSelection()?.toString().trim();

  // Extract readable page text for richer AI context.
  // Strips excess whitespace and caps at 6000 chars to stay within token limits.
  let pageText: string | undefined;
  try {
    const bodyText = document.body?.innerText ?? '';
    const cleaned = bodyText.replace(/\s{3,}/g, '\n\n').trim();
    if (cleaned.length > 80) {
      pageText = cleaned.length > 6000 ? `${cleaned.slice(0, 6000)}…` : cleaned;
    }
  } catch {
    // DOM access can fail in sandboxed iframes — not fatal.
  }

  return {
    sourceUrl: window.location.href,
    sourceTitle: document.title || window.location.hostname || 'Current page',
    host: window.location.hostname.replace(/^www\./, ''),
    selectedText: selectedText ? selectedText.slice(0, 280) : undefined,
    pageText,
  };
}

function isExtensionRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.runtime?.id) &&
    typeof chrome.runtime.sendMessage === 'function'
  );
}

function isDashboardBridgeOrigin(): boolean {
  try {
    return window.location.origin === new URL(DASHBOARD_URL).origin;
  } catch {
    return false;
  }
}

function readDashboardAuthSession(): ExtensionAuthSession | null {
  if (!isDashboardBridgeOrigin()) return null;

  try {
    const accessToken = window.localStorage.getItem(ACCESS_KEY);
    if (accessToken) {
      return {
        access_token: accessToken,
        refresh_token: window.localStorage.getItem(REFRESH_KEY) ?? undefined,
        user_id: window.localStorage.getItem(USER_ID_KEY) ?? undefined,
        email: window.localStorage.getItem(EMAIL_KEY),
      };
    }

    return readSupabaseStoredAuthSession();
  } catch {
    return null;
  }
}

function readSupabaseStoredAuthSession(): ExtensionAuthSession | null {
  const candidateKeys = Object.keys(window.localStorage).filter(
    key => key === SUPABASE_OAUTH_STORAGE_KEY || /^sb-.+-auth-token$/.test(key),
  );

  for (const key of candidateKeys) {
    const stored = window.localStorage.getItem(key);
    if (!stored) continue;

    try {
      const parsed = JSON.parse(stored) as unknown;
      const session = getStoredSupabaseSession(parsed);
      if (session) return session;
    } catch {
      continue;
    }
  }

  return null;
}

function getStoredSupabaseSession(value: unknown): ExtensionAuthSession | null {
  if (!isObject(value)) return null;

  const sessionValue =
    isObject(value.currentSession) ? value.currentSession :
    isObject(value.session) ? value.session :
    value;

  if (!isObject(sessionValue) || typeof sessionValue.access_token !== 'string') {
    return null;
  }

  const user = isObject(sessionValue.user) ? sessionValue.user : null;
  return {
    access_token: sessionValue.access_token,
    refresh_token: typeof sessionValue.refresh_token === 'string' ? sessionValue.refresh_token : undefined,
    user_id: typeof user?.id === 'string' ? user.id : undefined,
    email: typeof user?.email === 'string' ? user.email : null,
    expires_at: typeof sessionValue.expires_at === 'number' ? sessionValue.expires_at : undefined,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

  const [micOn, setMicOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<StudyPhase>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [authState, setAuthState] = useState<ExtensionAuthState | null>(null);

  const [page, setPage] = useState<PageContext>(() => getPageContext());
  const [question, setQuestion] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [card, setCard] = useState<AnswerCard>({
    title: 'Ready to coach',
    body: 'Ask about this page, summarize it, or save a session once the extension is connected.',
  });
  const [cardOpen, setCardOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [transcript, setTranscript] = useState<StudyTranscriptTurn[]>([]);
  const [lastScreenshotDataUrl, setLastScreenshotDataUrl] = useState<string | null>(null);
  const [cardScreenshotDataUrl, setCardScreenshotDataUrl] = useState<string | null>(null);

  const [context, setContext] = useState<ContextShareSettings>({
    screenshot: false,
    pageUrl: true,
    selectedText: false,
    saveToDashboard: true,
    folder: 'Biology 101',
  });

  // Session-scoped chat ID — null until the server assigns one via the first coaching response commit.
  const sessionChatIdRef = useRef<string | null>(null);

  const noticeTimer = useRef<number | undefined>(undefined);
  const sessionStartedAt = useRef(Date.now());

  useEffect(() => {
    // Preload available voices so getBestVoice() has them ready.
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        window.speechSynthesis.getVoices(); // triggers caching
      });
    }
  }, []);

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
    void bridgeDashboardSession();
  }, []);

  useEffect(() => {
    if (!isDashboardBridgeOrigin()) return;

    const syncSession = () => {
      void bridgeDashboardSession();
    };

    window.addEventListener('focus', syncSession);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncSession();
    });

    return () => {
      window.removeEventListener('focus', syncSession);
      document.removeEventListener('visibilitychange', syncSession);
    };
  }, []);

  useEffect(() => {
    if (isOpen) void refreshAuthState();
  }, [isOpen]);

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
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      recognitionRef.current?.stop();
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
    : authState?.connected === false
      ? 'Connect in the web app'
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

  function elapsedSeconds() {
    return Math.max(0, Math.round((Date.now() - sessionStartedAt.current) / 1000));
  }

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

  async function runStudyAction(action: StudyAction, customQuestion?: string, autoSpeak = false) {
    const prompt = customQuestion?.trim();
    const studentText = prompt || defaultPromptForAction(action);
    const priorTranscript = transcript;
    const userTurn: StudyTranscriptTurn = {
      id: crypto.randomUUID(),
      sequence: transcript.length,
      role: 'user',
      text: studentText,
      atSeconds: elapsedSeconds(),
    };

    setPhase('thinking');
    setFeedback(null);
    setCopied(false);
    setLastQuestion(studentText);
    setCardScreenshotDataUrl(null);

    try {
      const response = await sendRuntimeMessage<CoachingResponse>({
        type: 'STUDYPILOT_REQUEST_COACHING',
        payload: {
          ...(sessionChatIdRef.current ? { chatId: sessionChatIdRef.current } : {}),
          requestId: crypto.randomUUID(),
          action,
          question: prompt,
          userMessage: studentText,
          page,
          context,
          originSurface: 'extension',
          clientContext: {
            page: { title: page.sourceTitle, url: page.sourceUrl },
            action,
            selection: page.selectedText,
            integrity: 'extension-v1',
          },
        } as CoachingRequest,
      });

      if (!response) {
        setCard({
          title: 'Extension runtime required',
          body: LOCAL_PREVIEW_TEXT,
        });
        setCardOpen(true);
        setPhase('answer');
        flashNotice('Preview mode');
        return;
      }

      if (!response.text.trim()) {
        throw new Error('StudyPilot AI returned an empty response.');
      }

      const responseText = response.text.trim();
      const screenshotDataUrl = response.screenshotDataUrl ?? null;

      // Capture the server-assigned chatId from the commit so subsequent
      // requests in this session attach to the same chat.
      if (response.commit?.chatId) {
        sessionChatIdRef.current = response.commit.chatId;
      }

      const aiTurn: StudyTranscriptTurn = {
        id: crypto.randomUUID(),
        sequence: priorTranscript.length + 1,
        role: 'ai',
        text: responseText,
        atSeconds: Math.max(userTurn.atSeconds + 1, elapsedSeconds()),
      };
      const nextTranscript = [...priorTranscript, userTurn, aiTurn];

      setTranscript(nextTranscript);
      if (screenshotDataUrl) setLastScreenshotDataUrl(screenshotDataUrl);
      setCardScreenshotDataUrl(screenshotDataUrl);
      setCard({
        title: response.title || titleForAction(action, prompt),
        body: responseText,
      });
      setCardOpen(true);
      setPhase('answer');
      flashNotice('Coach response ready');
      if (autoSpeak) {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = makeSpeechUtterance(responseText);
          utterance.onstart = () => setIsSpeaking(true);
          utterance.onend = () => setIsSpeaking(false);
          utterance.onerror = () => setIsSpeaking(false);
          window.speechSynthesis.speak(utterance);
        }
      }
      await refreshAuthState();
      if (context.saveToDashboard) {
        void persistSessionToDashboard({
          questionText: studentText,
          answerText: responseText,
          transcriptSnapshot: nextTranscript,
          screenshotDataUrl: context.screenshot ? screenshotDataUrl ?? undefined : undefined,
          successNotice: 'Saved to StudyPilot',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'StudyPilot AI could not respond.';
      setCard({
        title: message.includes('connected') || message.includes('signed') || message.includes('session')
          ? 'Connect StudyPilot'
          : 'Coach unavailable',
        body: message.includes('StudyPilot is not connected')
          ? STUDYPILOT_CONNECT_MESSAGE
          : message,
      });
      setCardOpen(true);
      setPhase('answer');
      flashNotice('Could not reach StudyPilot AI', 3000);
    }
  }

  function handleSubmit() {
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    void runStudyAction('explain', text);
  }

  async function saveToDashboard() {
    await persistSessionToDashboard();
  }

  async function persistSessionToDashboard(options: SaveSessionOptions = {}) {
    if (isSaving) return;

    setIsSaving(true);
    const questionText = options.questionText ?? (lastQuestion || card.title);
    const answerText = options.answerText ?? card.body;
    const transcriptSnapshot = options.transcriptSnapshot ?? (transcript.length > 0
      ? transcript
      : fallbackTranscript(questionText, answerText));
    const session = createStudySession({
      page,
      folder: context.folder,
      question: questionText,
      answer: answerText,
      transcript: transcriptSnapshot,
      screenshotDataUrl:
        options.screenshotDataUrl ??
        (context.screenshot ? lastScreenshotDataUrl ?? undefined : undefined),
      tags: ['study-session', context.folder.toLowerCase().replace(/\s+/g, '-')],
    });

    try {
      const response = await sendRuntimeMessage<DashboardSaveResult>({
        type: 'STUDYPILOT_SAVE_SESSION',
        payload: { chatId: sessionChatIdRef.current ?? '', session },
      });

      if (!response) {
        setCard({
          title: 'Extension runtime required',
          body: 'Open the built Chrome extension to save sessions to StudyPilot.',
        });
        setCardOpen(true);
        setPhase('answer');
        flashNotice('Preview mode cannot save', 2600);
        return;
      }

      setPhase('saved');
      flashNotice(
        response?.warning ? 'Saved; summary pending' : (options.successNotice ?? `Saved to ${session.folder}`),
        2600,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save right now';
      flashNotice(message.includes('connected') ? 'Connect dashboard first' : 'Could not save right now');
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

  async function captureSnapshot() {
    try {
      const snapshot = await sendRuntimeMessage<{
        dataUrl: string;
        mimeType: string;
      }>({
        type: 'STUDYPILOT_CAPTURE_VISIBLE_TAB',
      });
      if (snapshot?.dataUrl) {
        setLastScreenshotDataUrl(snapshot.dataUrl);
        setCardScreenshotDataUrl(snapshot.dataUrl);
        setContext(prev => ({ ...prev, screenshot: true }));
        flashNotice('Screenshot ready for coaching', 2600);
      }
    } catch {
      flashNotice('Could not capture screenshot', 3000);
    }
  }

  function speakAnswer() {
    if (!('speechSynthesis' in window)) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = makeSpeechUtterance(card.body);
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

  // Web Speech API recognition instance — kept in a ref so start/stop
  // work across renders without creating multiple instances.
  const recognitionRef = useRef<any>(null);

  function toggleMic() {
    if (micOn) {
      // Stop listening
      recognitionRef.current?.stop();
      setMicOn(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      flashNotice('Voice input is not supported in this browser.', 3000);
      return;
    }

    const recognition: any = new SpeechRecognition();
    recognition.continuous = false;      // stop after first utterance
    recognition.interimResults = false;  // only final results
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setMicOn(true);
      setPaused(false);
      flashNotice('Listening…', 8000);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (transcript) {
        setMicOn(false);
        flashNotice(`"${transcript.slice(0, 40)}${transcript.length > 40 ? '…' : ''}"`, 2000);
        void runStudyAction('explain', transcript, true);
      }
    };

    recognition.onerror = (event: any) => {
      setMicOn(false);
      if (event.error === 'not-allowed') {
        flashNotice('Microphone access denied. Allow it in Chrome settings.', 4000);
      } else if (event.error !== 'no-speech') {
        flashNotice('Voice input failed. Try again.', 3000);
      }
    };

    recognition.onend = () => {
      setMicOn(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      flashNotice('Could not start voice input. Try again.', 3000);
      setMicOn(false);
    }
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
                        label="Check image capture"
                        onClick={() => {
                          setMenuOpen(false);
                          void captureSnapshot();
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
              {/* Show a web-app connect prompt when no session is available */}
              {authState?.connected === false ? (
                <WebAppConnectView onOpenDashboard={() => void openDashboard()} />
              ) : (
              <><motion.section
                  className="sp-stage"
                  variants={sectionReveal}
                  aria-live="polite"
                >
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
                <QuickChip label="Summarize" onClick={() => void runStudyAction('summarize')}>
                  <SummarizeGlyph />
                </QuickChip>
                <QuickChip label="Explain" onClick={() => void runStudyAction('explain')}>
                  <ExplainGlyph />
                </QuickChip>
                <QuickChip label="Quiz Me" onClick={() => void runStudyAction('quiz')}>
                  <QuizGlyph />
                </QuickChip>
                <QuickChip label="Flashcards" onClick={() => void runStudyAction('flashcards')}>
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
                      {cardScreenshotDataUrl ? (
                        <figure className="sp-card-screenshot">
                          <img
                            src={cardScreenshotDataUrl}
                            alt="Screenshot shared with StudyPilot"
                          />
                          <figcaption>
                            <Camera size={13} />
                            <span>Screenshot shared</span>
                          </figcaption>
                        </figure>
                      ) : null}
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
              </>
            )}  
            </motion.div>{/* end sp-body */}
 
          
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
          label={context.screenshot ? 'Screenshot on' : 'No screenshot'}
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

interface StudySessionInput {
  page: PageContext;
  folder: StudyFolder;
  question: string;
  answer: string;
  transcript?: StudyTranscriptTurn[];
  screenshotDataUrl?: string;
  screenshotUrl?: string;
  tags?: string[];
}

function createStudySession(input: StudySessionInput): StudySession {
  const durationSeconds =
    input.transcript && input.transcript.length > 0
      ? Math.max(...input.transcript.map(turn => turn.atSeconds))
      : 0;

  return {
    id: crypto.randomUUID?.() ?? `study_${Date.now().toString(36)}`,
    title: input.page.sourceTitle || 'StudyPilot session',
    sourceUrl: input.page.sourceUrl,
    sourceTitle: input.page.sourceTitle || input.page.host,
    screenshotUrl: input.screenshotUrl,
    screenshotDataUrl: input.screenshotDataUrl,
    question: input.question,
    answer: input.answer,
    transcript: input.transcript,
    folder: input.folder,
    mode: 'Study Coach',
    durationSeconds,
    createdAt: new Date().toISOString(),
    tags: input.tags ?? ['screen-help', 'saved-explanation'],
  };
}

/**
 * Pick the best available speech synthesis voice.
 * Prefers Google's neural voices, then falls back to any English voice.
 */
function getBestVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const googleNeural = voices.find(v =>
    v.name.includes('Google') && v.lang.startsWith('en')
  );
  if (googleNeural) return googleNeural;

  const english = voices.find(v => v.lang.startsWith('en-US'));
  return english ?? voices[0] ?? null;
}

function makeSpeechUtterance(text: string): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  const voice = getBestVoice();
  if (voice) utterance.voice = voice;
  return utterance;
}

function fallbackTranscript(question: string, answer: string): StudyTranscriptTurn[] {
  const turns: StudyTranscriptTurn[] = [
    { id: crypto.randomUUID(), sequence: 0, role: 'user', text: question, atSeconds: 0 },
    { id: crypto.randomUUID(), sequence: 1, role: 'ai', text: answer, atSeconds: 1 },
  ];

  return turns.filter(turn => turn.text.trim().length > 0);
}

/* ============================================================================
   WebAppConnectView — shown when the extension has no stored session.
   Directs users to the StudyPilot web app, where the extension can connect
   automatically once the browser session is available.
   ============================================================================ */

function WebAppConnectView({
  onOpenDashboard,
}: {
  onOpenDashboard: () => void;
}) {
  return (
    <div className="sp-login">
      <div className="sp-login-brand">
        <SparkleLogo size={28} />
        <span>Connect StudyPilot</span>
      </div>
      <div className="sp-login-form">
        <p className="sp-login-error" style={{ margin: 0 }}>
          Open the StudyPilot web app, sign in, and this extension will connect automatically.
        </p>
        <button type="button" className="sp-login-btn" onClick={onOpenDashboard}>
          Open web app
        </button>
      </div>
    </div>
  );
}
