import { describe, expect, it } from 'vitest';
import type { LiveSessionStatus } from '@/shared/types';
import { controlsFromLiveStatus, isLiveBusyState } from './liveCoachingState';

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
