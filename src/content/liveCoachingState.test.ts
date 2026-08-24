import { describe, expect, it } from 'vitest';
import type { LiveSessionStatus } from '@/shared/types';
import {
  acceptsLiveStatusOperation,
  controlsFromLiveStatus,
  isLiveBusyState,
  liveMicIntent,
} from './liveCoachingState';
import { isCurrentLiveOperation } from './useLiveCoaching';

const status = (
  state: LiveSessionStatus['state'],
  overrides: Partial<LiveSessionStatus> = {},
): LiveSessionStatus => ({
  state,
  selectionFrozen: false,
  ...overrides,
});

describe('live coaching state derivation', () => {
  it('keeps only active live states busy', () => {
    expect(isLiveBusyState('idle')).toBe(false);
    expect(isLiveBusyState('starting')).toBe(true);
    expect(isLiveBusyState('connecting')).toBe(true);
    expect(isLiveBusyState('live')).toBe(true);
    expect(isLiveBusyState('paused')).toBe(true);
    expect(isLiveBusyState('stopping')).toBe(false);
    expect(isLiveBusyState('error')).toBe(false);
  });

  it('keeps microphone intents valid during transitions and fallback speech', () => {
    expect(liveMicIntent('starting', false)).toBe('stop-live');
    expect(liveMicIntent('connecting', false)).toBe('stop-live');
    expect(liveMicIntent('live', false)).toBe('stop-live');
    expect(liveMicIntent('paused', false)).toBe('resume');
    expect(liveMicIntent('stopping', false)).toBe('ignore');
    expect(liveMicIntent('error', true)).toBe('stop-speech');
    expect(liveMicIntent('idle', true)).toBe('stop-speech');
  });

  it('rejects status fan-out from an older runtime operation', () => {
    expect(acceptsLiveStatusOperation(2, 3)).toBe(false);
    expect(acceptsLiveStatusOperation(3, 3)).toBe(true);
    expect(acceptsLiveStatusOperation(undefined, 3)).toBe(true);
  });

  it('preserves microphone, pause, freeze, and fallback semantics', () => {
    expect(controlsFromLiveStatus(status('starting', { selectionFrozen: true }))).toEqual({
      liveFrozen: true,
      liveFallback: null,
      micOn: true,
      paused: false,
    });
    expect(controlsFromLiveStatus(status('paused', { fallback: 'text-coaching' }))).toEqual({
      liveFrozen: false,
      liveFallback: 'text-coaching',
      micOn: false,
      paused: true,
    });
    expect(controlsFromLiveStatus(status('error', { selectionFrozen: true }))).toEqual({
      liveFrozen: true,
      liveFallback: null,
      micOn: false,
      paused: false,
    });
  });
});

describe('live coaching operation boundary', () => {
  it('accepts only the mounted latest operation', () => {
    expect(isCurrentLiveOperation({
      mounted: true,
      operationSequence: 4,
      latestSequence: 4,
    })).toBe(true);
  });

  it('rejects stale and unmounted responses', () => {
    const current = {
      mounted: true,
      operationSequence: 4,
      latestSequence: 4,
    } as const;

    expect(isCurrentLiveOperation({ ...current, mounted: false })).toBe(false);
    expect(isCurrentLiveOperation({ ...current, operationSequence: 3 })).toBe(false);
    expect(isCurrentLiveOperation({ ...current, latestSequence: 5 })).toBe(false);
  });
});
