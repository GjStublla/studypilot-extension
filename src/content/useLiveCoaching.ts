import { useEffect, useRef, useState } from 'react';
import {
  sessionPrivacyFromContext,
  type ContextShareSettings,
  type LiveSessionStatus,
  type LiveUiState,
} from '@/shared/types';
import type { StudyPilotRuntimeMessage } from '@/shared/extensionMessages';
import { controlsFromLiveStatus, isLiveBusyState } from './liveCoachingState';

type RuntimeMessageSender = <T>(message: StudyPilotRuntimeMessage) => Promise<T | null>;
type Notice = (message: string, duration?: number) => void;
type VoiceQuestion = (question: string) => void;

export interface UseLiveCoachingOptions {
  activeChatId: string | null;
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
  activeChatId,
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
  const recognitionRef = useRef<any>(null);
  const liveBusy = isLiveBusyState(liveState);

  function applyLiveStatus(status: LiveSessionStatus) {
    const controls = controlsFromLiveStatus(status);
    setLiveState(status.state);
    setLiveFrozen(controls.liveFrozen);
    setLiveFallback(controls.liveFallback);
    setMicOn(controls.micOn);
    setPaused(controls.paused);
    if (status.warning) flashNotice(status.warning, 3600);
    if (status.error && status.state === 'error') flashNotice(status.error, 4200);
  }

  function startSpeechRecognition() {
    if (micOn) {
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
    recognition.continuous = false;
    recognition.interimResults = false;
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
        onVoiceQuestion(transcript);
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

    recognition.onend = () => setMicOn(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      flashNotice('Could not start voice input. Try again.', 3000);
      setMicOn(false);
    }
  }

  async function startLiveSession() {
    if (!activeChatId) {
      startSpeechRecognition();
      return;
    }
    try {
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
      if (response) applyLiveStatus(response);
      else {
        setMicOn(false);
        flashNotice('Open the extension build for live coach');
      }
    } catch (error) {
      setMicOn(false);
      setLiveFallback('text-coaching');
      const message = error instanceof Error ? error.message : 'Live coach unavailable';
      flashNotice(
        message.includes('connected')
          ? 'Connect dashboard first'
          : `${message} — use text coaching instead`,
        4200,
      );
      startSpeechRecognition();
    }
  }

  async function stopLiveSession() {
    try {
      const response = await sendRuntimeMessage<LiveSessionStatus>({
        type: 'STUDYPILOT_LIVE_STOP',
      });
      if (response) applyLiveStatus(response);
      else {
        setMicOn(false);
        setPaused(false);
        setLiveState('idle');
        setLiveFrozen(false);
      }
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : 'Could not stop Live', 3200);
    }
  }

  async function pauseLiveSession() {
    try {
      const response = await sendRuntimeMessage<LiveSessionStatus>({
        type: 'STUDYPILOT_LIVE_PAUSE',
      });
      if (response) applyLiveStatus(response);
      else setPaused(true);
    } catch {
      flashNotice('Could not pause Live', 2600);
    }
  }

  async function resumeLiveSession() {
    try {
      const response = await sendRuntimeMessage<LiveSessionStatus>({
        type: 'STUDYPILOT_LIVE_RESUME',
      });
      if (response) applyLiveStatus(response);
      else {
        setPaused(false);
        setMicOn(true);
      }
    } catch {
      flashNotice('Could not resume Live', 2600);
    }
  }

  function toggleMic() {
    if (liveBusy && liveState !== 'paused') {
      void stopLiveSession();
      return;
    }
    if (liveState === 'paused') {
      void resumeLiveSession();
      return;
    }
    void startLiveSession();
  }

  function togglePause() {
    if (liveState === 'paused') {
      void resumeLiveSession();
      return;
    }
    if (liveBusy) {
      void pauseLiveSession();
      return;
    }
    setPaused(value => !value);
  }

  useEffect(() => () => {
    recognitionRef.current?.stop();
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
