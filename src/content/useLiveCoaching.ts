import { useEffect, useRef, useState } from 'react';
import {
  sessionPrivacyFromContext,
  type ContextShareSettings,
  type LiveSessionStatus,
  type LiveUiState,
} from '@/shared/types';
import type { StudyPilotRuntimeMessage } from '@/shared/extensionMessages';
import {
  acceptsLiveStatusOperation,
  canToggleLivePause,
  controlsFromLiveStatus,
  isLiveBusyState,
  liveMicIntent,
} from './liveCoachingState';

type RuntimeMessageSender = <T>(message: StudyPilotRuntimeMessage) => Promise<T | null>;
type Notice = (message: string, duration?: number) => void;
type VoiceQuestion = (question: string) => void;

interface SpeechRecognitionResultLike {
  0?: { transcript?: string };
}

interface SpeechRecognitionResultsLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionResultEventLike {
  results: SpeechRecognitionResultsLike;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export function isCurrentLiveOperation({
  mounted,
  operationSequence,
  latestSequence,
}: {
  mounted: boolean;
  operationSequence: number;
  latestSequence: number;
}): boolean {
  return mounted && operationSequence === latestSequence;
}

export interface UseLiveCoachingOptions {
  getActiveChatId: () => string | null;
  context: ContextShareSettings;
  flashNotice: Notice;
  onVoiceQuestion: VoiceQuestion;
  sendRuntimeMessage: RuntimeMessageSender;
}

export interface LiveCoachingController {
  liveState: LiveUiState;
  liveFrozen: boolean;
  liveFallback: 'text-coaching' | null;
  micOn: boolean;
  paused: boolean;
  liveBusy: boolean;
  applyLiveStatus: (status: LiveSessionStatus) => void;
  toggleMic: () => void;
  togglePause: () => void;
}

export function useLiveCoaching({
  getActiveChatId,
  context,
  flashNotice,
  onVoiceQuestion,
  sendRuntimeMessage,
}: UseLiveCoachingOptions): LiveCoachingController {
  const [micOn, setMicOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [liveState, setLiveState] = useState<LiveUiState>('idle');
  const [liveFrozen, setLiveFrozen] = useState(false);
  const [liveFallback, setLiveFallback] = useState<'text-coaching' | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveOperationSequenceRef = useRef(0);
  const latestRemoteOperationIdRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const liveBusy = isLiveBusyState(liveState);

  function applyLiveStatus(status: LiveSessionStatus) {
    if (!mountedRef.current) return;
    if (!acceptsLiveStatusOperation(status.operationId, latestRemoteOperationIdRef.current)) {
      return;
    }
    if (status.operationId !== undefined) {
      latestRemoteOperationIdRef.current = status.operationId;
    }
    const controls = controlsFromLiveStatus(status);
    setLiveState(status.state);
    setLiveFrozen(controls.liveFrozen);
    setLiveFallback(controls.liveFallback);
    setMicOn(controls.micOn);
    setPaused(controls.paused);
    if (status.warning) flashNotice(status.warning, 3600);
    if (status.error && status.state === 'error') flashNotice(status.error, 4200);
  }

  // Rehydrate the panel from the service worker when it mounts. Live owns the
  // microphone/WebSocket lifecycle outside the content script, so closing or
  // reloading the panel must not make an in-flight operation disappear from
  // the UI. The mounted guard also prevents a late response from updating a
  // panel that has already been unmounted.
  useEffect(() => {
    let active = true;
    void sendRuntimeMessage<LiveSessionStatus>({
      type: 'STUDYPILOT_GET_LIVE_STATUS',
    })
      .then(response => {
        if (active && response) applyLiveStatus(response);
      })
      .catch(() => {
        // A service-worker restart or a page without extension runtime is
        // recoverable; the panel remains in its local idle state.
      });

    return () => {
      active = false;
    };
  }, [sendRuntimeMessage]);

  function stopSpeechRecognition() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Recognition may already have ended.
      }
    }
  }

  function startSpeechRecognition(operationSequence: number) {
    const isCurrentRecognition = () => isCurrentLiveOperation({
      mounted: mountedRef.current,
      operationSequence,
      latestSequence: liveOperationSequenceRef.current,
    });

    if (!isCurrentRecognition()) return;
    if (recognitionRef.current) {
      stopSpeechRecognition();
      if (mountedRef.current) setMicOn(false);
      return;
    }

    const SpeechRecognition =
      (window as SpeechRecognitionWindow).SpeechRecognition
      ?? (window as SpeechRecognitionWindow).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      flashNotice('Voice input is not supported in this browser.', 3000);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      if (!isCurrentRecognition()) return;
      setMicOn(true);
      setPaused(false);
      flashNotice('Listening…', 8000);
    };

    recognition.onresult = (event: SpeechRecognitionResultEventLike) => {
      if (!isCurrentRecognition()) return;
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (transcript) {
        setMicOn(false);
        flashNotice(`"${transcript.slice(0, 40)}${transcript.length > 40 ? '…' : ''}"`, 2000);
        onVoiceQuestion(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (!isCurrentRecognition()) return;
      setMicOn(false);
      if (event.error === 'not-allowed') {
        flashNotice('Microphone access denied. Allow it in Chrome settings.', 4000);
      } else if (event.error !== 'no-speech') {
        flashNotice('Voice input failed. Try again.', 3000);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (isCurrentRecognition()) setMicOn(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      if (!isCurrentRecognition()) return;
      flashNotice('Could not start voice input. Try again.', 3000);
      setMicOn(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    }
  }

  async function startLiveSession() {
    const operationSequence = ++liveOperationSequenceRef.current;
    const activeChatId = getActiveChatId();
    if (!activeChatId) {
      startSpeechRecognition(operationSequence);
      return;
    }
    try {
      if (!mountedRef.current) return;
      setLiveState('starting');
      setMicOn(true);
      setPaused(false);
      setLiveFallback(null);
      const response = await sendRuntimeMessage<LiveSessionStatus>({
        type: 'STUDYPILOT_LIVE_START',
        payload: {
          chatId: activeChatId,
          privacy: sessionPrivacyFromContext(context),
        },
      });
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      if (response) applyLiveStatus(response);
      else {
        setLiveState('error');
        setMicOn(false);
        setLiveFallback('text-coaching');
        flashNotice('Live coach unavailable — use text coaching', 4200);
        startSpeechRecognition(operationSequence);
      }
    } catch (error) {
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      setLiveState('error');
      setMicOn(false);
      setLiveFallback('text-coaching');
      const message = error instanceof Error ? error.message : 'Live coach unavailable';
      flashNotice(
        message.includes('connected')
          ? 'Connect dashboard first'
          : `${message} — use text coaching instead`,
        4200,
      );
      startSpeechRecognition(operationSequence);
    }
  }

  async function stopLiveSession() {
    const operationSequence = ++liveOperationSequenceRef.current;
    if (!mountedRef.current) return;
    setLiveState('stopping');
    stopSpeechRecognition();
    try {
      const response = await sendRuntimeMessage<LiveSessionStatus>({
        type: 'STUDYPILOT_LIVE_STOP',
      });
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      if (response) applyLiveStatus(response);
      else {
        setMicOn(false);
        setPaused(false);
        setLiveState('idle');
        setLiveFrozen(false);
      }
    } catch (error) {
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      setLiveState('error');
      setMicOn(false);
      setPaused(false);
      setLiveFrozen(false);
      flashNotice(error instanceof Error ? error.message : 'Could not stop Live', 3200);
    }
  }

  async function pauseLiveSession() {
    const operationSequence = ++liveOperationSequenceRef.current;
    try {
      const response = await sendRuntimeMessage<LiveSessionStatus>({
        type: 'STUDYPILOT_LIVE_PAUSE',
      });
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      if (response) applyLiveStatus(response);
      else setPaused(true);
    } catch {
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      flashNotice('Could not pause Live', 2600);
    }
  }

  async function resumeLiveSession() {
    const operationSequence = ++liveOperationSequenceRef.current;
    try {
      const response = await sendRuntimeMessage<LiveSessionStatus>({
        type: 'STUDYPILOT_LIVE_RESUME',
      });
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      if (response) applyLiveStatus(response);
      else {
        setPaused(false);
        setMicOn(true);
      }
    } catch {
      if (!isCurrentLiveOperation({
        mounted: mountedRef.current,
        operationSequence,
        latestSequence: liveOperationSequenceRef.current,
      })) return;
      flashNotice('Could not resume Live', 2600);
    }
  }

  function toggleMic() {
    if (!mountedRef.current) return;
    switch (liveMicIntent(liveState, recognitionRef.current !== null)) {
      case 'ignore':
        return;
      case 'stop-speech':
        liveOperationSequenceRef.current += 1;
        stopSpeechRecognition();
        setMicOn(false);
        return;
      case 'stop-live':
        void stopLiveSession();
        return;
      case 'resume':
        void resumeLiveSession();
        return;
      case 'start':
        void startLiveSession();
        return;
    }
  }

  function togglePause() {
    if (!mountedRef.current) return;
    if (!canToggleLivePause(liveState)) return;
    if (liveState === 'paused') {
      void resumeLiveSession();
      return;
    }
    void pauseLiveSession();
  }

  useEffect(() => () => {
    mountedRef.current = false;
    liveOperationSequenceRef.current += 1;
    stopSpeechRecognition();
  }, []);

  return {
    liveState,
    liveFrozen,
    liveFallback,
    micOn,
    paused,
    liveBusy,
    applyLiveStatus,
    toggleMic,
    togglePause,
  };
}
