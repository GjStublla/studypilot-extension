/**
 * useVoiceSession — bidirectional live voice hook for Vertex AI / Gemini Live API.
 *
 * Flow:
 *  1. Call `start()` → fetches a live-token via the background service worker.
 *  2. Opens a WebSocket to the returned `webSocketUrl`.
 *  3. Streams mic audio via the Web Audio API (PCM 16-bit LE, 16 kHz mono).
 *  4. Receives model audio chunks and plays them back through an AudioContext.
 *  5. Exposes `transcript` lines (interim + final) built from server turn events.
 *  6. `stop()` cleanly tears everything down.
 *
 * The Vertex AI Multimodal Live WebSocket protocol uses JSON framing:
 *   Client → server:  { setup }, { realtimeInput: { mediaChunks: [...] } }, { clientContent }
 *   Server → client:  { setupComplete }, { serverContent }, { toolCall }, { goAway }
 *
 * Refs:
 *   https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveTokenResult, StudyTranscriptTurn } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type VoiceSessionStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error'
  | 'ended';

export interface VoiceSessionState {
  status: VoiceSessionStatus;
  /** Accumulated conversation turns from this live session */
  transcript: StudyTranscriptTurn[];
  /** Most recent partial (streaming) text from the model */
  partialModelText: string;
  /** Error message when status === 'error' */
  errorMessage: string | null;
  /** Volume level 0–1 detected from the mic (for animation) */
  micLevel: number;
  /** Volume level 0–1 of model audio output (for animation) */
  speakerLevel: number;
}

export interface VoiceSessionControls {
  start: (tokenResult: LiveTokenResult, systemContext?: string) => Promise<void>;
  stop: () => void;
  mute: () => void;
  unmute: () => void;
  isMuted: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16_000;          // Hz — Vertex AI Live requires 16 kHz input
const OUTPUT_SAMPLE_RATE = 24_000;   // Hz — Vertex AI Live outputs 24 kHz PCM
// ScriptProcessorNode buffer must be a power of 2 (256–16384).
// 2048 samples @ 16kHz = 128ms per chunk — close enough to 100ms.
const CHUNK_SAMPLES = 2048;
const MAX_RECONNECT_ATTEMPTS = 2;

// ─── Helper: PCM float32 → int16 base64 ──────────────────────────────────────

function float32ToBase64Pcm16(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── Helper: base64 PCM16 → Float32 ──────────────────────────────────────────

function base64Pcm16ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

// ─── Helper: compute RMS level 0–1 ───────────────────────────────────────────

function rmsLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 8);
}

// ─── Main hook ───────────────────────────────────────────────────────────────

export function useVoiceSession(): VoiceSessionState & VoiceSessionControls {
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [transcript, setTranscript] = useState<StudyTranscriptTurn[]>([]);
  const [partialModelText, setPartialModelText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [speakerLevel, setSpeakerLevel] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Refs hold mutable resources that must not trigger re-renders
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const sessionStartedAtRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const isMutedRef = useRef(false);
  const tokenResultRef = useRef<LiveTokenResult | null>(null);
  const systemContextRef = useRef<string>('');
  const pendingModelTextRef = useRef('');
  const modelTurnStartRef = useRef(0);
  const stoppedRef = useRef(false);

  // ── Audio playback ──────────────────────────────────────────────────────────

  const drainPlaybackQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx || playbackQueueRef.current.length === 0) return;

    isPlayingRef.current = true;

    const chunk = playbackQueueRef.current.shift()!;
    setSpeakerLevel(rmsLevel(chunk));

    const buffer = ctx.createBuffer(1, chunk.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(chunk);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      isPlayingRef.current = false;
      if (playbackQueueRef.current.length === 0) {
        setSpeakerLevel(0);
        if (!stoppedRef.current) setStatus('listening');
      } else {
        drainPlaybackQueue();
      }
    };
    source.start();
  }, []);

  const enqueueAudio = useCallback(
    (b64: string) => {
      const chunk = base64Pcm16ToFloat32(b64);
      playbackQueueRef.current.push(chunk);
      drainPlaybackQueue();
    },
    [drainPlaybackQueue],
  );

  // ── WebSocket handling ──────────────────────────────────────────────────────

  const handleServerMessage = useCallback(
    (raw: string) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (!msg || typeof msg !== 'object') return;
      const data = msg as Record<string, unknown>;

      // Setup confirmation
      if ('setupComplete' in data) {
        setStatus('listening');
        reconnectAttemptsRef.current = 0;
        return;
      }

      // Server content (model turn)
      if ('serverContent' in data) {
        const sc = data.serverContent as Record<string, unknown>;

        // Audio delta
        if (sc.modelTurn && typeof sc.modelTurn === 'object') {
          const turn = sc.modelTurn as Record<string, unknown>;
          const parts = Array.isArray(turn.parts) ? turn.parts : [];

          for (const part of parts) {
            if (!part || typeof part !== 'object') continue;
            const p = part as Record<string, unknown>;

            // Audio
            if (p.inlineData && typeof p.inlineData === 'object') {
              const id = p.inlineData as Record<string, unknown>;
              if (typeof id.data === 'string') {
                setStatus('speaking');
                enqueueAudio(id.data);
              }
            }

            // Text (transcript from model)
            if (typeof p.text === 'string' && p.text) {
              pendingModelTextRef.current += p.text;
              setPartialModelText(pendingModelTextRef.current);
            }
          }
        }

        // Turn complete — flush pending model text to transcript
        if (sc.turnComplete === true) {
          const text = pendingModelTextRef.current.trim();
          if (text) {
            const turn: StudyTranscriptTurn = {
              role: 'ai',
              text,
              atSeconds: Math.max(
                0,
                Math.round((Date.now() - sessionStartedAtRef.current) / 1000),
              ),
            };
            setTranscript(prev => [...prev, turn]);
          }
          pendingModelTextRef.current = '';
          setPartialModelText('');
          modelTurnStartRef.current = Date.now();
        }

        // Interrupted — discard pending audio
        if (sc.interrupted === true) {
          playbackQueueRef.current = [];
          isPlayingRef.current = false;
          pendingModelTextRef.current = '';
          setPartialModelText('');
          setSpeakerLevel(0);
          if (!stoppedRef.current) setStatus('listening');
        }

        return;
      }

      // Input transcription (user speech → text)
      if ('inputTranscription' in data) {
        const it = data.inputTranscription as Record<string, unknown>;
        if (typeof it.text === 'string' && it.text.trim()) {
          const turn: StudyTranscriptTurn = {
            role: 'user',
            text: it.text.trim(),
            atSeconds: Math.max(
              0,
              Math.round((Date.now() - sessionStartedAtRef.current) / 1000),
            ),
          };
          setTranscript(prev => [...prev, turn]);
        }
        return;
      }

      // Server signals it is about to disconnect
      if ('goAway' in data) {
        if (!stoppedRef.current) {
          setStatus('ended');
        }
      }
    },
    [enqueueAudio],
  );

  // ── Mic capture ─────────────────────────────────────────────────────────────

  const startMicCapture = useCallback(
    (ws: WebSocket, ctx: AudioContext) => {
      navigator.mediaDevices
        .getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true } })
        .then(stream => {
          micStreamRef.current = stream;

          const source = ctx.createMediaStreamSource(stream);
          sourceRef.current = source;

          // ScriptProcessorNode is deprecated but universally available in
          // extension content scripts where AudioWorklet is more restricted.
          const processor = ctx.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e: AudioProcessingEvent) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (isMutedRef.current) return;

            const input = e.inputBuffer.getChannelData(0);

            // Resample from ctx.sampleRate → 16 kHz if needed
            const samples = ctx.sampleRate !== SAMPLE_RATE
              ? resampleFloat32(input, ctx.sampleRate, SAMPLE_RATE)
              : input.slice(0);

            setMicLevel(rmsLevel(samples));

            const b64 = float32ToBase64Pcm16(samples);
            ws.send(
              JSON.stringify({
                realtimeInput: {
                  mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }],
                },
              }),
            );
          };

          source.connect(processor);
          processor.connect(ctx.destination);
        })
        .catch(err => {
          if (!stoppedRef.current) {
            setStatus('error');
            setErrorMessage(
              err instanceof Error && err.name === 'NotAllowedError'
                ? 'Microphone permission denied. Allow mic access and try again.'
                : `Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        });
    },
    [],
  );

  // ── Connect to Vertex AI Live WebSocket ─────────────────────────────────────

  const connectWebSocket = useCallback(
    (tokenResult: LiveTokenResult, systemContext: string) => {
      if (!tokenResult.webSocketUrl) {
        setStatus('error');
        setErrorMessage('No WebSocket URL returned from live-token endpoint.');
        return;
      }

      const ws = new WebSocket(tokenResult.webSocketUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Setup frame for Vertex AI Live API.
        // gemini-live-2.5-flash-native-audio uses native audio output —
        // it does NOT support speechConfig/voiceConfig (TTS voices).
        // responseModalities must be ['AUDIO'] only for this model.
        const setup = {
          setup: {
            model: tokenResult.model,
            generationConfig: {
              responseModalities: ['AUDIO'],
            },
            systemInstruction: {
              parts: [
                {
                  text: [
                    'You are Study Pilot, a friendly, concise, Socratic study coach.',
                    'Coach the student with explanations, guiding questions, and study strategies.',
                    'Keep responses under 3 sentences unless asked for more detail.',
                    'Academic-integrity rule: never write submission-ready assignment content for the student.',
                    systemContext ? `\nCurrent page context:\n${systemContext}` : '',
                  ]
                    .filter(Boolean)
                    .join(' '),
                },
              ],
            },
          },
        };
        ws.send(JSON.stringify(setup));

        // Start mic capture after setup is sent
        if (audioCtxRef.current) {
          startMicCapture(ws, audioCtxRef.current);
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        handleServerMessage(typeof event.data === 'string' ? event.data : '');
      };

      ws.onerror = () => {
        if (!stoppedRef.current) {
          const attempts = reconnectAttemptsRef.current;
          if (attempts < MAX_RECONNECT_ATTEMPTS && tokenResultRef.current) {
            reconnectAttemptsRef.current += 1;
            teardownAudio();
            setTimeout(() => {
              if (!stoppedRef.current && tokenResultRef.current) {
                connectWebSocket(tokenResultRef.current, systemContextRef.current);
              }
            }, 1000 * reconnectAttemptsRef.current);
          } else {
            setStatus('error');
            setErrorMessage('Live voice connection lost. Please try again.');
          }
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (!stoppedRef.current && event.code !== 1000) {
          setStatus('error');
          setErrorMessage(`Voice session closed unexpectedly (${event.code}).`);
        }
      };
    },
    [handleServerMessage, startMicCapture],
  );

  // ── Audio context & mic teardown ─────────────────────────────────────────────

  const teardownAudio = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    processorRef.current = null;
    sourceRef.current = null;

    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;

    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    setMicLevel(0);
    setSpeakerLevel(0);
  }, []);

  // ── Public controls ──────────────────────────────────────────────────────────

  const start = useCallback(
    async (tokenResult: LiveTokenResult, systemContext = '') => {
      if (tokenResult.status !== 'ready') {
        setStatus('error');
        setErrorMessage(tokenResult.message);
        return;
      }

      stoppedRef.current = false;
      tokenResultRef.current = tokenResult;
      systemContextRef.current = systemContext;
      reconnectAttemptsRef.current = 0;
      sessionStartedAtRef.current = Date.now();
      pendingModelTextRef.current = '';
      playbackQueueRef.current = [];
      isPlayingRef.current = false;

      setStatus('connecting');
      setTranscript([]);
      setPartialModelText('');
      setErrorMessage(null);

      // Create AudioContext
      const ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => undefined);
      }

      connectWebSocket(tokenResult, systemContext);
    },
    [connectWebSocket],
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    teardownAudio();

    if (wsRef.current) {
      try { wsRef.current.close(1000, 'Session ended by user'); } catch { /* ignore */ }
      wsRef.current = null;
    }

    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;

    setStatus('idle');
    setMicLevel(0);
    setSpeakerLevel(0);
  }, [teardownAudio]);

  const mute = useCallback(() => {
    isMutedRef.current = true;
    setIsMuted(true);
    setMicLevel(0);
  }, []);

  const unmute = useCallback(() => {
    isMutedRef.current = false;
    setIsMuted(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      teardownAudio();
      wsRef.current?.close(1000, 'Component unmounted');
      audioCtxRef.current?.close().catch(() => undefined);
    };
  }, [teardownAudio]);

  return {
    status,
    transcript,
    partialModelText,
    errorMessage,
    micLevel,
    speakerLevel,
    start,
    stop,
    mute,
    unmute,
    isMuted,
  };
}

// ─── Resampler ────────────────────────────────────────────────────────────────

function resampleFloat32(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.round(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    output[i] = a + frac * (b - a);
  }
  return output;
}
