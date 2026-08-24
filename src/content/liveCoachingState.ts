import type { LiveSessionStatus, LiveUiState } from '@/shared/types';

export interface LiveControls {
  liveFrozen: boolean;
  liveFallback: 'text-coaching' | null;
  micOn: boolean;
  paused: boolean;
}

export function isLiveBusyState(state: LiveUiState): boolean {
  return state === 'starting'
    || state === 'connecting'
    || state === 'live'
    || state === 'paused';
}

export function controlsFromLiveStatus(status: LiveSessionStatus): LiveControls {
  const active = status.state === 'live'
    || status.state === 'connecting'
    || status.state === 'starting'
    || status.state === 'paused';

  return {
    liveFrozen: status.selectionFrozen,
    liveFallback: status.fallback ?? null,
    micOn: active && status.state !== 'paused',
    paused: status.state === 'paused',
  };
}
