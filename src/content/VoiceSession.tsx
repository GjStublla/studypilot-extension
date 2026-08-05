/**
 * VoiceSession — inline live-voice overlay panel rendered inside FloatingStudyPilot.
 *
 * Shown when the user taps the mic button and a live-token with status 'ready'
 * is obtained from the Supabase edge function.  Provides:
 *  • Animated mic/speaker level bars
 *  • Rolling transcript
 *  • Streaming model text while AI is speaking
 *  • Mute / stop controls
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { VoiceSessionStatus } from '@/shared/useVoiceSession';
import type { StudyTranscriptTurn } from '@/shared/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VoiceSessionProps {
  status: VoiceSessionStatus;
  transcript: StudyTranscriptTurn[];
  partialModelText: string;
  errorMessage: string | null;
  micLevel: number;       // 0–1
  speakerLevel: number;   // 0–1
  isMuted: boolean;
  onMuteToggle: () => void;
  onStop: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VoiceSession({
  status,
  transcript,
  partialModelText,
  errorMessage,
  micLevel,
  speakerLevel,
  isMuted,
  onMuteToggle,
  onStop,
}: VoiceSessionProps) {
  const isActive = status === 'listening' || status === 'speaking' || status === 'connecting';

  return (
    <AnimatePresence>
      {isActive || status === 'error' ? (
        <motion.div
          key="voice-session"
          className="sp-voice-session"
          data-status={status}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          role="region"
          aria-label="Live voice session"
          aria-live="polite"
        >
          {/* Status bar */}
          <div className="sp-vs-status-bar">
            <StatusDot status={status} />
            <span className="sp-vs-status-text">{statusLabel(status, isMuted)}</span>
            {(status === 'listening' || status === 'speaking') && (
              <LevelMeter level={status === 'speaking' ? speakerLevel : micLevel} />
            )}
          </div>

          {/* Error message */}
          {status === 'error' && errorMessage && (
            <p className="sp-vs-error">{errorMessage}</p>
          )}

          {/* Connecting spinner */}
          {status === 'connecting' && (
            <div className="sp-vs-connecting">
              <span className="sp-vs-spinner" aria-hidden="true" />
              <span>Connecting to live AI coach…</span>
            </div>
          )}

          {/* Transcript scroll area */}
          {transcript.length > 0 || partialModelText ? (
            <div className="sp-vs-transcript" aria-label="Voice conversation transcript">
              {transcript.map((turn, i) => (
                <TranscriptBubble key={i} turn={turn} />
              ))}
              {partialModelText && (
                <TranscriptBubble
                  turn={{ role: 'ai', text: partialModelText, atSeconds: 0 }}
                  partial
                />
              )}
            </div>
          ) : null}

          {/* Controls */}
          {status !== 'error' && (
            <div className="sp-vs-controls">
              <VoiceControlButton
                active={!isMuted}
                label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                onClick={onMuteToggle}
                danger={false}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </VoiceControlButton>

              <div className="sp-vs-speaker-indicator" aria-hidden="true">
                <Volume2 size={18} data-active={status === 'speaking'} />
                <LevelMeter level={speakerLevel} vertical />
              </div>

              <VoiceControlButton
                active={false}
                label="End voice session"
                onClick={onStop}
                danger
              >
                <PhoneOff size={20} />
              </VoiceControlButton>
            </div>
          )}

          {status === 'error' && (
            <button
              type="button"
              className="sp-vs-retry-btn"
              onClick={onStop}
            >
              Close
            </button>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: VoiceSessionStatus }) {
  return (
    <span
      className="sp-vs-dot"
      data-status={status}
      aria-hidden="true"
    />
  );
}

function LevelMeter({
  level,
  vertical = false,
}: {
  level: number;
  vertical?: boolean;
}) {
  const bars = 6;
  return (
    <span
      className={`sp-vs-level ${vertical ? 'sp-vs-level--v' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, i) => {
        const threshold = (i + 1) / bars;
        return (
          <span
            key={i}
            className="sp-vs-level-bar"
            data-active={level >= threshold}
          />
        );
      })}
    </span>
  );
}

function TranscriptBubble({
  turn,
  partial = false,
}: {
  turn: StudyTranscriptTurn;
  partial?: boolean;
}) {
  return (
    <motion.div
      className="sp-vs-bubble"
      data-role={turn.role}
      data-partial={partial}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <span className="sp-vs-bubble-label">
        {turn.role === 'user' ? 'You' : 'Study Pilot'}
      </span>
      <p className="sp-vs-bubble-text">{turn.text}</p>
      {partial && <span className="sp-vs-cursor" aria-hidden="true" />}
    </motion.div>
  );
}

function VoiceControlButton({
  active,
  label,
  danger,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  danger: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sp-vs-ctrl"
      data-active={active}
      data-danger={danger}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(status: VoiceSessionStatus, isMuted: boolean): string {
  switch (status) {
    case 'connecting': return 'Connecting…';
    case 'listening':  return isMuted ? 'Microphone muted' : 'Listening…';
    case 'speaking':   return 'Study Pilot is speaking…';
    case 'error':      return 'Connection error';
    case 'ended':      return 'Session ended';
    default:           return '';
  }
}
