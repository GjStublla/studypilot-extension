import { describe, expect, it } from 'vitest';
import { isCurrentPanelOperation } from './panelLifecycle';

describe('panel async-operation boundary', () => {
  it('accepts the mounted latest operation', () => {
    expect(isCurrentPanelOperation({
      mounted: true,
      operationSequence: 3,
      latestSequence: 3,
    })).toBe(true);
  });

  it('rejects an operation after unmount', () => {
    expect(isCurrentPanelOperation({
      mounted: false,
      operationSequence: 3,
      latestSequence: 3,
    })).toBe(false);
  });

  it('rejects a superseded operation', () => {
    expect(isCurrentPanelOperation({
      mounted: true,
      operationSequence: 2,
      latestSequence: 3,
    })).toBe(false);
  });
});
