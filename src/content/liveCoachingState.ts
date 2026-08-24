import type { LiveSessionStatus, LiveUiState } from '@/shared/types';

export interface LiveControls {
  liveFrozen: boolean;
  liveFallback: 'text-coaching' | null;
  micOn: boolean;
  paused: boolean;
}

export type LiveMicIntent = 'start' | 'stop-live' | 'stop-speech' | 'resume' | 'ignore';

export function isLiveBusyState(state: LiveUiState): boolean {
  return state === 'starting'
    || state === 'connecting'
    || state === 'live'
    || state === 'paused';
}

export function liveMicIntent(
  state: LiveUiState,
  recognitionActive: boolean,
): LiveMicIntent {
  if (state === 'stopping') return 'ignore';
  if (recognitionActive) return 'stop-speech';
  if (isLiveBusyState(state) && state !== 'paused') return 'stop-live';
  if (state === 'paused') return 'resume';
  return 'start';
}

export function acceptsLiveStatusOperation(
  operationId: number | undefined,
  latestOperationId: number | undefined,
): boolean {
  return operationId === undefined
    || latestOperationId === undefined
    || operationId >= latestOperationId;
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
