import { motion, type Variants } from 'framer-motion';
import { CirclePause, CirclePlay, Headphones, Mic, MicOff, SlidersHorizontal } from 'lucide-react';
import type { LiveUiState } from '@/shared/types';
import { RoundButton } from './PanelComponents';
import { livePauseControl } from './liveCoachingState';

export interface VoiceDockProps {
  micOn: boolean;
  isSpeaking: boolean;
  liveState: LiveUiState;
  liveBusy: boolean;
  settingsOpen: boolean;
  variants: Variants;
  onToggleMic: () => void;
  onSpeak: () => void;
  onTogglePause: () => void;
  onToggleSettings: () => void;
}

export function VoiceDock({
  micOn,
  isSpeaking,
  liveState,
  liveBusy,
  settingsOpen,
  variants,
  onToggleMic,
  onSpeak,
  onTogglePause,
  onToggleSettings,
}: VoiceDockProps) {
  const pauseControl = livePauseControl(liveState, liveBusy);

  return (
    <motion.div className="sp-voice-dock" variants={variants}>
      <RoundButton
        active={micOn && !pauseControl.paused}
        disabled={liveState === 'stopping'}
        label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        onClick={onToggleMic}
      >
        {micOn ? <Mic size={20} strokeWidth={1.75} /> : <MicOff size={20} strokeWidth={1.75} />}
      </RoundButton>
      <RoundButton
        active={isSpeaking}
        label={isSpeaking ? 'Stop reading aloud' : 'Read answer aloud'}
        onClick={onSpeak}
      >
        <Headphones size={20} strokeWidth={1.75} />
      </RoundButton>
      <RoundButton
        active={pauseControl.paused}
        disabled={!pauseControl.enabled}
        label={pauseControl.label}
        onClick={onTogglePause}
      >
        {pauseControl.paused ? (
          <CirclePlay size={20} strokeWidth={1.75} />
        ) : (
          <CirclePause size={20} strokeWidth={1.75} />
        )}
      </RoundButton>
      <RoundButton active={settingsOpen} tinted label="Session settings" onClick={onToggleSettings}>
        <SlidersHorizontal size={20} strokeWidth={1.75} />
      </RoundButton>
    </motion.div>
  );
}
