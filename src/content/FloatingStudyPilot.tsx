import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  CirclePause,
  CirclePlay,
  Copy,
  Crown,
  Headphones,
  HelpCircle,
  Layers,
  Lightbulb,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DASHBOARD_URL, STUDYPILOT_CONNECT_MESSAGE } from '@/shared/config';
import {
  isLiveFanoutMessage,
  isStudyPilotRuntimeMessage,
  panelRejectsSecrets,
  type StudyPilotRuntimeMessage,
} from '@/shared/extensionMessages';
import { defaultPromptForAction, titleForAction } from '@/shared/studyActions';
import {
  DEFAULT_CONTEXT_SHARE_SETTINGS,
  type CoachingImage,
  type CoachingRequest,
  type CoachingResponse,
  type ContextShareSettings,
  type DashboardSaveResult,
  type PageContext,
  type StudyAction,
  type StudyFolder,
  type StudyPhase,
  type StudySession,
  type StudyTranscriptTurn,
} from '@/shared/types';
import {
  FlashcardViewer,
  Orb,
  QuizViewer,
  RoundButton,
  SettingsSheet,
  SparkleLogo,
  type FlashcardItem,
  type OrbState,
  type QuizItem,
  type StructuredCard,
} from './PanelComponents';
export { SettingsSheet } from './PanelComponents';
import { useLiveCoaching } from './useLiveCoaching';
import { QuickActions } from './QuickActions';
import { isDashboardBridgeOrigin, useDashboardWorkspace } from './useDashboardWorkspace';
import { ExtensionPanel } from './ExtensionPanel';

const LOCAL_PREVIEW_TEXT =
  'Real StudyPilot AI responses are available from the built extension runtime after connecting your dashboard session.';

interface AnswerCard {
  title: string;
  body: string;
  action?: StudyAction;
}

interface SaveSessionOptions {
  chatId?: string;
  questionText?: string;
  answerText?: string;
  transcriptSnapshot?: StudyTranscriptTurn[];
  screenshotDataUrl?: string;
  successNotice?: string;
  finalize?: boolean;
}

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

  const [phase, setPhase] = useState<StudyPhase>('idle');
  const [notice, setNotice] = useState<string | null>(null);

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
  const [cardScreenshotDataUrl, setCardScreenshotDataUrl] = useState<string | null>(null);
  // Parsed structured content for flashcard/quiz UIs
  const [structuredCard, setStructuredCard] = useState<StructuredCard>(null);
  // When set, the full panel switches to dedicated study mode
  const [studyMode, setStudyMode] = useState<'flashcards' | 'quiz' | null>(null);
  const [studyLoading, setStudyLoading] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  // Screenshots attached to the *next* message the user will send
  const [pendingScreenshots, setPendingScreenshots] = useState<string[]>([]);
  const [pomodoroEndTime, setPomodoroEndTime] = useState<number | null>(null);
  const [pomodoroDuration, setPomodoroDuration] = useState<number>(25);
  const [pomodoroRemaining, setPomodoroRemaining] = useState<number | null>(null);
  const [selectionTooltip, setSelectionTooltip] = useState<{ top: number; left: number; text: string; placeBelow?: boolean } | null>(null);
  const [personality, setPersonality] = useState<string>('Default');
  const [streak, setStreak] = useState(0);
  const [pomodoroStats, setPomodoroStats] = useState<Record<string, number>>({});
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiRef = useRef<HTMLCanvasElement | null>(null);
  const [pomodoroPickerOpen, setPomodoroPickerOpen] = useState(false);

  const [context, setContext] = useState<ContextShareSettings>(
    DEFAULT_CONTEXT_SHARE_SETTINGS,
  );

  const liveLockRef = useRef(false);
  const workspace = useDashboardWorkspace({
    flashNotice,
    sendRuntimeMessage,
    isExtensionRuntime,
    isLiveLocked: () => liveLockRef.current,
    onCanonicalPresentation: presentation => {
      setTranscript(presentation.transcript);
      setLastQuestion(presentation.lastQuestion);
      setCard(presentation.card);
      if (presentation.messages.length > 0) setCardOpen(true);
      setPhase(presentation.phase);
    },
    onChatChanged: () => {
      setQuestion('');
      setLastQuestion('');
    },
    onChatReset: chatId => {
      setTranscript([]);
      setCardScreenshotDataUrl(null);
      setCard({
        title: chatId ? 'Loading conversation' : 'New conversation',
        body: chatId
          ? 'Fetching the latest shared chat history.'
          : 'Ask about this page to start a shared StudyPilot chat.',
      });
      setPhase('idle');
    },
  });

  const {
    authState,
    sharedContext,
    activeChatId,
    chatMessages,
    inFlightChatIds,
    isCreatingChat,
    isRefreshingChats,
    sessionChatIdRef,
    activeChatIdRef,
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
  } = workspace;

  const {
    liveState,
    liveFrozen,
    liveFallback,
    micOn,
    paused,
    liveBusy,
    applyLiveStatus,
    toggleMic,
    togglePause,
  } = useLiveCoaching({
    getActiveChatId: workspace.getActiveChatId,
    context,
    flashNotice,
    onVoiceQuestion: (voiceQuestion) => void runStudyAction('explain', voiceQuestion, true),
    sendRuntimeMessage,
  });
  liveLockRef.current = liveFrozen || liveBusy;

  // ── Drag-to-reposition ───────────────────────────────────────────────────────
  // null = use default CSS (bottom-right). Once the user drags, we switch to
  // explicit left/top so the panel can live anywhere on screen.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ px: number; py: number; ex: number; ey: number } | null>(null);
  const isDragging = useRef(false);

  // Resize state — null = use default CSS dimensions
  const MIN_W = 300; const MAX_W = 600;
  const MIN_H = 480; const MAX_H = 860;
  const [panelSize, setPanelSize] = useState<{ w: number; h: number } | null>(null);
  const resizeStart = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const panel = e.currentTarget.closest('.sp-panel') as HTMLElement | null;
    resizeStart.current = {
      px: e.clientX,
      py: e.clientY,
      w: panel?.offsetWidth ?? 390,
      h: panel?.offsetHeight ?? 680,
    };
  }

  function onResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizeStart.current) return;
    const dw = e.clientX - resizeStart.current.px;
    const dh = e.clientY - resizeStart.current.py;
    setPanelSize({
      w: Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + dw)),
      h: Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + dh)),
    });
  }

  function onResizePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    resizeStart.current = null;
  }

  function onHeaderPointerDown(e: React.PointerEvent<HTMLElement>) {
    // Only drag on primary button; ignore clicks on interactive children
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = false;

    // Current panel top-left in viewport coords
    const panel = e.currentTarget.closest('.sp-panel') as HTMLElement | null;
    const rect = panel?.getBoundingClientRect() ?? { left: 0, top: 0 };

    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      ex: rect.left,
      ey: rect.top,
    };
  }

  function onHeaderPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!dragStart.current) return;

    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;

    if (!isDragging.current && Math.hypot(dx, dy) < 4) return;
    isDragging.current = true;

    const panelW = (e.currentTarget.closest('.sp-panel') as HTMLElement | null)?.offsetWidth ?? 400;
    const panelH = (e.currentTarget.closest('.sp-panel') as HTMLElement | null)?.offsetHeight ?? 700;
    const margin = 8;

    const rawX = dragStart.current.ex + dx;
    const rawY = dragStart.current.ey + dy;

    const x = Math.max(margin, Math.min(rawX, window.innerWidth - panelW - margin));
    const y = Math.max(margin, Math.min(rawY, window.innerHeight - panelH - margin));

    setDragPos({ x, y });
  }

  function onHeaderPointerUp(e: React.PointerEvent<HTMLElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStart.current = null;
    // If it was a tiny movement treat it as a click — don't swallow the event
  }

  // ── Launcher drag (when panel is closed) ─────────────────────────────────
  const launcherDragStart = useRef<{ px: number; py: number; ex: number; ey: number } | null>(null);
  const launcherDidDrag = useRef(false);

  function onLauncherPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    launcherDidDrag.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    launcherDragStart.current = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
  }

  function onLauncherPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!launcherDragStart.current) return;
    const dx = e.clientX - launcherDragStart.current.px;
    const dy = e.clientY - launcherDragStart.current.py;
    if (!launcherDidDrag.current && Math.hypot(dx, dy) < 4) return;
    launcherDidDrag.current = true;
    e.preventDefault();

    const btnW = e.currentTarget.offsetWidth;
    const btnH = e.currentTarget.offsetHeight;
    const margin = 8;
    const x = Math.max(margin, Math.min(launcherDragStart.current.ex + dx, window.innerWidth - btnW - margin));
    const y = Math.max(margin, Math.min(launcherDragStart.current.ey + dy, window.innerHeight - btnH - margin));
    setDragPos({ x, y });
  }

  function onLauncherPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    launcherDragStart.current = null;
  }

  const noticeTimer = useRef<number | undefined>(undefined);
  const sessionStartedAt = useRef(Date.now());

  useEffect(() => {
    // Preload available voices so getBestVoice() has them ready.
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const onVoicesChanged = () => {
        window.speechSynthesis.getVoices(); // triggers caching
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
    }
    return undefined;
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
      if (panelRejectsSecrets(message)) {
        console.warn('[StudyPilot] Refusing panel message that appears to contain secrets.');
        return false;
      }
      if (isLiveFanoutMessage(message)) {
        if (message.type === 'STUDYPILOT_LIVE_STATUS') {
          applyLiveStatus({
            state: message.state,
            selectionFrozen: message.selectionFrozen,
            error: message.error,
            warning: message.warning,
            fallback: message.fallback ?? null,
            rubric: message.rubric,
            ragReady: message.ragReady,
            chatId: message.selection.chatId,
          });
        } else if (message.type === 'STUDYPILOT_LIVE_WARNING' && message.message) {
          flashNotice(message.message, 3600);
        } else if (message.type === 'STUDYPILOT_LIVE_TRANSCRIPT' && message.finalized && message.text) {
          setTranscript(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: message.role === 'assistant' ? 'ai' : 'user',
              text: message.text,
              atSeconds: Math.floor(Date.now() / 1000),
              sequence: prev.length + 1,
              createdAt: new Date().toISOString(),
            },
          ]);
          if (message.role === 'assistant') {
            setCard({ title: 'Live coach', body: message.text });
            setCardOpen(true);
            setPhase('answer');
          }
        }
        return false;
      }
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

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncSession();
    };

    window.addEventListener('focus', syncSession);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', syncSession);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let tooltipLock = false;

    function handleMouseUp(e: MouseEvent) {
      // Ignore mouseup if selection happened inside the extension shadow DOM
      const target = e.target as HTMLElement;
      if (target && target.closest && target.closest('#studypilot-extension-root')) {
        return;
      }

      tooltipLock = true;
      setTimeout(() => {
        tooltipLock = false;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelectionTooltip(null);
          return;
        }
        const text = sel.toString().trim();
        if (text.length < 2) {
          setSelectionTooltip(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          setSelectionTooltip(null);
          return;
        }

        const placeBelow = rect.top < 70;
        const tooltipTop = placeBelow ? rect.bottom + 8 : rect.top - 52;
        const tooltipLeft = Math.max(10, Math.min(window.innerWidth - 280, rect.left + rect.width / 2 - 130));

        setSelectionTooltip({
          top: tooltipTop,
          left: tooltipLeft,
          text: text,
          placeBelow,
        });
      }, 50);
    }

    function handleMouseDown(e: MouseEvent) {
      const path = e.composedPath ? e.composedPath() : [];
      const isInsideTooltip = path.some(
        (el) => el instanceof HTMLElement && el.classList && el.classList.contains('sp-selection-tooltip')
      );
      if (isInsideTooltip) return;
      if (!tooltipLock) {
        setSelectionTooltip(null);
      }
    }

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  useEffect(() => {
    if (isOpen) void refreshExtensionWorkspace();
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
    };
  }, []);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['pomodoroEndTime', 'pomodoroDuration', 'personality', 'pomodoroStats'], (res) => {
        setPomodoroEndTime(res.pomodoroEndTime ?? null);
        if (res.pomodoroDuration) setPomodoroDuration(res.pomodoroDuration);
        if (res.personality) setPersonality(res.personality);
        if (res.pomodoroStats) setPomodoroStats(res.pomodoroStats);
      });
      const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
        if (changes.pomodoroEndTime) {
          setPomodoroEndTime(changes.pomodoroEndTime.newValue ?? null);
        }
        if (changes.pomodoroDuration) {
          setPomodoroDuration(changes.pomodoroDuration.newValue ?? 25);
        }
        if (changes.personality) {
          setPersonality(changes.personality.newValue ?? 'Default');
        }
        if (changes.pomodoroStats) {
          setPomodoroStats(changes.pomodoroStats.newValue ?? {});
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, []);

  useEffect(() => {
    if (!pomodoroEndTime) {
      setPomodoroRemaining(null);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((pomodoroEndTime - Date.now()) / 1000));
      setPomodoroRemaining(remaining);

      if (remaining <= 0) {
        setPomodoroEndTime(null);
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get('pomodoroStats', (res) => {
            const today = new Date().toISOString().split('T')[0];
            const stats = res.pomodoroStats || {};
            stats[today] = (stats[today] || 0) + pomodoroDuration;
            chrome.storage.local.set({ pomodoroStats: stats }).catch(() => {});
          });
          chrome.storage.local.remove(['pomodoroEndTime', 'pomodoroDuration']).catch(() => {});
        }
        playChime();
        void runStudyAction(
          'explain',
          `The student just completed a ${pomodoroDuration}-minute focus session. Briefly congratulate them and ask them what 2 things they learned. Keep it very short.`
        );
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [pomodoroEndTime]);

  function startPomodoro(minutes: number) {
    const end = Date.now() + minutes * 60 * 1000;
    setPomodoroEndTime(end);
    setPomodoroDuration(minutes);
    setPomodoroPickerOpen(false);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ pomodoroEndTime: end, pomodoroDuration: minutes }).catch(() => {});
    }
    playStartSound();
    flashNotice(`🎯 Focus: ${minutes} min — let's go!`);
  }

  function stopPomodoro() {
    setPomodoroEndTime(null);
    setPomodoroPickerOpen(false);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove(['pomodoroEndTime', 'pomodoroDuration']).catch(() => {});
    }
    flashNotice('Focus session ended');
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ── Sound helpers (Web Audio API, no files needed) ───────────────────────
  function playStartSound() {
    try {
      const ctx = new AudioContext();
      [440, 554.37, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.1;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
      });
      setTimeout(() => void ctx.close(), 800);
    } catch { /* */ }
  }
  function playChime() {
    try {
      const ctx = new AudioContext();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
        osc.start(start);
        osc.stop(start + 0.6);
      });
      setTimeout(() => void ctx.close(), 2000);
    } catch { /* no audio context available */ }
  }

  function playSaveSound() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      setTimeout(() => void ctx.close(), 500);
    } catch { /* no audio context available */ }
  }

  // ── Streak logic ─────────────────────────────────────────────────────────
  function updateStreak() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const today = new Date().toDateString();
    chrome.storage.local.get(['streakDate', 'streakCount'], (res) => {
      const lastDate = res.streakDate as string | undefined;
      const count = (res.streakCount as number | undefined) ?? 0;
      const newCount = lastDate === today ? count : (lastDate === new Date(Date.now() - 86400000).toDateString() ? count + 1 : 1);
      setStreak(newCount);
      chrome.storage.local.set({ streakDate: today, streakCount: newCount }).catch(() => {});
    });
  }

  // ── Confetti burst ───────────────────────────────────────────────────────
  function fireConfetti() {
    setShowConfetti(true);
    playChime();
    setTimeout(() => setShowConfetti(false), 3500);
  }

  const activeChat = sharedContext?.chats.find(chat => chat.id === activeChatId) ?? null;
  const isActiveChatSending = activeChatId !== null && inFlightChatIds.has(activeChatId);
  const orbState: OrbState =
    isActiveChatSending || phase === 'thinking' || liveState === 'connecting' || liveState === 'starting'
    ? 'thinking'
    : paused || liveState === 'paused'
      ? 'paused'
      : micOn || liveState === 'live'
        ? 'listening'
        : 'muted';

  const statusText = notice
    ? notice
    : authState?.connected === false
      ? 'Connect dashboard'
    : liveFallback === 'text-coaching'
      ? 'Live unavailable — use text coaching'
    : liveState === 'connecting' || liveState === 'starting'
      ? 'Starting Live...'
    : liveState === 'live'
      ? 'Live coaching...'
    : isActiveChatSending || phase === 'thinking'
      ? 'Thinking...'
      : paused || liveState === 'paused'
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

  async function runStudyAction(action: StudyAction, customQuestion?: string, autoSpeak = false) {
    const prompt = customQuestion?.trim();
    const targetChatId = activeChatId ?? sessionChatIdRef.current;
    let personalityPrefix = '';
    if (personality === 'Strict Tutor') personalityPrefix = 'You are a Strict Tutor. Be demanding, push the student to excel, and accept no nonsense. ';
    if (personality === 'Supportive Friend') personalityPrefix = 'You are a Supportive Friend. Be extremely encouraging, casual, and use emojis. ';
    if (personality === 'Socratic Guide') personalityPrefix = 'You are a Socratic Guide. Do NOT give the student answers directly. Instead, ask 2-3 guiding questions that lead them to discover the answer themselves. ';
    if (personality === 'Gen Z') personalityPrefix = 'You are a Gen Z student. Use modern internet slang and a very casual tone, but still be helpful. ';

    const studentText = personalityPrefix + (prompt || defaultPromptForAction(action));
    const priorTranscript = transcript;
    const userTurn: StudyTranscriptTurn = {
      id: crypto.randomUUID(),
      sequence: transcript.length,
      role: 'user',
      text: prompt || defaultPromptForAction(action), // UI shows original text without prefix
      atSeconds: elapsedSeconds(),
    };

    setPhase('thinking');
    setFeedback(null);
    setCopied(false);
    setLastQuestion(studentText);
    setCardScreenshotDataUrl(null);
    setStructuredCard(null);
    if (targetChatId) {
      addInFlightChat(targetChatId);
    }

    // Snapshot & clear pending screenshots so they are attached to this request only
    const attachedScreenshots = pendingScreenshots.slice();
    setPendingScreenshots([]);

    // Convert data URLs → CoachingImage objects for the AI payload.
    // The background won't need to call captureVisibleTab for these.
    const attachedImages: CoachingImage[] = attachedScreenshots
      .map((dataUrl): CoachingImage | null => {
        const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
        if (!match) return null;
        return {
          mimeType: match[1].toLowerCase() as CoachingImage['mimeType'],
          data: match[2],
        };
      })
      .filter((img): img is CoachingImage => img !== null);

    // For flashcards and quiz, append a JSON format instruction so the AI
    // returns machine-parseable output we can render with a proper UI.
    const structuredFormatInstruction =
      action === 'flashcards'
        ? ' Respond ONLY with a valid JSON array, no other text, no markdown fences. Format: [{"q":"question text","a":"answer text"},…] with 5–8 items.'
        : action === 'quiz'
          ? ' Respond ONLY with a valid JSON array, no other text, no markdown fences. Format: [{"question":"question text","options":["A) …","B) …","C) …","D) …"],"answer":0},…] where "answer" is the 0-based index of the correct option. Include 4–6 questions.'
          : '';

    try {
      const response = await sendRuntimeMessage<CoachingResponse>({
        type: 'STUDYPILOT_REQUEST_COACHING',
        payload: {
          ...(targetChatId ? { chatId: targetChatId } : {}),
          requestId: crypto.randomUUID(),
          action,
          question: structuredFormatInstruction ? (studentText ?? '') + structuredFormatInstruction : studentText,
          userMessage: studentText + structuredFormatInstruction,
          page,
          context: {
            ...context,
            screenshot: context.screenshot && attachedImages.length === 0,
          },
          originSurface: 'extension',
          clientContext: {
            page: { title: page.sourceTitle, url: page.sourceUrl },
            action,
            selection: page.selectedText,
            integrity: 'extension-v1',
          },
          images: attachedImages,
          screenshotDataUrl: attachedScreenshots[0],
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
      // Use whatever the background echoed back, or fall back to what we sent
      const screenshotDataUrl = response.screenshotDataUrl ?? attachedScreenshots[0] ?? null;

      // Attempt to parse structured JSON for flashcard/quiz actions
      let parsed: StructuredCard = null;
      if (action === 'flashcards' || action === 'quiz') {
        try {
          // Strip markdown code fences if the model wrapped the JSON anyway
          const jsonText = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const raw = JSON.parse(jsonText) as unknown;
          if (Array.isArray(raw) && raw.length > 0) {
            if (action === 'flashcards' && 'q' in (raw[0] as object)) {
              parsed = { type: 'flashcards', items: raw as FlashcardItem[] };
            } else if (action === 'quiz' && 'question' in (raw[0] as object)) {
              parsed = { type: 'quiz', items: raw as QuizItem[] };
            }
          }
        } catch {
          // JSON parse failed — fall through to plain text display
        }
      }

      // Capture the server-assigned chatId from the commit so subsequent
      // requests in this session attach to the same chat.
      if (response.commit?.chatId) {
        sessionChatIdRef.current = response.commit.chatId;
        if (activeChatIdRef.current !== response.commit.chatId) {
          adoptChatId(response.commit.chatId);
          void refreshSharedChatContext(response.commit.chatId);
        }
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
      // Always update so it doesn't bleed into the next message
      setCardScreenshotDataUrl(screenshotDataUrl);
      setStructuredCard(parsed);
      setCard({
        title: response.title || titleForAction(action, prompt),
        body: responseText,
        action,
      });
      setCardOpen(true);
      setPhase('answer');
      flashNotice('Coach response ready');
      playSaveSound();
      updateStreak();
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
          screenshotDataUrl: screenshotDataUrl ?? undefined,
          successNotice: 'Saved to StudyPilot',
          chatId: response.commit?.chatId ?? targetChatId ?? undefined,
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
    } finally {
      if (targetChatId) {
        removeInFlightChat(targetChatId);
      }
    }
  }

  /** Opens the full-panel study mode and fetches structured content from the AI. */
  async function openStudyMode(action: 'flashcards' | 'quiz', overrideText?: string) {
    const targetChatId = activeChatId ?? sessionChatIdRef.current;
    setStudyMode(action);
    setStudyLoading(true);
    setStudyError(null);
    setStructuredCard(null);

    // Always re-read the page right now so we have the freshest content.
    // Use a higher cap (12 000 chars) since dashboards / rich pages need more.
    let freshPage: PageContext;
    try {
      const bodyText = overrideText || document.body?.innerText || '';
      const cleaned = bodyText.replace(/\s{3,}/g, '\n\n').trim();
      const pageText = cleaned.length > 80
        ? (cleaned.length > 12000 ? `${cleaned.slice(0, 12000)}…` : cleaned)
        : undefined;
      freshPage = {
        ...getPageContext(),
        ...(overrideText ? { selectedText: overrideText } : {}),
        pageText,
      };
    } catch {
      freshPage = getPageContext();
    }

    // Keep instructions minimal to avoid hitting the streaming token limit mid-JSON.
    const formatInstruction =
      action === 'flashcards'
        ? ' Reply with ONLY a JSON array. No other text. Schema: [{"q":"...","a":"..."}]. Exactly 5 items.'
        : ' Reply with ONLY a JSON array. No other text. Schema: [{"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"answer":0}]. Exactly 4 items. "answer" is the 0-based index of the correct option.';

    const studentText = defaultPromptForAction(action) + formatInstruction;

    try {
      const response = await sendRuntimeMessage<CoachingResponse>({
        type: 'STUDYPILOT_REQUEST_COACHING',
        payload: {
          ...(targetChatId ? { chatId: targetChatId } : {}),
          requestId: crypto.randomUUID(),
          action,
          question: studentText,
          userMessage: studentText,
          page: freshPage,
          context: { ...context, screenshot: false, pageUrl: true, selectedText: false },
          originSurface: 'extension',
          clientContext: {
            page: { title: freshPage.sourceTitle, url: freshPage.sourceUrl },
            action,
            selection: undefined,
            integrity: 'extension-v1',
          },
          images: [],
        } as CoachingRequest,
      });

      if (!response?.text.trim()) throw new Error('No response from StudyPilot AI.');

      // Strip any markdown fences the model adds despite instructions
      let jsonText = response.text.trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

      // Repair truncated JSON — the SSE stream sometimes ends before the JSON is complete.
      // Work backwards to find the last fully-closed object, then close the array.
      if (!jsonText.endsWith(']')) {
        const lastClose = jsonText.lastIndexOf('}');
        if (lastClose === -1) {
          throw new Error('The AI response was cut off too early. Try again — it usually works on the second attempt.');
        }
        jsonText = jsonText.slice(0, lastClose + 1) + ']';
      }

      let raw: unknown;
      try {
        raw = JSON.parse(jsonText);
      } catch {
        // Second-pass repair: the truncation may be inside a string value.
        // Find the last '}' that results in valid JSON when we close the array after it.
        let repaired: unknown = null;
        let cursor = jsonText.lastIndexOf('}');
        while (cursor > 0) {
          try {
            repaired = JSON.parse(jsonText.slice(0, cursor + 1) + ']');
            break;
          } catch {
            cursor = jsonText.lastIndexOf('}', cursor - 1);
          }
        }
        if (!repaired) {
          throw new Error('Could not parse AI response. Try again — it usually works on the second attempt.');
        }
        raw = repaired;
      }

      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('AI returned an empty list. Try again.');
      }

      const first = raw[0] as Record<string, unknown>;

      if (action === 'flashcards') {
        if (typeof first.q === 'string' && typeof first.a === 'string') {
          setStructuredCard({ type: 'flashcards', items: raw as FlashcardItem[] });
        } else if (typeof first.question === 'string' && Array.isArray(first.options)) {
          // AI returned quiz format — convert to flashcards
          const converted: FlashcardItem[] = (raw as QuizItem[]).map(item => ({
            q: item.question,
            a: item.options[item.answer] ?? item.options[0] ?? '',
          }));
          setStructuredCard({ type: 'flashcards', items: converted });
        } else {
          throw new Error('Unexpected flashcard format. Try again.');
        }
      } else {
        if (typeof first.question === 'string' && Array.isArray(first.options)) {
          setStructuredCard({ type: 'quiz', items: raw as QuizItem[] });
        } else {
          throw new Error('Unexpected quiz format. Try again.');
        }
      }
    } catch (err) {
      setStudyError(err instanceof Error ? err.message : 'Could not load content. Try again.');
    } finally {
      setStudyLoading(false);
    }
  }

  function closeStudyMode() {
    setStudyMode(null);
    setStudyLoading(false);
    setStudyError(null);
    setStructuredCard(null);
  }

  function handleSubmit() {    const text = question.trim();
    if (!text && pendingScreenshots.length === 0) return;
    setQuestion('');
    void runStudyAction('explain', text || 'What can you tell me about this screenshot?');
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
        options.screenshotDataUrl ?? undefined,
      tags: ['study-session', context.folder.toLowerCase().replace(/\s+/g, '-')],
    });

    try {
      const response = await sendRuntimeMessage<DashboardSaveResult>({
        type: 'STUDYPILOT_SAVE_SESSION',
        payload: { chatId: options.chatId ?? activeChatId ?? sessionChatIdRef.current ?? '', session, finalize: options.finalize },
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
      flashNotice(
        message.includes('connected') || message.includes('session') || message.includes('expired')
          ? 'Connect dashboard first'
          : message.length < 80
            ? message
            : 'Could not save right now',
        3500,
      );
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

  /** Capture a screenshot and attach it to the composer for the next message. */
  async function captureAndAttach() {
    try {
      flashNotice('Capturing…', 1400);
      const snapshot = await sendRuntimeMessage<{
        dataUrl: string;
        mimeType: string;
      }>({
        type: 'STUDYPILOT_CAPTURE_VISIBLE_TAB',
      });
      if (snapshot?.dataUrl) {
        setPendingScreenshots(prev => [...prev, snapshot.dataUrl]);
        flashNotice('Screenshot attached', 2200);
      }
    } catch {
      flashNotice('Could not capture screenshot', 3000);
    }
  }

  function removePendingScreenshot(index: number) {
    setPendingScreenshots(prev => prev.filter((_, i) => i !== index));
  }

  /** Convert image Files/Blobs to JPEG data URLs (max 1024px) and add to pending list. */
  async function addImageFiles(files: File[] | DataTransferItemList | FileList) {
    const fileArray = Array.from(files as Iterable<File | DataTransferItem>)
      .map(item => ('getAsFile' in item ? item.getAsFile() : item as File))
      .filter((f): f is File => f !== null && f.type.startsWith('image/'));

    if (fileArray.length === 0) return;

    const dataUrls = await Promise.all(
      fileArray.map(
        file =>
          new Promise<string | null>(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );

    const valid = dataUrls.filter((u): u is string => u !== null);
    if (valid.length > 0) {
      setPendingScreenshots(prev => [...prev, ...valid]);
      flashNotice(valid.length === 1 ? 'Image attached' : `${valid.length} images attached`, 2000);
    }
  }

  /** Handle Ctrl+V paste of images into the composer. */
  function handleComposerPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    // Prevent the default only when there are images so text paste still works.
    event.preventDefault();
    void addImageFiles(items);
  }

  /** Open the OS file picker for image selection. */
  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) {
      void addImageFiles(files);
    }
    // Reset so the same file can be picked again
    event.target.value = '';
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

  // Hidden file input for the "pick from file explorer" flow
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  return (
    <>
      <div
        className="sp-extension"
        style={dragPos ? { left: dragPos.x, top: dragPos.y, right: 'auto', bottom: 'auto' } : undefined}
      >
        {/* Confetti canvas overlay */}
        {showConfetti && (
          <canvas
            ref={(el) => {
              confettiRef.current = el;
              if (!el) return;
              const W = window.innerWidth;
              const H = window.innerHeight;
              el.width = W;
              el.height = H;
              el.style.cssText = `position:fixed;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:99999999`;
              const ctx2d = el.getContext('2d')!;
              const particles = Array.from({ length: 120 }, () => ({
                x: Math.random() * W,
                y: Math.random() * H * 0.4 - H * 0.1,
                vx: (Math.random() - 0.5) * 6,
                vy: Math.random() * 3 + 2,
                color: ['#f97316','#ef4444','#8b5cf6','#10b981','#3b82f6','#fbbf24'][Math.floor(Math.random()*6)],
                size: Math.random() * 8 + 4,
                rot: Math.random() * 360,
                rotV: (Math.random() - 0.5) * 8,
              }));
              let alive = true;
              const draw = () => {
                if (!alive) return;
                ctx2d.clearRect(0, 0, W, H);
                for (const p of particles) {
                  ctx2d.save();
                  ctx2d.translate(p.x, p.y);
                  ctx2d.rotate((p.rot * Math.PI) / 180);
                  ctx2d.fillStyle = p.color;
                  ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
                  ctx2d.restore();
                  p.x += p.vx;
                  p.y += p.vy;
                  p.rot += p.rotV;
                  p.vy += 0.12;
                }
                requestAnimationFrame(draw);
              };
              draw();
              setTimeout(() => { alive = false; }, 3500);
            }}
          />
        )}
        <AnimatePresence>
          {!isOpen ? (
            <motion.button
              key="launcher"
              type="button"
              className="sp-launcher"
              aria-label="Open Study Pilot"
              title={`Study Pilot — ask about ${sourceLabel}`}
              onClick={() => { if (!launcherDidDrag.current) setIsOpen(true); }}
              onPointerDown={onLauncherPointerDown}
              onPointerMove={onLauncherPointerMove}
              onPointerUp={onLauncherPointerUp}
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
            <ExtensionPanel
              key="panel"
              panelSize={panelSize}
              isPinned={isPinned}
              menuOpen={menuOpen}
              isSaving={isSaving}
              personality={personality}
              streak={streak}
              isDragging={isDragging.current}
              onHeaderPointerDown={onHeaderPointerDown}
              onHeaderPointerMove={onHeaderPointerMove}
              onHeaderPointerUp={onHeaderPointerUp}
              onMinimize={() => setIsOpen(false)}
              onTogglePinned={() => setIsPinned(value => !value)}
              onToggleMenu={() => setMenuOpen(value => !value)}
              onCapture={() => void captureAndAttach()}
              onSave={() => void saveToDashboard()}
              onOpenDashboard={() => void openDashboard()}
              onPersonalityChange={value => {
                setPersonality(value);
                if (typeof chrome !== 'undefined' && chrome.storage) {
                  chrome.storage.local.set({ personality: value }).catch(() => {});
                }
              }}
            >

            <motion.div
              className="sp-body"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
              }}
            >
              {authState?.connected !== false ? (
                <motion.section className="sp-chat-switcher" variants={sectionReveal}>
                <label className="sp-chat-select">
                  <span>Shared chat</span>
                  <select
                    aria-label="Shared StudyPilot chat"
                    value={activeChatId ?? ''}
                    disabled={liveFrozen || liveBusy}
                    onChange={event => void selectDashboardChat(event.target.value || null)}
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
                  disabled={isCreatingChat || liveFrozen || liveBusy}
                  onClick={() => {
                    void createNewDashboardChat().catch(() => flashNotice('Could not create chat', 2600));
                  }}
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className="sp-chat-tool"
                  aria-label="Refresh shared chats"
                  title="Refresh chats"
                  disabled={isRefreshingChats || liveFrozen || liveBusy}
                  onClick={() => void refreshSharedChatContext(activeChatIdRef.current)}
                >
                  <RefreshCw size={15} data-spinning={isRefreshingChats} />
                </button>
                </motion.section>
              ) : null}

              {/* Show a web-app connect prompt when no session is available */}
              {authState?.connected === false ? (
                <WebAppConnectView onOpenDashboard={() => void openDashboard()} />
              ) : studyMode !== null ? (
                /* ── Dedicated study mode panel ── */
                <AnimatePresence mode="wait">
                  <motion.div
                    key={studyMode}
                    className="sp-study-panel"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="sp-study-header">
                      <button
                        type="button"
                        className="sp-study-back"
                        aria-label="Back to chat"
                        onClick={closeStudyMode}
                      >
                        <ArrowLeft size={17} strokeWidth={2} />
                        <span>Back</span>
                      </button>
                      <span className="sp-study-title">
                        {studyMode === 'flashcards'
                          ? <><Layers size={15} strokeWidth={2} /> Flashcards</>
                          : <><HelpCircle size={15} strokeWidth={2} /> Quiz</>}
                      </span>
                      <button
                        type="button"
                        className="sp-study-reload"
                        aria-label="Regenerate"
                        title="Generate new set"
                        onClick={() => void openStudyMode(studyMode)}
                        disabled={studyLoading}
                      >
                        ↺
                      </button>
                    </div>

                    {studyLoading ? (
                      <div className="sp-study-loading">
                        <span className="sp-study-spinner" aria-hidden="true" />
                        <span>Generating {studyMode === 'flashcards' ? 'flashcards' : 'quiz'}…</span>
                      </div>
                    ) : studyError ? (
                      <div className="sp-study-error">
                        <p>{studyError}</p>
                        <button type="button" onClick={() => void openStudyMode(studyMode)}>Try again</button>
                      </div>
                    ) : structuredCard?.type === 'flashcards' ? (
                      <FlashcardViewer items={structuredCard.items} />
                    ) : structuredCard?.type === 'quiz' ? (
                      <QuizViewer items={structuredCard.items} onPerfectScore={fireConfetti} />
                    ) : null}
                  </motion.div>
                </AnimatePresence>
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
                  {micOn ? <Mic size={20} strokeWidth={1.75} /> : <MicOff size={20} strokeWidth={1.75} />}
                </RoundButton>
                <RoundButton
                  active={isSpeaking}
                  label={isSpeaking ? 'Stop reading aloud' : 'Read answer aloud'}
                  onClick={speakAnswer}
                >
                  <Headphones size={20} strokeWidth={1.75} />
                </RoundButton>
                <RoundButton
                  active={paused || liveState === 'paused'}
                  disabled={!liveBusy}
                  label={paused || liveState === 'paused' ? 'Resume session' : 'Pause session'}
                  onClick={togglePause}
                >
                  {paused || liveState === 'paused'
                    ? <CirclePlay size={20} strokeWidth={1.75} />
                    : <CirclePause size={20} strokeWidth={1.75} />}
                </RoundButton>
                <RoundButton
                  active={settingsOpen}
                  tinted
                  label="Session settings"
                  onClick={() => setSettingsOpen(value => !value)}
                >
                  <SlidersHorizontal size={20} strokeWidth={1.75} />
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

              {/* Paste-zone: wraps the strip + composer so Ctrl+V anywhere in this area attaches images */}
              <div className="sp-paste-zone" onPaste={handleComposerPaste}>
              <AnimatePresence>
                {pendingScreenshots.length > 0 ? (
                  <motion.div
                    key="screenshot-preview"
                    className="sp-screenshot-strip"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {pendingScreenshots.map((url, i) => (
                      <div key={i} className="sp-screenshot-thumb">
                        <img src={url} alt={`Screenshot ${i + 1}`} />
                        <button
                          type="button"
                          className="sp-screenshot-remove"
                          aria-label="Remove screenshot"
                          onClick={() => removePendingScreenshot(i)}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <motion.div className="sp-composer" variants={sectionReveal}>
                <button
                  type="button"
                  className="sp-camera-btn"
                  aria-label="Attach screenshot"
                  title="Attach image (or paste with Ctrl+V)"
                  onClick={openFilePicker}
                  data-active={pendingScreenshots.length > 0}
                >
                  <Camera size={17} strokeWidth={2} />
                  {pendingScreenshots.length > 0 ? (
                    <span className="sp-camera-badge">{pendingScreenshots.length}</span>
                  ) : null}
                </button>
                {/* Hidden file input — accepts all common image formats */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  style={{ display: 'none' }}
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={handleFileInputChange}
                />
                <input
                  type="text"
                  value={question}
                  placeholder="Ask a question or paste an image…"
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
                  disabled={!question.trim() && pendingScreenshots.length === 0}
                >
                  <Send size={17} strokeWidth={2} fill="currentColor" />
                </button>
              </motion.div>
              </div>{/* end paste-zone */}

              <motion.div className="sp-chips" variants={sectionReveal}>
                <QuickActions
                  sharedContext={sharedContext}
                  pomodoroRemaining={pomodoroRemaining}
                  formatTime={formatTime}
                  onRunStudyAction={action => void runStudyAction(action)}
                  onOpenStudyMode={mode => void openStudyMode(mode)}
                  onContinueSession={session => void continueDashboardSession(session)}
                  onStopPomodoro={stopPomodoro}
                  onTogglePomodoroPicker={() => setPomodoroPickerOpen(value => !value)}
                />
              </motion.div>

              {activeChat && chatMessages.length > 0 ? (
                <motion.section className="sp-chat-history" variants={sectionReveal} aria-label="Shared chat history">
                  <div className="sp-chat-history-head">
                    <strong>{activeChat.title}</strong>
                    <span>{chatMessages.length} messages</span>
                  </div>
                  <div className="sp-chat-history-list">
                    {chatMessages.slice(-10).map(message => (
                      <article key={message.id} data-role={message.role}>
                        <span>{message.role === 'user' ? 'You' : 'Coach'}</span>
                        <p>{message.text}</p>
                      </article>
                    ))}
                  </div>
                </motion.section>
              ) : null}

              <AnimatePresence>
                {pomodoroPickerOpen && pomodoroRemaining === null ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{
                      display: 'flex',
                      gap: '6px',
                      padding: '6px 14px 10px',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500, width: '100%', textAlign: 'center', marginBottom: '2px' }}>
                      🎯 Pick your focus time
                    </span>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', width: '100%', marginBottom: '8px' }}>
                      {[5, 15, 25, 45, 60].map(mins => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => startPomodoro(mins)}
                          style={{
                            padding: '5px 12px',
                            borderRadius: '8px',
                            border: '1px solid rgba(99,102,241,0.25)',
                            background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
                            color: '#818cf8',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))';
                            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)';
                            e.currentTarget.style.transform = 'scale(1.05)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))';
                            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)';
                            e.currentTarget.style.transform = 'scale(1)';
                          }}
                        >
                          {mins}m
                        </button>
                      ))}
                    </div>

                    {/* Weekly Progress Mini Chart */}
                    <div style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Weekly Progress</span>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '40px' }}>
                        {Array.from({ length: 7 }).map((_, i) => {
                          const d = new Date();
                          d.setDate(d.getDate() - (6 - i));
                          const dateKey = d.toISOString().split('T')[0];
                          const mins = pomodoroStats[dateKey] || 0;
                          const maxMins = Math.max(...Object.values(pomodoroStats), 60);
                          const hPct = Math.max(4, (mins / maxMins) * 100);
                          const isToday = i === 6;
                          return (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                              <div style={{ width: '14px', height: '40px', display: 'flex', alignItems: 'flex-end', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: '100%', height: `${hPct}%`, background: isToday ? 'linear-gradient(to top, #8b5cf6, #3b82f6)' : '#475569', borderRadius: '3px', transition: 'height 0.3s ease' }} title={`${mins} min`} />
                              </div>
                              <span style={{ fontSize: '9px', color: isToday ? '#8b5cf6' : '#64748b', fontWeight: isToday ? 700 : 500 }}>
                                {['S','M','T','W','T','F','S'][d.getDay()]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

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
                      {structuredCard?.type === 'flashcards' ? (
                        <FlashcardViewer items={structuredCard.items} />
                      ) : structuredCard?.type === 'quiz' ? (
                        <QuizViewer items={structuredCard.items} />
                      ) : (
                        <p className="sp-card-body">{renderMarkdown(card.body)}</p>
                      )}
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

            {/* Resize handle — bottom-right corner */}
            <div
              className="sp-resize-handle"
              aria-hidden="true"
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
            />
          </ExtensionPanel>
        ) : null}
      </AnimatePresence>
    </div>

      <AnimatePresence>
        {selectionTooltip && !isOpen ? (
          <motion.div
            className="sp-selection-tooltip"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: selectionTooltip.placeBelow ? -8 : 8, scale: 0.93 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: selectionTooltip.placeBelow ? -4 : 4, scale: 0.95 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed',
              top: selectionTooltip.top,
              left: selectionTooltip.left,
              zIndex: 2147483647,
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '5px 6px',
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
              borderRadius: '10px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {/* Caret arrow pointing down or up */}
            <span style={{
              position: 'absolute',
              ...(selectionTooltip.placeBelow
                ? { top: -6, borderBottom: '6px solid #16213e', borderTop: 'none' }
                : { bottom: -6, borderTop: '6px solid #16213e', borderBottom: 'none' }),
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))',
            }} />
            {[
              {
                label: 'Explain',
                icon: <Lightbulb size={13} strokeWidth={2} />,
                color: '#f59e0b',
                action: () => {
                  const selText = selectionTooltip.text;
                  setIsOpen(true);
                  setSelectionTooltip(null);
                  void runStudyAction('explain', `Explain this: "${selText}"`);
                }
              },
              {
                label: 'Flashcard',
                icon: <Layers size={13} strokeWidth={2} />,
                color: '#8b5cf6',
                action: () => {
                  const selText = selectionTooltip.text;
                  setIsOpen(true);
                  setSelectionTooltip(null);
                  void openStudyMode('flashcards', selText);
                }
              },
              {
                label: 'Quiz Me',
                icon: <HelpCircle size={13} strokeWidth={2} />,
                color: '#10b981',
                action: () => {
                  const selText = selectionTooltip.text;
                  setIsOpen(true);
                  setSelectionTooltip(null);
                  void openStudyMode('quiz', selText);
                }
              },
            ].map(({ label, icon, color, action }) => (
              <button
                key={label}
                type="button"
                onClick={action}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 9px',
                  borderRadius: '7px',
                  border: 'none',
                  background: 'transparent',
                  color: '#e2e8f0',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.01em',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span style={{ color }}>{icon}</span>
                {label}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
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

// ─── Markdown renderer ────────────────────────────────────────────────────────
// Converts **bold**, *italic*, and \n line breaks into React nodes.
// No external dependency — keeps the bundle small.

function renderMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) nodes.push(<br key={`br${lineIdx}`} />);

    // Match **bold** before *italic* so double-asterisk wins
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let cursor = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(line)) !== null) {
      if (m.index > cursor) nodes.push(line.slice(cursor, m.index));

      if (m[0].startsWith('**')) {
        nodes.push(<strong key={`b${lineIdx}-${m.index}`}>{m[2]}</strong>);
      } else {
        nodes.push(<em key={`i${lineIdx}-${m.index}`}>{m[3]}</em>);
      }
      cursor = m.index + m[0].length;
    }

    if (cursor < line.length) nodes.push(line.slice(cursor));
  });

  return nodes;
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
          Sign in once to connect the extension and dashboard. Open the StudyPilot web app and this panel will connect automatically.
        </p>
        <button type="button" className="sp-login-btn" onClick={onOpenDashboard}>
          Open web app
        </button>
      </div>
    </div>
  );
}
